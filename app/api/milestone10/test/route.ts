import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma.ts';
import { RequestService } from '@/lib/services/request-service.ts';
import { TaskService } from '@/lib/services/task-service.ts';
import { ApprovalService } from '@/lib/services/approval-service.ts';
import { ClosedRequestModificationError } from '@/lib/errors.ts';
import { WorkflowEngine } from '@/lib/workflows/engine.ts';
import { AiClassifierService } from '@/lib/services/ai-classifier-service.ts';
import { AnalyticsService } from '@/lib/services/analytics-service.ts';
import { IdempotencyService } from '@/lib/reliability/idempotency.ts';
import { UserRole, RequestStatus, ApprovalStatus, ApprovalDecision, TaskStatus, Priority } from '@prisma/client';

export async function GET(req: NextRequest) {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  const record = (category: string, name: string, condition: boolean, note?: string) => {
    results.push({ category, name, passed: Boolean(condition), note });
  };

  try {
    // 0. Setup actors
    let requester = await prisma.user.findFirst({ where: { role: UserRole.REQUESTER } });
    if (!requester) {
      requester = await prisma.user.create({
        data: {
          name: 'Sarah Requester',
          email: `browser.m10.req.${Date.now()}@corp.internal`,
          role: UserRole.REQUESTER,
          department: 'Operations',
        },
      });
    }

    let operator = await prisma.user.findFirst({ where: { role: UserRole.OPERATOR, department: 'Procurement' } });
    if (!operator) {
      operator = await prisma.user.create({
        data: {
          name: 'John Procurement Operator',
          email: `browser.m10.op.${Date.now()}@corp.internal`,
          role: UserRole.OPERATOR,
          department: 'Procurement',
        },
      });
    }

    let manager = await prisma.user.findFirst({ where: { role: UserRole.MANAGER } });
    if (!manager) {
      manager = await prisma.user.create({
        data: {
          name: 'Ellen Ripley Manager',
          email: `browser.m10.mgr.${Date.now()}@corp.internal`,
          role: UserRole.MANAGER,
          department: 'Procurement',
        },
      });
    }

    // 1. Happy Path E2E
    const baselineMetrics = await AnalyticsService.getOperationsMetrics();
    const baselineCompleted = baselineMetrics.completedRequests;

    const testReq = await RequestService.createRequest({
      title: 'Browser Onboard Acme Ltd',
      description: 'We need to onboard Acme Ltd as a supplier. Please verify the company documents and get manager approval before creating the vendor record.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'BROWSER_E2E',
    }, false);

    record('Intake & Storage', 'Request validated and stored with UUID', Boolean(testReq.id));
    record('Intake & Storage', 'Initial status is strictly NEW', testReq.status === RequestStatus.NEW);
    record('SLA Calculation', 'SLA deadline due_at calculated automatically', Boolean(testReq.due_at));

    const aiExtraction = await AiClassifierService.classifyAndStore(
      testReq.id,
      testReq.title,
      testReq.description,
      requester.id
    );
    record('AI Extraction', 'Classified as VENDOR_ONBOARDING', aiExtraction.record.request_type === 'VENDOR_ONBOARDING');
    record('AI Extraction', 'Suggested department is procurement', aiExtraction.record.suggested_department === 'procurement');
    record('AI Extraction', 'Extracted companyName Acme Ltd', (aiExtraction.record.entities as any)?.companyName === 'Acme Ltd');

    const wfExecution = await WorkflowEngine.initiateWorkflow(testReq.id, requester.id);
    record('Workflow Resolution', 'Resolved to vendor_onboarding', wfExecution.workflow?.id === 'vendor_onboarding');

    const afterInitReq = await RequestService.getRequestById(testReq.id);
    record('Workflow Execution', 'Status transitioned to PROCESSING', afterInitReq?.status === RequestStatus.PROCESSING);

    const tasks = await prisma.task.findMany({ where: { request_id: testReq.id }, orderBy: { created_at: 'asc' } });
    record('Task Generation', 'Initial review tasks created', tasks.length === 2);

    for (const t of tasks) {
      await WorkflowEngine.completeTaskAndAdvance(t.id, operator.id);
    }

    const awaitingApprovalReq = await RequestService.getRequestById(testReq.id);
    record('Approval Gateway', 'Status transitioned to AWAITING_APPROVAL', awaitingApprovalReq?.status === RequestStatus.AWAITING_APPROVAL);

    const pendingApprovals = await prisma.approval.findMany({ where: { request_id: testReq.id } });
    record('Approval Gateway', 'Pending approval record exists', pendingApprovals.length === 1 && pendingApprovals[0].status === ApprovalStatus.PENDING);

    const approvalDecision = await WorkflowEngine.decideApproval(
      pendingApprovals[0].id,
      ApprovalDecision.APPROVED,
      manager.id,
      'Documents verified in browser.'
    );
    record('Manager Decision', 'Approval status DECIDED / APPROVED', approvalDecision.approval.status === ApprovalStatus.DECIDED && approvalDecision.approval.decision === 'APPROVED');
    record('Workflow Advancement', 'Request status moved to IN_PROGRESS', approvalDecision.requestStatus === RequestStatus.IN_PROGRESS);

    const allTasksAfterApproval = await prisma.task.findMany({ where: { request_id: testReq.id } });
    const finalTask = allTasksAfterApproval.find((t) => t.title.includes('Create vendor'));
    record('Post-Approval Tasks', 'Post-approval task spawned automatically', Boolean(finalTask));

    if (finalTask) {
      await WorkflowEngine.completeTaskAndAdvance(finalTask.id, operator.id);
    }
    const completedReq = await RequestService.getRequestById(testReq.id);
    record('Resolution', 'Request reached COMPLETED status', completedReq?.status === RequestStatus.COMPLETED);

    // Verify analytics updated
    const postE2eMetrics = await AnalyticsService.getOperationsMetrics();
    record('Analytics KPIs', 'Completed requests metric incremented', postE2eMetrics.completedRequests === baselineCompleted + 1);
    record('Analytics KPIs', 'Average processing time computed', typeof postE2eMetrics.averageProcessingTimeHours === 'number');

    // Negative branch: duplicate events
    const dedupeId = `evt_browser_m10_${Date.now()}`;
    let runs = 0;
    const r1 = await IdempotencyService.runIdempotent(dedupeId, 'PING', {}, async () => { runs++; return { done: true }; });
    const r2 = await IdempotencyService.runIdempotent(dedupeId, 'PING', {}, async () => { runs++; return { done: true }; });
    record('Reliability', 'Duplicate external webhook deduplicated', r1.cached === false && r2.cached === true && runs === 1);

    // Negative branch: terminal state machine protection
    let blockedTerminal = false;
    try {
      await RequestService.transitionStatus(completedReq!.id, RequestStatus.PROCESSING, operator.id);
    } catch (err: any) {
      blockedTerminal = err instanceof ClosedRequestModificationError || err.message.includes('terminal state');
    }
    record('State Machine Invariants', 'Terminal COMPLETED status cannot transition back', blockedTerminal);

    const allPassed = results.every((r) => r.passed);
    return NextResponse.json({
      success: allPassed,
      passedCount: results.filter((r) => r.passed).length,
      totalCount: results.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
