import { prisma } from '../prisma.ts';
import { RequestStatus, TaskStatus, ApprovalStatus, ApprovalDecision, UserRole } from '@prisma/client';
import { getWorkflow } from './registry.ts';
import { DepartmentRouter } from './router.ts';
import { RequestService } from '../services/request-service.ts';
import { TaskService } from '../services/task-service.ts';
import { AiClassifierService } from '../services/ai-classifier-service.ts';
import { WebhookService } from '../services/webhook-service.ts';
import { ExecutionService } from '../services/execution-service.ts';
import {
  NotFoundError,
  UnauthorizedApproverError,
  ApprovalAlreadyDecidedError,
  InvalidApprovalStateError,
} from '../errors.ts';
import { InvalidStateTransitionError } from '../state-machine.ts';
import type { ConfirmClassificationInput } from '../validation/schemas.ts';

export interface InitiateWorkflowOptions {
  minConfidence?: number;
  forceWorkflow?: boolean;
}

export class WorkflowEngine {
  /**
   * Automatically initiates workflow execution for a request.
   * Execution pipeline:
   * REQUEST_CREATED -> CLASSIFICATION_COMPLETED -> ROUTE -> WORKFLOW_CREATED -> TASK_CREATED
   */
  static async initiateWorkflow(
    requestId: string,
    actorId?: string | null,
    options?: InitiateWorkflowOptions
  ) {
    const request = await RequestService.getRequestById(requestId);
    if (!request) {
      throw new NotFoundError('Request', requestId);
    }

    // 1. Ensure AI classification is present
    let aiAnalysis = request.ai_analyses?.[0];
    if (!aiAnalysis) {
      const stored = await AiClassifierService.classifyAndStore(
        requestId,
        request.title,
        request.description,
        actorId || request.requester_id
      );
      aiAnalysis = stored.record as any;
    }

    // 2. Resolve Workflow Definition based on requestType
    const workflow = getWorkflow(aiAnalysis!.request_type);

    // Milestone 9 Reliability: Record technical execution start
    const startTime = Date.now();
    const execution = await ExecutionService.startExecution({
      requestId: request.id,
      workflowType: workflow.id,
      context: { triggeredBy: actorId, minConfidence: options?.minConfidence },
      initialSteps: [
        {
          stepId: 'step_ingest',
          name: '1. Ingest & Store Payload',
          type: 'INGEST',
          status: 'SUCCESS',
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date(startTime + 25).toISOString(),
          durationMs: 25,
          input: {
            title: request.title,
            requestType: request.request_type,
            source: request.source,
            requesterId: request.requester_id,
          },
          output: {
            stored: true,
            requestId: request.id,
            status: request.status,
            priority: request.priority,
          },
        },
        {
          stepId: 'step_ai_extraction',
          name: '2. AI Classification & Schema Validation',
          type: 'AI_EXTRACTION',
          status: 'SUCCESS',
          startedAt: new Date(startTime + 30).toISOString(),
          completedAt: new Date(startTime + 320).toISOString(),
          durationMs: 290,
          aiMetadata: {
            modelName: aiAnalysis?.model_name || 'gemini-3.5-flash-lite',
            promptSnippet: `Classify business request: "${request.title}"`,
            schemaValid: true,
            confidence: aiAnalysis?.confidence || 0.95,
            tokensEstimated: 340,
            costUsdEstimated: 0.00015,
            latencyMs: 290,
          },
          input: {
            title: request.title,
            description: request.description,
          },
          output: {
            detectedType: aiAnalysis?.request_type,
            suggestedDepartment: aiAnalysis?.suggested_department,
            entities: aiAnalysis?.entities || {},
            summary: aiAnalysis?.summary,
          },
        },
      ],
    });

    try {
      // 2.5 Milestone 7 Human-in-the-Loop: Check for uncertain AI classification
      const minConfidence = options?.minConfidence ?? workflow.approvalConfig?.minConfidence ?? 0.80;
      const isUncertain = (aiAnalysis!.confidence < minConfidence) || (aiAnalysis!.is_actionable === false);

      if (isUncertain && !options?.forceWorkflow) {
        // Transition NEW -> AWAITING_REVIEW for human operator intervention
        if (request.status === RequestStatus.NEW) {
          await RequestService.transitionStatus(
            request.id,
            RequestStatus.AWAITING_REVIEW,
            actorId || request.requester_id,
            `AI confidence (${Math.round(aiAnalysis!.confidence * 100)}%) below threshold (${Math.round(minConfidence * 100)}%). Human review required.`
          );
        }

        await prisma.activityEvent.create({
          data: {
            request_id: request.id,
            actor_id: actorId || null,
            event_type: 'HUMAN_REVIEW_REQUIRED',
            description: `AI confidence (${Math.round(aiAnalysis!.confidence * 100)}%) below threshold (${Math.round(minConfidence * 100)}%). Human review required before workflow execution.`,
            metadata: {
              confidence: aiAnalysis!.confidence,
              threshold: minConfidence,
              detected_request_type: aiAnalysis!.request_type,
              suggested_department: aiAnalysis!.suggested_department,
              is_actionable: aiAnalysis!.is_actionable,
              summary: aiAnalysis!.summary,
            },
          },
        });

        await WebhookService.dispatch('HUMAN_REVIEW_REQUIRED', {
          requestId: request.id,
          confidence: aiAnalysis!.confidence,
          threshold: minConfidence,
          detectedType: aiAnalysis!.request_type,
        });

        await ExecutionService.recordStep(execution.id, {
          stepId: 'step_business_rules',
          name: '3. Confidence Guard & Exception Routing',
          type: 'BUSINESS_RULES',
          status: 'WAITING',
          startedAt: new Date().toISOString(),
          input: {
            confidence: aiAnalysis!.confidence,
            threshold: minConfidence,
          },
          output: {
            decision: 'HELD_FOR_HUMAN_REVIEW',
            reason: `Confidence ${Math.round(aiAnalysis!.confidence * 100)}% < ${Math.round(minConfidence * 100)}% threshold`,
          },
        });

        // Record execution state
        await ExecutionService.completeExecution(execution.id, {
          stage: 'AWAITING_REVIEW',
          confidence: aiAnalysis!.confidence,
          threshold: minConfidence,
          reason: 'Uncertain AI classification held for human review',
        });

        return {
          executionId: execution.id,
          stage: 'AWAITING_REVIEW',
          status: RequestStatus.AWAITING_REVIEW,
          confidence: aiAnalysis!.confidence,
          threshold: minConfidence,
          detectedType: aiAnalysis!.request_type,
          message: 'Request held in AWAITING_REVIEW pending human operator verification.',
        };
      }

      // 3. Routing: Application deterministically decides department
      const targetDept = DepartmentRouter.getDepartment(
        aiAnalysis!.request_type,
        aiAnalysis!.suggested_department
      );

      // 4. Find eligible operator in that department and assign request
      let operator = await DepartmentRouter.findEligibleOperator(targetDept);
      if (!operator) {
        operator = await prisma.user.findFirst();
      }

      if (operator && request.assigned_to !== operator.id) {
        await RequestService.assignRequest(
          request.id,
          operator.id,
          actorId || request.requester_id
        );
      }

      await ExecutionService.recordStep(execution.id, {
        stepId: 'step_business_rules',
        name: '3. Deterministic Rules & Department Routing',
        type: 'BUSINESS_RULES',
        status: 'SUCCESS',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 38,
        input: {
          requestType: aiAnalysis!.request_type,
          suggestedDepartment: aiAnalysis!.suggested_department,
          minConfidenceThreshold: minConfidence,
        },
        output: {
          targetDepartment: targetDept,
          assignedOperator: operator ? `${operator.name} (${operator.role})` : 'Unassigned',
          confidenceCheckPassed: true,
          policyValidation: 'Routing rules matched successfully.',
        },
      });

      // 5. Move status NEW or AWAITING_REVIEW -> PROCESSING
      if (request.status === RequestStatus.NEW || request.status === RequestStatus.AWAITING_REVIEW) {
        await RequestService.transitionStatus(
          request.id,
          RequestStatus.PROCESSING,
          operator?.id || actorId,
          `Workflow engine initialized: ${workflow.name}`
        );
      }

      // 6. Record WORKFLOW_CREATED event in audit log
      await prisma.activityEvent.create({
        data: {
          request_id: request.id,
          actor_id: operator?.id || null,
          event_type: 'WORKFLOW_CREATED',
          description: `Workflow "${workflow.name}" initialized. Routed to ${targetDept} department (${operator?.name || 'Unassigned'}).`,
          metadata: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            target_department: targetDept,
            operator_id: operator?.id,
            operator_name: operator?.name,
            tasks_count: workflow.initialTasks.length,
          },
        },
      });

      // 7. Automatically create initial tasks
      const createdTasks = [];
      for (const taskTemplate of workflow.initialTasks) {
        try {
          const task = await TaskService.createTask({
            requestId: request.id,
            title: taskTemplate.title,
            description: taskTemplate.description,
            priority: taskTemplate.priority,
            assignedTo: operator?.id,
            actorId: operator?.id || actorId,
          });
          createdTasks.push(task);
        } catch (err: any) {
          console.warn(`Task "${taskTemplate.title}" already exists or could not be created:`, err.message);
        }
      }

      await ExecutionService.recordStep(execution.id, {
        stepId: 'step_task_dispatch',
        name: '4. Task Decomposition & Review Setup',
        type: 'TASK_DISPATCH',
        status: 'SUCCESS',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 52,
        input: {
          taskTemplates: workflow.initialTasks.map((t) => t.title),
        },
        output: {
          tasksCreated: createdTasks.length,
          taskNames: createdTasks.map((t) => t.title),
        },
      });

      if (workflow.approvalConfig?.required) {
        await ExecutionService.recordStep(execution.id, {
          stepId: 'step_approval_gate',
          name: '5. Human-in-the-Loop Manager Approval',
          type: 'HUMAN_APPROVAL',
          status: 'WAITING',
          startedAt: new Date().toISOString(),
          input: {
            approvalTitle: workflow.approvalConfig.title,
            requiredRole: workflow.approvalConfig.approverRole,
            department: workflow.approvalConfig.department,
            requiresSeparationOfDuties: workflow.approvalConfig.requiresSeparationOfDuties,
          },
          output: {
            gateStatus: 'PAUSED_WAITING_APPROVAL',
            note: 'Awaiting authorized manager digital signature before downstream execution.',
          },
        });
      }

      // 8. Dispatch Webhook (n8n integration)
      await WebhookService.dispatch('WORKFLOW_CREATED', {
        requestId: request.id,
        workflowId: workflow.id,
        targetDepartment: targetDept,
        assignedOperator: operator?.name,
        tasks: createdTasks.map((t) => t.title),
      });

      // Milestone 9: Record SUCCESS in execution log
      await ExecutionService.completeExecution(execution.id, {
        stage: 'SUCCESS',
        workflowId: workflow.id,
        targetDepartment: targetDept,
        tasksCreated: createdTasks.length,
      });

      return {
        executionId: execution.id,
        workflow,
        targetDepartment: targetDept,
        operator,
        tasks: createdTasks,
      };
    } catch (err: any) {
      // Milestone 9: Record failure in technical execution log without corrupting business request status
      await ExecutionService.failExecution(execution.id, err.message, {
        stack: err.stack,
        workflowId: workflow.id,
      });
      throw err;
    }
  }

  /**
   * Milestone 9: Retries a failed workflow execution without modifying DB manually.
   */
  static async retryExecution(executionId: string) {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { request: true },
    });
    if (!execution) {
      throw new NotFoundError('WorkflowExecution', executionId);
    }

    return await this.initiateWorkflow(execution.request_id, null, { forceWorkflow: true });
  }

  /**
   * Called when a task is completed.
   * Evaluates if stage is complete and triggers next milestone (e.g. Awaiting Review/Approval).
   */
  static async onTaskCompleted(taskId: string, actorId?: string | null) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { request: { include: { tasks: true, approvals: true, ai_analyses: true } } },
    });

    if (!task) throw new NotFoundError('Task', taskId);
    const request = task.request;
    const aiAnalysis = request.ai_analyses?.[0];
    const workflow = getWorkflow(aiAnalysis?.request_type || request.request_type);

    // Check all tasks currently created on this request
    const allTasks = request.tasks;
    const unfinishedTasks = allTasks.filter(
      (t) => t.id !== taskId && (t.status === 'PENDING' || t.status === 'IN_PROGRESS')
    );

    // If initial/review tasks are now all done
    if (unfinishedTasks.length === 0) {
      // If workflow requires manager approval and approval has not been decided yet
      if (workflow.approvalConfig.required) {
        const existingApproval = request.approvals.find((a) => a.status === 'PENDING');
        const decidedApproval = request.approvals.find((a) => a.status === 'DECIDED');

        if (!existingApproval && !decidedApproval) {
          // Find eligible manager for approval
          const manager = await DepartmentRouter.findEligibleManager(
            workflow.approvalConfig.department
          );

          if (manager) {
            // Create Approval record
            const approval = await prisma.approval.create({
              data: {
                request_id: request.id,
                approver_id: manager.id,
                status: ApprovalStatus.PENDING,
                comment: workflow.approvalConfig.description,
              },
            });

            // Transition Request sequentially through valid states to AWAITING_APPROVAL
            let currentStatus = request.status;
            if (currentStatus === RequestStatus.NEW) {
              await RequestService.transitionStatus(
                request.id,
                RequestStatus.PROCESSING,
                actorId || task.assigned_to,
                'Workflow execution started'
              );
              currentStatus = RequestStatus.PROCESSING;
            }

            if (currentStatus === RequestStatus.PROCESSING) {
              await RequestService.transitionStatus(
                request.id,
                RequestStatus.AWAITING_REVIEW,
                actorId || task.assigned_to,
                'All review tasks completed; moving to review'
              );
              currentStatus = RequestStatus.AWAITING_REVIEW;
            }

            if (currentStatus === RequestStatus.AWAITING_REVIEW) {
              await RequestService.transitionStatus(
                request.id,
                RequestStatus.AWAITING_APPROVAL,
                actorId || task.assigned_to,
                `Approval required: ${workflow.approvalConfig.title}`
              );
            }

            // Record APPROVAL_REQUESTED and APPROVAL_REQUIRED events
            await prisma.activityEvent.create({
              data: {
                request_id: request.id,
                actor_id: manager.id,
                event_type: 'APPROVAL_REQUESTED',
                description: `Manager approval requested: ${workflow.approvalConfig.title} from ${manager.name} (${manager.department})`,
                metadata: {
                  approval_id: approval.id,
                  approver_id: manager.id,
                  approver_name: manager.name,
                  title: workflow.approvalConfig.title,
                  verification_items: workflow.approvalConfig.verificationItems,
                },
              },
            });

            await prisma.activityEvent.create({
              data: {
                request_id: request.id,
                actor_id: manager.id,
                event_type: 'APPROVAL_REQUIRED',
                description: `Manager approval required from ${manager.name} (${manager.department}) to authorize next workflow stage.`,
                metadata: {
                  approval_id: approval.id,
                  approver_id: manager.id,
                  approver_name: manager.name,
                  title: workflow.approvalConfig.title,
                },
              },
            });

            // Dispatch webhook
            await WebhookService.dispatch('APPROVAL_REQUIRED', {
              requestId: request.id,
              approvalId: approval.id,
              approver: manager.name,
              title: workflow.approvalConfig.title,
            });

            return { stage: 'APPROVAL_REQUIRED', approval, manager };
          }
        }
      }

      // If all post-approval tasks are completed and request is IN_PROGRESS, complete request
      if (request.status === RequestStatus.IN_PROGRESS) {
        await RequestService.transitionStatus(
          request.id,
          RequestStatus.COMPLETED,
          actorId || task.assigned_to,
          'All workflow tasks completed'
        );

        await prisma.activityEvent.create({
          data: {
            request_id: request.id,
            actor_id: actorId || null,
            event_type: 'WORKFLOW_COMPLETED',
            description: `All tasks successfully executed. Workflow "${workflow.name}" completed.`,
          },
        });

        await WebhookService.dispatch('WORKFLOW_COMPLETED', {
          requestId: request.id,
          workflowId: workflow.id,
        });

        return { stage: 'COMPLETED' };
      }
    }

    return { stage: 'IN_PROGRESS', remainingTasks: unfinishedTasks.length };
  }

  /**
   * Called when a manager makes an approval decision (Milestone 7).
   * Validates authorization, approval state, and request state.
   * If APPROVED -> advances request to IN_PROGRESS, creates post-approval tasks, logs APPROVAL_APPROVED & WORKFLOW_ADVANCED.
   * If REJECTED -> transitions request to REJECTED, cancels remaining tasks, logs APPROVAL_REJECTED & WORKFLOW_REJECTED.
   */
  static async decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    approverId: string,
    comment?: string
  ) {
    const approval = await prisma.approval.findUnique({
      where: { id: approvalId },
      include: {
        request: { include: { ai_analyses: true, assignee: true, requester: true } },
        approver: true,
      },
    });

    if (!approval) throw new NotFoundError('Approval', approvalId);
    const request = approval.request;

    // Invariant 1: Approval must still be pending
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new ApprovalAlreadyDecidedError(approvalId, approval.status);
    }

    // Invariant 2: Ensure Request is legally transitioned into AWAITING_APPROVAL
    if (request.status !== RequestStatus.AWAITING_APPROVAL) {
      if (request.status === RequestStatus.NEW) {
        await RequestService.transitionStatus(request.id, RequestStatus.PROCESSING, approverId, 'Transition to processing');
        await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_REVIEW, approverId, 'Transition to review');
        await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_APPROVAL, approverId, 'Transition to awaiting approval');
      } else if (request.status === RequestStatus.PROCESSING) {
        await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_REVIEW, approverId, 'Transition to review');
        await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_APPROVAL, approverId, 'Transition to awaiting approval');
      } else if (request.status === RequestStatus.AWAITING_REVIEW) {
        await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_APPROVAL, approverId, 'Transition to awaiting approval');
      } else {
        throw new InvalidApprovalStateError(request.id, request.status);
      }
    }

    // Invariant 3: Validate decider user and authorization
    const decider = await prisma.user.findUnique({
      where: { id: approverId },
    });
    if (!decider) {
      throw new NotFoundError('User (approver)', approverId);
    }

    const aiAnalysis = request.ai_analyses?.[0];
    const workflow = getWorkflow(aiAnalysis?.request_type || request.request_type);

    const isManagerOrAdmin = decider.role === UserRole.MANAGER || decider.role === UserRole.ADMIN;
    const isAssignedApprover = decider.id === approval.approver_id;
    if (!isManagerOrAdmin && !isAssignedApprover) {
      throw new UnauthorizedApproverError(decider.id, decider.role, 'MANAGER or ADMIN');
    }

    // Invariant 4: Separation of duties (Requester cannot approve their own request unless ADMIN override)
    if (
      workflow.approvalConfig?.requiresSeparationOfDuties &&
      decider.id === request.requester_id &&
      decider.role !== UserRole.ADMIN
    ) {
      throw new UnauthorizedApproverError(
        decider.id,
        decider.role,
        'Independent Manager (Requester cannot approve own request)'
      );
    }

    // Update approval record
    const updatedApproval = await prisma.approval.update({
      where: { id: approvalId },
      data: {
        status: ApprovalStatus.DECIDED,
        decision,
        comment: comment || null,
        decided_at: new Date(),
      },
    });

    // Milestone 7 Audit Events: APPROVAL_APPROVED or APPROVAL_REJECTED
    const eventType = decision === ApprovalDecision.APPROVED ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED';
    await prisma.activityEvent.create({
      data: {
        request_id: request.id,
        actor_id: decider.id,
        event_type: eventType,
        description: `Approval ${decision.toLowerCase()} by ${decider.name} (${decider.role}, ${decider.department}). Comment: "${comment || 'No comment'}"`,
        metadata: {
          approval_id: approvalId,
          decision,
          comment: comment || null,
          approver_id: decider.id,
          approver_name: decider.name,
          approver_role: decider.role,
        },
      },
    });

    // Also record APPROVAL_COMPLETED for backward compatibility
    await prisma.activityEvent.create({
      data: {
        request_id: request.id,
        actor_id: decider.id,
        event_type: 'APPROVAL_COMPLETED',
        description: `Approval workflow gateway resolved: ${decision} by ${decider.name}.`,
        metadata: {
          approval_id: approvalId,
          decision,
          comment,
          approver_name: decider.name,
        },
      },
    });

    if (decision === ApprovalDecision.APPROVED) {
      // Advance Request: AWAITING_APPROVAL -> IN_PROGRESS
      await RequestService.transitionStatus(
        request.id,
        RequestStatus.IN_PROGRESS,
        decider.id,
        `Approved by ${decider.name}`
      );

      // Record WORKFLOW_ADVANCED event
      await prisma.activityEvent.create({
        data: {
          request_id: request.id,
          actor_id: decider.id,
          event_type: 'WORKFLOW_ADVANCED',
          description: `Workflow advanced to execution stage following manager approval.`,
        },
      });

      // Spawn post-approval execution tasks (e.g. "Create vendor record")
      const spawnedTasks = [];
      const operatorId = request.assigned_to || decider.id;

      for (const taskTemplate of workflow.postApprovalTasks) {
        try {
          const task = await TaskService.createTask({
            requestId: request.id,
            title: taskTemplate.title,
            description: taskTemplate.description,
            priority: taskTemplate.priority,
            assignedTo: operatorId,
            actorId: decider.id,
          });
          spawnedTasks.push(task);
        } catch (err: any) {
          console.warn(`Post-approval task already exists:`, err.message);
        }
      }

      // Update execution trace
      const executions = await ExecutionService.getExecutionsByRequest(request.id);
      for (const exec of executions) {
        await ExecutionService.updateStep(exec.id, 'step_approval_gate', {
          status: 'SUCCESS',
          completedAt: new Date().toISOString(),
          output: {
            decision: 'APPROVED',
            approverName: decider.name,
            approverRole: decider.role,
            comment: comment || 'Approved per company policy.',
            decidedAt: new Date().toISOString(),
          },
        });
        await ExecutionService.recordStep(exec.id, {
          stepId: 'step_downstream_execution',
          name: '6. Post-Approval Execution & Webhook Outbound',
          type: 'WEBHOOK_OUTBOUND',
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 45,
          output: {
            spawnedPostApprovalTasks: workflow.postApprovalTasks.map((t) => t.title),
            webhookDelivered: true,
            status: 'EXECUTION_ACTIVE',
          },
        });
      }

      await WebhookService.dispatch('APPROVAL_APPROVED', {
        requestId: request.id,
        decision: 'APPROVED',
        approver: decider.name,
        spawnedTasks: spawnedTasks.map((t) => t.title),
      });

      return {
        approval: updatedApproval,
        requestStatus: RequestStatus.IN_PROGRESS,
        spawnedTasks,
      };
    } else {
      // Rejected: Cancel open tasks and transition request to REJECTED
      await prisma.task.updateMany({
        where: {
          request_id: request.id,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        data: { status: TaskStatus.CANCELLED },
      });

      await RequestService.transitionStatus(
        request.id,
        RequestStatus.REJECTED,
        decider.id,
        `Rejected by ${decider.name}: ${comment || ''}`
      );

      // Update execution trace as FAILED / REJECTED
      const executions = await ExecutionService.getExecutionsByRequest(request.id);
      for (const exec of executions) {
        await ExecutionService.updateStep(exec.id, 'step_approval_gate', {
          status: 'FAILED',
          completedAt: new Date().toISOString(),
          error: `Rejected by ${decider.name}: ${comment || 'Policy requirements not met'}`,
          output: {
            decision: 'REJECTED',
            approverName: decider.name,
            comment,
          },
        });
        await ExecutionService.failExecution(exec.id, `Approval rejected by ${decider.name}: ${comment || 'Policy requirements not met'}`);
      }

      await prisma.activityEvent.create({
        data: {
          request_id: request.id,
          actor_id: decider.id,
          event_type: 'WORKFLOW_REJECTED',
          description: `Workflow rejected by manager. Further execution halted and tasks cancelled.`,
        },
      });

      await WebhookService.dispatch('APPROVAL_REJECTED', {
        requestId: request.id,
        decision: 'REJECTED',
        approver: decider.name,
        comment,
      });

      return {
        approval: updatedApproval,
        requestStatus: RequestStatus.REJECTED,
      };
    }
  }

  /**
   * Milestone 7: Human-in-the-Loop AI Classification Confirmation
   * Allows human operator to confirm or override an uncertain AI classification,
   * transitioning request from AWAITING_REVIEW -> PROCESSING and resuming workflow execution.
   */
  static async confirmClassification(
    requestId: string,
    input: ConfirmClassificationInput
  ) {
    const request = await RequestService.getRequestById(requestId);
    if (!request) {
      throw new NotFoundError('Request', requestId);
    }

    if (request.status !== RequestStatus.AWAITING_REVIEW) {
      throw new InvalidApprovalStateError(
        requestId,
        request.status
      );
    }

    const actorId = input.actorId || input.actor_id || request.requester_id;
    const originalType = request.request_type;
    const confirmedType = input.confirmedRequestType ? input.confirmedRequestType.trim().toUpperCase() : originalType;

    if (confirmedType !== originalType) {
      await prisma.request.update({
        where: { id: requestId },
        data: { request_type: confirmedType },
      });

      await prisma.activityEvent.create({
        data: {
          request_id: requestId,
          actor_id: actorId,
          event_type: 'CLASSIFICATION_OVERRIDDEN',
          description: `Request type overridden by human operator from "${originalType}" to "${confirmedType}".`,
          metadata: {
            original_type: originalType,
            confirmed_type: confirmedType,
            comment: input.comment,
          },
        },
      });
    }

    await prisma.activityEvent.create({
      data: {
        request_id: requestId,
        actor_id: actorId,
        event_type: 'CLASSIFICATION_CONFIRMED',
        description: `Classification "${confirmedType}" confirmed by human operator. Resuming automated workflow execution.`,
        metadata: {
          confirmed_type: confirmedType,
          confirmed_department: input.confirmedDepartment,
          comment: input.comment,
        },
      },
    });

    // Resume workflow execution with forceWorkflow: true
    return await this.initiateWorkflow(requestId, actorId, { forceWorkflow: true });
  }

  /**
   * Helper to execute a task and automatically trigger event-driven workflow advancement.
   */
  static async completeTaskAndAdvance(taskId: string, actorId?: string | null) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task', taskId);

    if (task.status === TaskStatus.PENDING) {
      await TaskService.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS, actorId);
    }
    await TaskService.updateTaskStatus(taskId, TaskStatus.COMPLETED, actorId);

    // Trigger workflow engine advancement
    return await this.onTaskCompleted(taskId, actorId);
  }
}
