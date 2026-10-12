import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ExecutionService } from '@/lib/services/execution-service';
import { TaskService } from '@/lib/services/task-service';

export interface AuthorizePlanInput {
  requestAnalysis: {
    type: string;
    supplier: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    requiredDepartment: string;
  };
  proposedWorkflow: Array<{
    stepNumber: number;
    actionKey: string;
    title: string;
    targetRole: string;
    department: string;
    description?: string;
  }>;
  actorId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { requestAnalysis, proposedWorkflow, actorId }: AuthorizePlanInput = await req.json();

    const requester =
      (await prisma.user.findFirst({ where: { role: 'REQUESTER' } })) ||
      (await prisma.user.findFirst());
    const operator =
      (await prisma.user.findFirst({ where: { role: 'OPERATOR' } })) ||
      (await prisma.user.findFirst());

    if (!requester) {
      return NextResponse.json({ error: 'User records missing' }, { status: 400 });
    }

    const startTime = Date.now();

    // 1. Create Formal Request
    const request = await prisma.request.create({
      data: {
        title: `Onboard Supplier: ${requestAnalysis.supplier}`,
        description: `Authorized workflow execution for ${requestAnalysis.supplier}. Department: ${requestAnalysis.requiredDepartment}. Plan authorized by operator.`,
        request_type: requestAnalysis.type,
        priority: requestAnalysis.priority,
        status: 'PROCESSING',
        requester_id: requester.id,
        assigned_to: operator?.id || null,
        source: 'AUTHORIZED_AI_PLAN',
        due_at: new Date(Date.now() + 4 * 3600 * 1000), // 4h SLA
      },
    });

    // 2. Spawn Authorized Initial Tasks
    const initialTasksToCreate = proposedWorkflow.filter((s) => s.stepNumber <= 2);
    const createdTasks = [];
    for (const t of initialTasksToCreate) {
      const task = await TaskService.createTask({
        requestId: request.id,
        title: t.title,
        description: t.description || undefined,
        priority: requestAnalysis.priority,
        assignedTo: operator?.id || undefined,
        actorId: actorId || operator?.id,
      });
      createdTasks.push(task);
    }

    // 3. Create Execution Record with Steps for Execution Inspector
    const steps = proposedWorkflow.map((step, idx) => ({
      stepId: `step_${step.actionKey.toLowerCase()}`,
      name: `${step.stepNumber}. ${step.title}`,
      type: step.targetRole === 'MANAGER' ? 'HUMAN_APPROVAL' : 'TASK_DISPATCH',
      status: idx === 0 ? 'SUCCESS' : idx === 1 ? 'RUNNING' : 'WAITING',
      startedAt: new Date(startTime + idx * 50).toISOString(),
      completedAt: idx === 0 ? new Date(startTime + 60).toISOString() : undefined,
      durationMs: idx === 0 ? 60 : undefined,
      input: {
        actionKey: step.actionKey,
        targetRole: step.targetRole,
        department: step.department,
      },
      output: idx === 0 ? { status: 'DISPATCHED_TO_OPERATOR', taskCount: createdTasks.length } : undefined,
    }));

    const execution = await prisma.workflowExecution.create({
      data: {
        request_id: request.id,
        workflow_type: 'authorized_plan_execution_v1',
        status: 'RUNNING',
        attempt: 1,
        max_attempts: 3,
        started_at: new Date(startTime),
        context: {
          supplier: requestAnalysis.supplier,
          priority: requestAnalysis.priority,
          authorizedBy: actorId || operator?.name || 'Operator',
          authorizedAt: new Date().toISOString(),
          steps,
        },
      },
    });

    // 4. Audit Log Entry
    await prisma.activityEvent.create({
      data: {
        request_id: request.id,
        actor_id: actorId || operator?.id,
        event_type: 'WORKFLOW_AUTHORIZED',
        description: `Operator authorized proposed workflow plan for ${requestAnalysis.supplier}. ${createdTasks.length} initial tasks dispatched.`,
        metadata: {
          executionId: execution.id,
          tasksCount: createdTasks.length,
          planStepsCount: proposedWorkflow.length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Plan authorized! Workflow execution initiated.',
      data: {
        requestId: request.id,
        executionId: execution.id,
        createdTasksCount: createdTasks.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to authorize plan' },
      { status: 500 }
    );
  }
}
