import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { RequestService } from '@/lib/services/request-service';
import { TaskService } from '@/lib/services/task-service';
import { UserRole, RequestStatus, TaskStatus, ApprovalStatus, ApprovalDecision, Priority } from '@prisma/client';
import { UnauthorizedApproverError, ApprovalAlreadyDecidedError, InvalidApprovalStateError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  const record = (category: string, name: string, condition: boolean, note?: string) => {
    results.push({ category, name, passed: Boolean(condition), note });
  };

  try {
    // 0. Setup test users
    let requester = await prisma.user.findFirst({ where: { role: UserRole.REQUESTER } });
    if (!requester) {
      requester = await prisma.user.create({
        data: { name: 'David Requester', email: `david.req.${Date.now()}@corp.internal`, role: UserRole.REQUESTER, department: 'Operations' },
      });
    }

    let operator = await prisma.user.findFirst({ where: { role: UserRole.OPERATOR, department: 'Procurement' } });
    if (!operator) {
      operator = await prisma.user.create({
        data: { name: 'Alice Operator', email: `alice.proc.${Date.now()}@corp.internal`, role: UserRole.OPERATOR, department: 'Procurement' },
      });
    }

    let manager = await prisma.user.findFirst({ where: { role: UserRole.MANAGER, department: 'Procurement' } });
    if (!manager) {
      manager = await prisma.user.create({
        data: { name: 'Carol Manager', email: `carol.mgr.${Date.now()}@corp.internal`, role: UserRole.MANAGER, department: 'Procurement' },
      });
    }

    let otherOperator = await prisma.user.findFirst({ where: { role: UserRole.OPERATOR, department: 'IT' } });
    if (!otherOperator) {
      otherOperator = await prisma.user.create({
        data: { name: 'Bob IT Operator', email: `bob.it.${Date.now()}@corp.internal`, role: UserRole.OPERATOR, department: 'IT' },
      });
    }

    // =========================================================================
    // PART 1: End-to-End Approval Lifecycle & Workflow Advancement
    // =========================================================================
    const req1 = await RequestService.createRequest({
      title: 'Onboard Beta Corp as new vendor',
      description: 'Vendor onboarding request. Tax certificate and CAC documents attached for review.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    record('Intake', 'Request 1 created in NEW status', req1.status === RequestStatus.NEW);

    // AI Classification record
    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req1.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.HIGH,
        summary: 'Vendor onboarding for Beta Corp',
        suggested_department: 'procurement',
        confidence: 0.95,
        entities: { companyName: 'Beta Corp' },
        documents_mentioned: ['CAC document', 'Tax certificate'],
        missing_information: [],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    // Initiate workflow (high confidence -> starts directly)
    const initResult = await WorkflowEngine.initiateWorkflow(req1.id, requester.id);
    record('Workflow Engine', 'High-confidence request transitions directly to PROCESSING', initResult.stage !== 'AWAITING_REVIEW');

    const tasksStep1 = await TaskService.listTasksByRequest(req1.id);
    record('Task Generation', 'Initial review tasks created', tasksStep1.length === 2);

    // Complete review tasks to reach approval gateway
    for (const t of tasksStep1) {
      await WorkflowEngine.completeTaskAndAdvance(t.id, operator.id);
    }

    const reqStep2 = await RequestService.getRequestById(req1.id);
    record('State Transition', 'Request moved to AWAITING_APPROVAL after review tasks finished', reqStep2.status === RequestStatus.AWAITING_APPROVAL);

    const pendingApproval = reqStep2.approvals.find((a) => a.status === ApprovalStatus.PENDING);
    record('Approval Record', 'Pending approval created for manager', Boolean(pendingApproval));
    record('Status Distinction', 'approval.status (PENDING) != request.status (AWAITING_APPROVAL)', pendingApproval?.status === ApprovalStatus.PENDING && reqStep2.status === RequestStatus.AWAITING_APPROVAL);

    // =========================================================================
    // PART 2: Strict Authorization & Server Invariant Checks
    // =========================================================================
    // Invariant 1: Operator cannot approve
    let unauthorizedBlocked = false;
    try {
      await WorkflowEngine.decideApproval(pendingApproval!.id, ApprovalDecision.APPROVED, otherOperator.id, 'Illegal attempt');
    } catch (err: any) {
      if (err instanceof UnauthorizedApproverError) unauthorizedBlocked = true;
    }
    record('Authorization Invariant', 'Unauthorized non-manager is rejected with UnauthorizedApproverError', unauthorizedBlocked);

    // Invariant 2: Cannot approve if request is in wrong state
    // (Simulate by temporarily changing request state)
    let wrongStateBlocked = false;
    await prisma.request.update({ where: { id: req1.id }, data: { status: RequestStatus.PROCESSING } });
    try {
      await WorkflowEngine.decideApproval(pendingApproval!.id, ApprovalDecision.APPROVED, manager.id, 'Should fail');
    } catch (err: any) {
      if (err instanceof InvalidApprovalStateError) wrongStateBlocked = true;
    }
    record('State Invariant', 'Approval cannot be decided when request is not AWAITING_APPROVAL', wrongStateBlocked);
    // Restore request state
    await prisma.request.update({ where: { id: req1.id }, data: { status: RequestStatus.AWAITING_APPROVAL } });

    // =========================================================================
    // PART 3: Manager Approval Advances Workflow
    // =========================================================================
    const approveResult = await WorkflowEngine.decideApproval(
      pendingApproval!.id,
      ApprovalDecision.APPROVED,
      manager.id,
      'Documents verified and approved by Procurement Manager.'
    );

    record('Approval Execution', 'Approval status updated to DECIDED and decision is APPROVED', approveResult.approval.status === ApprovalStatus.DECIDED && approveResult.approval.decision === ApprovalDecision.APPROVED);
    record('Workflow Advancement', 'Request status transitioned AWAITING_APPROVAL -> IN_PROGRESS', approveResult.requestStatus === RequestStatus.IN_PROGRESS);
    record('Post-Approval Tasks', 'Post-approval execution task (Create vendor record) generated', Boolean(approveResult.spawnedTasks && approveResult.spawnedTasks.length > 0));

    // Invariant 3: Cannot decide already decided approval
    let alreadyDecidedBlocked = false;
    try {
      await WorkflowEngine.decideApproval(pendingApproval!.id, ApprovalDecision.REJECTED, manager.id, 'Duplicate attempt');
    } catch (err: any) {
      if (err instanceof ApprovalAlreadyDecidedError) alreadyDecidedBlocked = true;
    }
    record('Idempotency Invariant', 'Cannot decide already decided approval (ApprovalAlreadyDecidedError)', alreadyDecidedBlocked);

    // Complete the execution task to reach completion
    const postApprovalTasks = await TaskService.listTasksByRequest(req1.id);
    const execTask = postApprovalTasks.find((t) => t.title === 'Create vendor record');
    if (execTask) {
      await WorkflowEngine.completeTaskAndAdvance(execTask.id, operator.id);
    }

    const finalReq1 = await RequestService.getRequestById(req1.id);
    record('Completion', 'Request reaches COMPLETED after post-approval execution task', finalReq1.status === RequestStatus.COMPLETED);

    // =========================================================================
    // PART 4: Rejection Lifecycle Halts Workflow
    // =========================================================================
    const req2 = await RequestService.createRequest({
      title: 'Onboard Gamma Corp as vendor',
      description: 'Vendor onboarding request with incomplete documents.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'MEDIUM',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req2.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.MEDIUM,
        summary: 'Vendor onboarding for Gamma Corp',
        suggested_department: 'procurement',
        confidence: 0.95,
        entities: { companyName: 'Gamma Corp' },
        documents_mentioned: ['CAC document'],
        missing_information: ['Tax certificate'],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    await WorkflowEngine.initiateWorkflow(req2.id, requester.id);
    const req2Tasks = await TaskService.listTasksByRequest(req2.id);
    for (const t of req2Tasks) {
      await WorkflowEngine.completeTaskAndAdvance(t.id, operator.id);
    }

    const req2WithApproval = await RequestService.getRequestById(req2.id);
    const pendingApp2 = req2WithApproval.approvals.find((a) => a.status === ApprovalStatus.PENDING);

    const rejectResult = await WorkflowEngine.decideApproval(
      pendingApp2!.id,
      ApprovalDecision.REJECTED,
      manager.id,
      'Rejected: Incomplete compliance tax documentation.'
    );

    record('Rejection Execution', 'Approval status is DECIDED with decision REJECTED', rejectResult.approval.status === ApprovalStatus.DECIDED && rejectResult.approval.decision === ApprovalDecision.REJECTED);
    record('Rejection State', 'Request transitioned to REJECTED', rejectResult.requestStatus === RequestStatus.REJECTED);

    const req2TasksAfter = await TaskService.listTasksByRequest(req2.id);
    const anyOpenTasks = req2TasksAfter.some((t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS);
    record('Task Cleanup', 'All remaining tasks on rejected request cancelled', !anyOpenTasks);

    // =========================================================================
    // PART 5: Human-in-the-Loop for Uncertain AI Classification
    // =========================================================================
    const req3 = await RequestService.createRequest({
      title: 'Ambiguous operations query',
      description: 'Need something handled for the branch office soon.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'LOW',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    // Store low confidence AI analysis (0.62 < 0.80 threshold)
    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req3.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.LOW,
        summary: 'Ambiguous request with low certainty',
        suggested_department: 'procurement',
        confidence: 0.62,
        entities: {},
        documents_mentioned: [],
        missing_information: ['Clear purpose', 'Company details'],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    // Trigger workflow engine with low confidence
    const uncertainResult = await WorkflowEngine.initiateWorkflow(req3.id, requester.id);
    record('Human-in-the-Loop Gate', 'Low-confidence AI (< 0.80) holds request in AWAITING_REVIEW', uncertainResult.stage === 'AWAITING_REVIEW');

    const req3Check = await RequestService.getRequestById(req3.id);
    record('Uncertain AI State', 'Request status is AWAITING_REVIEW without tasks created', req3Check.status === RequestStatus.AWAITING_REVIEW && req3Check.tasks.length === 0);

    // Human operator reviews and confirms classification
    const confirmResult = await WorkflowEngine.confirmClassification(req3.id, {
      confirmedRequestType: 'GENERAL_OPS',
      confirmedDepartment: 'Operations',
      actorId: operator.id,
      comment: 'Reclassified to General Ops after human triage.',
    });

    record('Human Confirmation', 'Human operator confirmation moves request to PROCESSING and launches workflow', confirmResult.stage !== 'AWAITING_REVIEW');

    const req3AfterConfirm = await RequestService.getRequestById(req3.id);
    record('Override Recorded', 'Request type updated to GENERAL_OPS', req3AfterConfirm.request_type === 'GENERAL_OPS');
    record('Workflow Initiated', 'Initial tasks generated after human confirmation', req3AfterConfirm.tasks.length > 0);

    // =========================================================================
    // PART 6: Full Audit Trail Verification
    // =========================================================================
    const eventsReq1 = await prisma.activityEvent.findMany({
      where: { request_id: req1.id },
      orderBy: { created_at: 'asc' },
    });

    const eventTypes = eventsReq1.map((e) => e.event_type);
    record('Audit Trail', 'APPROVAL_REQUESTED event logged', eventTypes.includes('APPROVAL_REQUESTED'));
    record('Audit Trail', 'APPROVAL_APPROVED event logged', eventTypes.includes('APPROVAL_APPROVED'));
    record('Audit Trail', 'WORKFLOW_ADVANCED event logged', eventTypes.includes('WORKFLOW_ADVANCED'));

    const eventsReq3 = await prisma.activityEvent.findMany({
      where: { request_id: req3.id },
      orderBy: { created_at: 'asc' },
    });
    const req3EventTypes = eventsReq3.map((e) => e.event_type);
    record('Audit Trail', 'HUMAN_REVIEW_REQUIRED event logged for uncertain AI', req3EventTypes.includes('HUMAN_REVIEW_REQUIRED'));
    record('Audit Trail', 'CLASSIFICATION_CONFIRMED event logged', req3EventTypes.includes('CLASSIFICATION_CONFIRMED'));
    record('Audit Trail', 'CLASSIFICATION_OVERRIDDEN event logged', req3EventTypes.includes('CLASSIFICATION_OVERRIDDEN'));

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return NextResponse.json({
      success: true,
      data: {
        total: results.length,
        passedCount,
        failedCount,
        allPassed: failedCount === 0,
        results,
      },
    });
  } catch (err: any) {
    console.error('Milestone 7 Test Run Failed:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.name || 'TEST_RUN_ERROR',
        message: err.message,
        stack: err.stack,
        results,
      },
      { status: 500 }
    );
  }
}
