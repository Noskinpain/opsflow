import { prisma } from '../lib/prisma.ts';
import { UserRole, RequestStatus, TaskStatus, ApprovalStatus, ApprovalDecision } from '@prisma/client';
import { RequestService } from '../lib/services/request-service.ts';
import { TaskService } from '../lib/services/task-service.ts';
import { WorkflowEngine } from '../lib/workflows/engine.ts';
import { getWorkflow, listWorkflows } from '../lib/workflows/registry.ts';
import { DepartmentRouter } from '../lib/workflows/router.ts';

async function runMilestoneSixTests() {
  await prisma.$connect();
  console.log('\n=============================================================');
  console.log('  MILESTONE 6: WORKFLOW ENGINE & AUTOMATIC ROUTING TEST SUITE ');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // 1. WORKFLOW REGISTRY & RESOLVER EXTENSIBILITY
  // -------------------------------------------------------------
  console.log('--- 1. Testing Workflow Definitions & Resolver ---');

  const vendorWf = getWorkflow('vendor_onboarding');
  assert(vendorWf.id === 'vendor_onboarding', 'Resolves vendor_onboarding workflow');
  assert(vendorWf.initialTasks.length >= 2, 'Vendor workflow defines initial tasks (Verify docs, Review)');
  assert(vendorWf.approvalConfig.required === true, 'Vendor workflow requires manager approval');
  assert(vendorWf.postApprovalTasks.length >= 1, 'Vendor workflow defines post-approval tasks (Create vendor)');

  const purchaseWf = getWorkflow('purchase_request');
  assert(purchaseWf.id === 'purchase_request', 'Resolves purchase_request workflow');
  assert(purchaseWf.targetDepartment === 'Procurement', 'Purchase request targets Procurement');

  const itWf = getWorkflow('it_access');
  assert(itWf.id === 'it_access', 'Resolves it_access workflow');
  assert(itWf.targetDepartment === 'IT', 'IT access workflow targets IT department');

  const fallbackWf = getWorkflow('non_existent_request_type');
  assert(fallbackWf.id === 'general_ops', 'Gracefully falls back to general_ops workflow');

  const allWorkflows = listWorkflows();
  assert(allWorkflows.length >= 5, 'Workflow registry exposes at least 5 workflow definitions');

  // -------------------------------------------------------------
  // 2. DETERMINISTIC ROUTING RULES
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Deterministic Routing Rules ---');

  assert(DepartmentRouter.getDepartment('vendor_onboarding') === 'Procurement', 'Routes vendor_onboarding -> Procurement');
  assert(DepartmentRouter.getDepartment('purchase_request') === 'Procurement', 'Routes purchase_request -> Procurement');
  assert(DepartmentRouter.getDepartment('it_access') === 'IT', 'Routes it_access -> IT');
  assert(DepartmentRouter.getDepartment('contract_review') === 'Legal', 'Routes contract_review -> Legal');
  assert(DepartmentRouter.getDepartment('facilities_request') === 'Facilities', 'Routes facilities_request -> Facilities');
  assert(DepartmentRouter.getDepartment('employee_request') === 'HR', 'Routes employee_request -> HR');

  // -------------------------------------------------------------
  // 3. SEED USERS FOR END-TO-END EXECUTION
  // -------------------------------------------------------------
  console.log('\n--- 3. Setting Up Test Actors ---');

  const requester = await prisma.user.upsert({
    where: { email: 'alice.ops.m6@example.com' },
    update: {},
    create: {
      name: 'Alice Requester',
      email: 'alice.ops.m6@example.com',
      role: UserRole.REQUESTER,
      department: 'Operations',
    },
  });

  const procurementOperator = await prisma.user.upsert({
    where: { email: 'john.procurement.m6@example.com' },
    update: {},
    create: {
      name: 'John Procurement',
      email: 'john.procurement.m6@example.com',
      role: UserRole.OPERATOR,
      department: 'Procurement',
    },
  });

  const procurementManager = await prisma.user.upsert({
    where: { email: 'ellen.manager.m6@example.com' },
    update: {},
    create: {
      name: 'Ellen Ripley',
      email: 'ellen.manager.m6@example.com',
      role: UserRole.MANAGER,
      department: 'Procurement',
    },
  });

  assert(Boolean(requester && procurementOperator && procurementManager), 'Actors provisioned (Requester, Operator, Manager)');

  // -------------------------------------------------------------
  // 4. END-TO-END EXECUTION: THE FULL MILESTONE 6 FLOW
  // -------------------------------------------------------------
  console.log('\n--- 4. Running Complete End-to-End Workflow Execution ---');
  console.log('  Scenario: "Please onboard Acme Ltd. CAC and tax documents are attached."\n');

  // Step 1: Submit Request Intake (REQUEST_CREATED)
  const req = await RequestService.createRequest({
    title: 'Onboard Acme Ltd Supplier',
    description: 'Please onboard Acme Ltd. CAC and tax documents are attached.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'M6_END_TO_END_TEST',
  });

  assert(req.status === RequestStatus.NEW, 'Step 1: Request created with status NEW');

  // Step 2 & 3: Initiate Workflow (AI -> ROUTE -> WORKFLOW_CREATED -> TASK_CREATED)
  const workflowInit = await WorkflowEngine.initiateWorkflow(req.id, requester.id);

  assert(workflowInit.targetDepartment === 'Procurement', 'Step 2: DepartmentRouter deterministically routes to Procurement');
  assert(workflowInit.operator?.department === 'Procurement' && workflowInit.operator?.role === UserRole.OPERATOR, 'Step 3: Assigned to eligible Procurement operator');
  assert((workflowInit as any).workflow?.id === 'vendor_onboarding', 'Step 4: Resolved to Vendor Onboarding Workflow');

  // Verify status moved to PROCESSING
  const reqStep2 = await RequestService.getRequestById(req.id);
  assert(reqStep2.status === RequestStatus.PROCESSING, 'Step 5: Request status automatically moved to PROCESSING');

  // Step 4: Automatically created tasks
  const initialTasks = reqStep2.tasks;
  assert(initialTasks.length === 2, 'Step 6: Automatically generated 2 initial tasks');
  assert(initialTasks.some((t) => t.title.toLowerCase().includes('verify')), 'Task 1: Verify company documents created');
  assert(initialTasks.some((t) => t.title.toLowerCase().includes('review')), 'Task 2: Procurement review created');

  // Step 5: Complete Review Tasks (Task 1 & Task 2)
  console.log('\n  [Executing Initial Tasks]');
  const task1 = initialTasks[0];
  const task2 = initialTasks[1];

  await WorkflowEngine.completeTaskAndAdvance(task1.id, procurementOperator.id);
  assert(true, 'Completed Task 1: "Verify company documents"');

  // Completing task 2 triggers stage evaluation and requires approval
  const task2Result = await WorkflowEngine.completeTaskAndAdvance(task2.id, procurementOperator.id);
  assert(task2Result.stage === 'APPROVAL_REQUIRED', 'Step 7: All review tasks finished; engine evaluated stage as APPROVAL_REQUIRED');

  // Verify Request transitioned to AWAITING_APPROVAL
  const reqStep3 = await RequestService.getRequestById(req.id);
  assert(reqStep3.status === RequestStatus.AWAITING_APPROVAL, 'Step 8: Request status moved to AWAITING_APPROVAL');

  // Verify Approval record created for Manager
  const pendingApproval = reqStep3.approvals.find((a) => a.status === ApprovalStatus.PENDING);
  assert(Boolean(pendingApproval), 'Step 9: Approval record created in database');
  assert(pendingApproval?.approver_id === procurementManager.id, 'Step 10: Approval routed to Manager (Ellen Ripley)');

  // Step 6: Manager Approval Decision (APPROVAL_COMPLETED -> WORKFLOW_ADVANCED)
  console.log('\n  [Manager Approval]');
  const approvalDecisionResult = await WorkflowEngine.decideApproval(
    pendingApproval!.id,
    ApprovalDecision.APPROVED,
    procurementManager.id,
    'All documents verified; approved for vendor record setup.'
  );

  assert(approvalDecisionResult.requestStatus === RequestStatus.IN_PROGRESS, 'Step 11: Upon approval, request transitioned to IN_PROGRESS');
  assert(Boolean(approvalDecisionResult.spawnedTasks && approvalDecisionResult.spawnedTasks.length === 1), 'Step 12: Engine automatically spawned post-approval task');
  assert(
    approvalDecisionResult.spawnedTasks?.[0].title.toLowerCase().includes('create vendor') ?? false,
    'Task 3: "Create vendor record" automatically generated'
  );

  // Step 7: Complete Final Execution Task (Task 3)
  console.log('\n  [Executing Final Task: Create Vendor Record]');
  const task3 = approvalDecisionResult.spawnedTasks![0];
  const task3Result = await WorkflowEngine.completeTaskAndAdvance(task3.id, procurementOperator.id);

  assert(task3Result.stage === 'COMPLETED', 'Step 13: Final task executed; engine evaluated workflow stage as COMPLETED');

  // Verify Request is now COMPLETED
  const finalReq = await RequestService.getRequestById(req.id);
  assert(finalReq.status === RequestStatus.COMPLETED, 'Step 14: Request transitioned to COMPLETED status');

  // -------------------------------------------------------------
  // 5. VERIFY COMPLETE EVENT-DRIVEN AUDIT TIMELINE
  // -------------------------------------------------------------
  console.log('\n--- 5. Verifying Unified Event-Driven Audit Timeline ---');

  const events = await prisma.activityEvent.findMany({
    where: { request_id: req.id },
    orderBy: { created_at: 'asc' },
  });

  const eventTypes = events.map((e) => e.event_type);

  assert(eventTypes.includes('REQUEST_CREATED'), 'Audit timeline includes REQUEST_CREATED');
  assert(eventTypes.includes('REQUEST_ASSIGNED'), 'Audit timeline includes REQUEST_ASSIGNED');
  assert(eventTypes.includes('WORKFLOW_CREATED'), 'Audit timeline includes WORKFLOW_CREATED');
  assert(eventTypes.includes('TASK_CREATED'), 'Audit timeline includes TASK_CREATED');
  assert(eventTypes.includes('TASK_COMPLETED'), 'Audit timeline includes TASK_COMPLETED');
  assert(eventTypes.includes('APPROVAL_REQUIRED'), 'Audit timeline includes APPROVAL_REQUIRED');
  assert(eventTypes.includes('APPROVAL_COMPLETED'), 'Audit timeline includes APPROVAL_COMPLETED');
  assert(eventTypes.includes('WORKFLOW_ADVANCED'), 'Audit timeline includes WORKFLOW_ADVANCED');
  assert(eventTypes.includes('WORKFLOW_COMPLETED'), 'Audit timeline includes WORKFLOW_COMPLETED');

  console.log('\n=============================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failed === 0) {
    console.log('🎉 MILESTONE 6: WORKFLOW ENGINE & AUTOMATIC ROUTING FULLY VERIFIED!\n');
  } else {
    process.exit(1);
  }
}

runMilestoneSixTests()
  .catch((e) => {
    console.error('Test suite error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
