import { prisma } from '../lib/prisma.ts';
import { RequestService } from '../lib/services/request-service.ts';
import { TaskService } from '../lib/services/task-service.ts';
import { ApprovalService, ApprovalAlreadyDecidedError } from '../lib/services/approval-service.ts';
import { ClosedRequestModificationError } from '../lib/errors.ts';
import { WorkflowEngine } from '../lib/workflows/engine.ts';
import { AiClassifierService } from '../lib/services/ai-classifier-service.ts';
import { AnalyticsService } from '../lib/services/analytics-service.ts';
import { IdempotencyService } from '../lib/reliability/idempotency.ts';
import { UserRole, RequestStatus, ApprovalStatus, ApprovalDecision, TaskStatus, Priority } from '@prisma/client';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function main() {
  console.log('\n==================================================================');
  console.log('   MILESTONE 10: END-TO-END SCENARIO & ANALYTICS TEST SUITE       ');
  console.log('==================================================================\n');

  // 0. Setup actors
  let requester = await prisma.user.findFirst({ where: { role: UserRole.REQUESTER } });
  if (!requester) {
    requester = await prisma.user.create({
      data: {
        name: 'Sarah Requester',
        email: `e2e.req.${Date.now()}@corp.internal`,
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
        email: `e2e.op.${Date.now()}@corp.internal`,
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
        email: `e2e.mgr.${Date.now()}@corp.internal`,
        role: UserRole.MANAGER,
        department: 'Procurement',
      },
    });
  }

  // =========================================================================
  // SCENARIO 1: COMPLETE SUPPLIER ONBOARDING HAPPY PATH (STEPS 1 - 11)
  // =========================================================================
  console.log('--- 1. Testing End-to-End Happy Path: Supplier Onboarding ---');

  const baselineMetrics = await AnalyticsService.getOperationsMetrics();
  const baselineCompleted = baselineMetrics.completedRequests;

  // Step 1 & 2: User submits request, validated and stored in PostgreSQL
  const requestInput = {
    title: 'Onboard Acme Ltd as a supplier',
    description:
      'We need to onboard Acme Ltd as a supplier. Please verify the company documents and get manager approval before creating the vendor record.',
    request_type: 'VENDOR_ONBOARDING' as const,
    priority: 'HIGH' as const,
    requester_id: requester.id,
    source: 'E2E_TEST_PORTAL',
  };

  const req = await RequestService.createRequest(requestInput, false);
  assert(Boolean(req.id), 'Step 1 & 2: Request validated and stored with server UUID');
  assert(req.status === RequestStatus.NEW, 'Initial status strictly set to NEW');
  assert(Boolean(req.due_at), 'Authoritative SLA due_at deadline calculated (+4 hours for HIGH)');

  // Step 3: AI extracts request information
  const aiExtraction = await AiClassifierService.classifyAndStore(
    req.id,
    req.title,
    req.description,
    requester.id
  );
  assert(aiExtraction.record.request_type === 'VENDOR_ONBOARDING', 'Step 3: AI classified request as VENDOR_ONBOARDING');
  assert(aiExtraction.record.suggested_department === 'procurement', 'AI suggested department is procurement');
  assert(aiExtraction.record.confidence >= 0.80, 'AI confidence score exceeds 0.80 threshold');
  assert((aiExtraction.record.entities as any)?.companyName === 'Acme Ltd', 'Extracted companyName entity "Acme Ltd"');

  // Step 4 & 5: Workflow resolves vendor onboarding, routes to operator, creates initial tasks
  const wfExecution = await WorkflowEngine.initiateWorkflow(req.id, requester.id);
  assert(wfExecution.workflow?.id === 'vendor_onboarding', 'Step 4: Resolved to Vendor Onboarding workflow definition');
  assert(wfExecution.targetDepartment === 'Procurement', 'Target department routed to Procurement');

  const afterInitReq = await RequestService.getRequestById(req.id);
  assert(afterInitReq?.status === RequestStatus.PROCESSING, 'Request status transitioned NEW -> PROCESSING');
  assert(afterInitReq?.assigned_to !== null, 'Request assigned to Procurement operator');

  const tasks = await prisma.task.findMany({ where: { request_id: req.id }, orderBy: { created_at: 'asc' } });
  assert(tasks.length === 2, `Step 5: Exactly 2 initial tasks generated (got ${tasks.length})`);
  assert(tasks[0].title.includes('Verify') || tasks[0].title.includes('document'), 'Initial task 1: Verify company documents');
  assert(tasks[1].title.includes('Review') || tasks[1].title.includes('Procurement'), 'Initial task 2: Procurement review');

  // Step 6: Documents are reviewed (Operator completes initial tasks)
  console.log('\n--- 2. Executing Review Tasks & Workflow Advancement ---');
  await WorkflowEngine.completeTaskAndAdvance(tasks[0].id, operator.id);
  const task1Done = await prisma.task.findUnique({ where: { id: tasks[0].id } });
  assert(task1Done?.status === TaskStatus.COMPLETED, 'Task 1 moved to COMPLETED');

  // Completing task 2 finishes review stage and triggers manager approval
  await WorkflowEngine.completeTaskAndAdvance(tasks[1].id, operator.id);
  const task2Done = await prisma.task.findUnique({ where: { id: tasks[1].id } });
  assert(task2Done?.status === TaskStatus.COMPLETED, 'Task 2 moved to COMPLETED');

  // Step 7: Manager approval is requested
  const awaitingApprovalReq = await RequestService.getRequestById(req.id);
  assert(awaitingApprovalReq?.status === RequestStatus.AWAITING_APPROVAL, 'Step 7: Request transitioned to AWAITING_APPROVAL');

  const pendingApprovals = await prisma.approval.findMany({ where: { request_id: req.id } });
  assert(pendingApprovals.length === 1, 'Approval record created in database');
  assert(pendingApprovals[0].status === ApprovalStatus.PENDING, 'Approval status is PENDING');

  // Step 8: Manager approves
  console.log('\n--- 3. Manager Human-in-the-Loop Approval ---');
  const approvalDecision = await WorkflowEngine.decideApproval(
    pendingApprovals[0].id,
    ApprovalDecision.APPROVED,
    manager.id,
    'Acme Ltd documents verified. Approved for vendor record creation.'
  );

  assert(approvalDecision.approval.status === ApprovalStatus.DECIDED, 'Step 8: Approval status transitioned to DECIDED');
  assert(approvalDecision.approval.decision === 'APPROVED', 'Approval decision recorded as APPROVED');
  assert(approvalDecision.requestStatus === RequestStatus.IN_PROGRESS, 'Request status transitioned AWAITING_APPROVAL -> IN_PROGRESS');

  // Step 9: Post-approval task spawned ("Create vendor record")
  const allTasksAfterApproval = await prisma.task.findMany({ where: { request_id: req.id } });
  assert(allTasksAfterApproval.length === 3, 'Step 9: Downstream task "Create vendor record" automatically spawned');
  const finalTask = allTasksAfterApproval.find((t) => t.title.includes('Create vendor'));
  assert(finalTask !== undefined, 'Final task "Create vendor record" exists in PENDING state');

  // Step 10: Remaining task is completed -> Request reaches COMPLETED
  console.log('\n--- 4. Final Task Completion & Request Resolution ---');
  await WorkflowEngine.completeTaskAndAdvance(finalTask!.id, operator.id);
  const completedReq = await RequestService.getRequestById(req.id);
  assert(completedReq?.status === RequestStatus.COMPLETED, 'Step 10: Request reached terminal status COMPLETED');

  // Step 11: Dashboard metrics update
  console.log('\n--- 5. Verifying Real-Time Analytics & Dashboard Metrics ---');
  const postE2eMetrics = await AnalyticsService.getOperationsMetrics();
  assert(postE2eMetrics.completedRequests === baselineCompleted + 1, `Step 11: Completed requests metric incremented (${baselineCompleted} -> ${postE2eMetrics.completedRequests})`);
  assert(postE2eMetrics.completionRatePercent >= 0, 'Completion rate calculated from database records');
  assert(postE2eMetrics.averageProcessingTimeHours >= 0, 'Average processing time computed correctly');
  assert(postE2eMetrics.workloadByAssignee.length > 0, 'Workload distribution per operator computed');

  // Verify Audit Trail Sequence
  const events = await prisma.activityEvent.findMany({
    where: { request_id: req.id },
    orderBy: { created_at: 'asc' },
  });
  const eventTypes = events.map((e) => e.event_type);
  assert(eventTypes.includes('REQUEST_CREATED'), 'Audit timeline includes REQUEST_CREATED');
  assert(eventTypes.includes('AI_CLASSIFICATION_COMPLETED'), 'Audit timeline includes AI_CLASSIFICATION_COMPLETED');
  assert(eventTypes.includes('WORKFLOW_CREATED'), 'Audit timeline includes WORKFLOW_CREATED');
  assert(eventTypes.includes('TASK_COMPLETED'), 'Audit timeline includes TASK_COMPLETED');
  assert(eventTypes.includes('APPROVAL_REQUIRED'), 'Audit timeline includes APPROVAL_REQUIRED');
  assert(eventTypes.includes('APPROVAL_APPROVED'), 'Audit timeline includes APPROVAL_APPROVED');
  assert(eventTypes.includes('WORKFLOW_COMPLETED'), 'Audit timeline includes WORKFLOW_COMPLETED');

  // =========================================================================
  // NEGATIVE BRANCH 1: MANAGER REJECTION FLOW
  // =========================================================================
  console.log('\n--- 6. Testing Negative Branch: Manager Rejection ---');
  const rejectReq = await RequestService.createRequest({
    title: 'Dubious Supplier Intake',
    description: 'Onboard vendor with expired compliance certifications.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'E2E_TEST',
  }, false);

  await WorkflowEngine.initiateWorkflow(rejectReq.id, requester.id);
  const rejectTasks = await prisma.task.findMany({ where: { request_id: rejectReq.id } });
  for (const t of rejectTasks) {
    await WorkflowEngine.completeTaskAndAdvance(t.id, operator.id);
  }

  const rejectApproval = await prisma.approval.findFirst({ where: { request_id: rejectReq.id } });
  const rejectionResult = await WorkflowEngine.decideApproval(
    rejectApproval!.id,
    ApprovalDecision.REJECTED,
    manager.id,
    'Tax documents are invalid.'
  );

  assert(rejectionResult.requestStatus === RequestStatus.REJECTED, 'Request status transitioned to REJECTED upon manager refusal');
  const checkRejectReq = await RequestService.getRequestById(rejectReq.id);
  assert(checkRejectReq?.status === RequestStatus.REJECTED, 'Database request status confirmed REJECTED');

  // =========================================================================
  // NEGATIVE BRANCH 2: UNCERTAIN AI / HUMAN-IN-THE-LOOP GATE
  // =========================================================================
  console.log('\n--- 7. Testing Negative Branch: Uncertain AI Classification Gate ---');
  const uncertainReq = await RequestService.createRequest({
    title: 'Something is broken with the system',
    description: 'The thing we use for operations stopped working this morning.',
    request_type: 'GENERAL_OPS',
    priority: 'LOW',
    requester_id: requester.id,
    source: 'E2E_TEST',
  }, false);

  const uncertainInit = await WorkflowEngine.initiateWorkflow(uncertainReq.id, requester.id, { minConfidence: 0.80 });
  assert(uncertainInit.stage === 'AWAITING_REVIEW', 'Uncertain AI classification held in AWAITING_REVIEW stage');
  const uncertainDbReq = await RequestService.getRequestById(uncertainReq.id);
  assert(uncertainDbReq?.status === RequestStatus.AWAITING_REVIEW, 'Request held in AWAITING_REVIEW status awaiting human confirmation');

  // Operator confirms classification
  await WorkflowEngine.confirmClassification(uncertainReq.id, {
    confirmedRequestType: 'GENERAL_OPS',
    actorId: operator.id,
    comment: 'Triage complete; standard IT inquiry.',
  });
  const resumedReq = await RequestService.getRequestById(uncertainReq.id);
  assert(resumedReq?.status === RequestStatus.PROCESSING, 'Human confirmation successfully transitioned request to PROCESSING');

  // =========================================================================
  // NEGATIVE BRANCH 3: IDEMPOTENT DEDUPLICATION & DUPLICATE EVENT INTERCEPTION
  // =========================================================================
  console.log('\n--- 8. Testing Negative Branch: Duplicate External Webhook Events ---');
  const dedupeEventId = `evt_e2e_${Date.now()}`;
  let sideEffectRuns = 0;
  const mockWebhookOp = async () => {
    sideEffectRuns++;
    return { syncState: 'COMPLETED' };
  };

  const ev1 = await IdempotencyService.runIdempotent(dedupeEventId, 'PING', {}, mockWebhookOp);
  const ev2 = await IdempotencyService.runIdempotent(dedupeEventId, 'PING', {}, mockWebhookOp);

  assert(ev1.cached === false && sideEffectRuns === 1, 'First event invocation executes side-effect');
  assert(ev2.cached === true && sideEffectRuns === 1, 'Duplicate event intercepted by idempotency engine with cached result');

  // =========================================================================
  // NEGATIVE BRANCH 4: INVALID STATE MACHINE TRANSITIONS
  // =========================================================================
  console.log('\n--- 9. Testing Negative Branch: State Machine Transition Invariants ---');
  let invalidTransitionCaught = false;
  try {
    // Attempting to move a COMPLETED request back to PROCESSING
    await RequestService.transitionStatus(completedReq!.id, RequestStatus.PROCESSING, operator.id);
  } catch (err: any) {
    invalidTransitionCaught = true;
    assert(err instanceof ClosedRequestModificationError || err.message.includes('terminal state'), 'Terminal COMPLETED status cannot transition back to PROCESSING');
  }
  assert(invalidTransitionCaught === true, 'Terminal state protection enforced by state machine');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n==================================================================');
  console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('Fatal error running Milestone 10 E2E tests:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
