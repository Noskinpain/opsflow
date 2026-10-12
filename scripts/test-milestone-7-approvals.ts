import { prisma } from '../lib/prisma.ts';
import { UserRole, RequestStatus, TaskStatus, ApprovalStatus, ApprovalDecision, Priority } from '@prisma/client';
import { WorkflowEngine } from '../lib/workflows/engine.ts';
import { RequestService } from '../lib/services/request-service.ts';
import { TaskService } from '../lib/services/task-service.ts';
import { getWorkflow } from '../lib/workflows/registry.ts';
import {
  UnauthorizedApproverError,
  ApprovalAlreadyDecidedError,
  InvalidApprovalStateError,
} from '../lib/errors.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
    failed++;
  }
}

async function expectThrowsAsync(fn: () => Promise<any>, expectedErrorName: string, testName: string) {
  try {
    await fn();
    console.error(`  ✗ FAIL: ${testName} (Expected ${expectedErrorName} but no error was thrown)`);
    failed++;
  } catch (error: any) {
    if (error.name === expectedErrorName || error.constructor.name === expectedErrorName) {
      console.log(`  ✓ PASS: ${testName} (Caught expected ${expectedErrorName})`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} (Expected ${expectedErrorName}, but got ${error.name}: ${error.message})`);
      failed++;
    }
  }
}

async function main() {
  console.log('\n========================================================================');
  console.log('   MILESTONE 7: APPROVALS & HUMAN-IN-THE-LOOP AUTOMATED TEST SUITE      ');
  console.log('========================================================================\n');

  try {
    // ------------------------------------------------------------------------
    // SETUP: Test Users
    // ------------------------------------------------------------------------
    console.log('--- 1. Setting up Test Users and Hierarchy ---');
    const timestamp = Date.now();

    const requester = await prisma.user.create({
      data: {
        name: `David Requester ${timestamp}`,
        email: `david.req.${timestamp}@corp.internal`,
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const operator = await prisma.user.create({
      data: {
        name: `Alice Operator ${timestamp}`,
        email: `alice.proc.${timestamp}@corp.internal`,
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    const manager = await prisma.user.create({
      data: {
        name: `Carol Manager ${timestamp}`,
        email: `carol.mgr.${timestamp}@corp.internal`,
        role: UserRole.MANAGER,
        department: 'Procurement',
      },
    });

    const unauthorizedUser = await prisma.user.create({
      data: {
        name: `Bob Operator ${timestamp}`,
        email: `bob.operator.${timestamp}@corp.internal`,
        role: UserRole.OPERATOR,
        department: 'IT',
      },
    });

    assert(Boolean(requester && operator && manager && unauthorizedUser), 'Test users successfully created');

    // ------------------------------------------------------------------------
    // SECTION 1: WORKFLOW APPROVAL DEFINITIONS & CONTRACTS
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Validating Approval Configuration Contracts ---');
    const vendorWf = getWorkflow('VENDOR_ONBOARDING');
    assert(vendorWf.approvalConfig.required === true, 'Vendor onboarding workflow requires manager approval');
    assert(vendorWf.approvalConfig.approverRole === UserRole.MANAGER, 'Vendor onboarding specifies MANAGER approver role');
    assert(vendorWf.approvalConfig.minConfidence === 0.80, 'Vendor onboarding specifies 0.80 minimum AI confidence');
    assert(Boolean(vendorWf.approvalConfig.verificationItems?.length), 'Vendor onboarding defines required document verification items');
    assert(vendorWf.postApprovalTasks.length > 0, 'Vendor onboarding defines postApprovalTasks ("Create vendor record")');

    const poWf = getWorkflow('PURCHASE_ORDER');
    assert(poWf.approvalConfig.required === true, 'Purchase order workflow requires approval');
    assert(poWf.approvalConfig.amountThreshold === 1000, 'Purchase order specifies financial approval threshold');

    // ------------------------------------------------------------------------
    // SECTION 2: END-TO-END HAPPY PATH APPROVAL LIFECYCLE
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Testing Happy Path Manager Approval & Workflow Advancement ---');
    const req1 = await RequestService.createRequest({
      title: `Onboard Alpha Supplies Ltd [${timestamp}]`,
      description: 'Vendor onboarding with CAC certificate and tax documents attached.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    assert(req1.status === RequestStatus.NEW, 'Request 1 created in NEW status');

    // AI Classification (High Confidence 0.95 >= 0.80)
    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req1.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.HIGH,
        summary: 'Vendor onboarding for Alpha Supplies Ltd',
        suggested_department: 'procurement',
        confidence: 0.95,
        entities: { companyName: 'Alpha Supplies Ltd' },
        documents_mentioned: ['CAC certificate', 'tax documents'],
        missing_information: [],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    // Initiate workflow
    const init1 = await WorkflowEngine.initiateWorkflow(req1.id, requester.id);
    assert(init1.stage !== 'AWAITING_REVIEW', 'High confidence request bypassed review and initiated workflow');

    const req1AfterInit = await RequestService.getRequestById(req1.id);
    assert(req1AfterInit.status === RequestStatus.PROCESSING, 'Request status transitioned NEW -> PROCESSING');

    const initialTasks = await TaskService.listTasksByRequest(req1.id);
    assert(initialTasks.length === 2, 'Initial review tasks created (Verify company documents, Procurement review)');

    // Complete review tasks to reach approval gateway
    for (const task of initialTasks) {
      await WorkflowEngine.completeTaskAndAdvance(task.id, operator.id);
    }

    const req1AtApproval = await RequestService.getRequestById(req1.id);
    assert(req1AtApproval.status === RequestStatus.AWAITING_APPROVAL, 'Request status transitioned to AWAITING_APPROVAL after tasks completed');

    const pendingApproval1 = req1AtApproval.approvals.find((a) => a.status === ApprovalStatus.PENDING);
    assert(Boolean(pendingApproval1), 'Pending approval record created for manager');
    assert(
      pendingApproval1?.status === ApprovalStatus.PENDING && req1AtApproval.status === RequestStatus.AWAITING_APPROVAL,
      'Crucial Invariant: approval status (PENDING) != request status (AWAITING_APPROVAL)'
    );

    // ------------------------------------------------------------------------
    // SECTION 3: STRICT SERVER-SIDE AUTHORIZATION & INVARIANT CHECKS
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Testing Authorization & State Invariants ---');

    // Invariant A: Non-manager / unauthorized operator cannot approve
    await expectThrowsAsync(
      () => WorkflowEngine.decideApproval(pendingApproval1!.id, ApprovalDecision.APPROVED, unauthorizedUser.id, 'Illegal attempt'),
      'UnauthorizedApproverError',
      'Unauthorized non-manager cannot approve (UnauthorizedApproverError)'
    );

    // Invariant B: Requester cannot self-approve their own operational request (Separation of duties)
    await expectThrowsAsync(
      () => WorkflowEngine.decideApproval(pendingApproval1!.id, ApprovalDecision.APPROVED, requester.id, 'Self approval attempt'),
      'UnauthorizedApproverError',
      'Requester cannot self-approve own request (Separation of duties invariant)'
    );

    // Invariant C: Cannot decide approval when request is not in AWAITING_APPROVAL state
    await prisma.request.update({
      where: { id: req1.id },
      data: { status: RequestStatus.PROCESSING },
    });
    await expectThrowsAsync(
      () => WorkflowEngine.decideApproval(pendingApproval1!.id, ApprovalDecision.APPROVED, manager.id, 'Should fail in PROCESSING'),
      'InvalidApprovalStateError',
      'Cannot decide approval when request is not in AWAITING_APPROVAL (InvalidApprovalStateError)'
    );
    // Restore request status
    await prisma.request.update({
      where: { id: req1.id },
      data: { status: RequestStatus.AWAITING_APPROVAL },
    });

    // ------------------------------------------------------------------------
    // SECTION 4: MANAGER APPROVAL ADVANCES WORKFLOW & SPAWNS TASKS
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Testing Manager Approval Execution & Downstream Tasks ---');
    const approvalResult = await WorkflowEngine.decideApproval(
      pendingApproval1!.id,
      ApprovalDecision.APPROVED,
      manager.id,
      'Documents verified: CAC certificate and Tax clearance validated.'
    );

    assert(approvalResult.approval.status === ApprovalStatus.DECIDED, 'Approval status updated to DECIDED');
    assert(approvalResult.approval.decision === ApprovalDecision.APPROVED, 'Approval decision recorded as APPROVED');
    assert(approvalResult.requestStatus === RequestStatus.IN_PROGRESS, 'Request status transitioned AWAITING_APPROVAL -> IN_PROGRESS');
    assert(Boolean(approvalResult.spawnedTasks?.length), 'Post-approval task "Create vendor record" automatically spawned');

    // Invariant D: Cannot decide already decided approval
    await expectThrowsAsync(
      () => WorkflowEngine.decideApproval(pendingApproval1!.id, ApprovalDecision.REJECTED, manager.id, 'Duplicate decision'),
      'ApprovalAlreadyDecidedError',
      'Cannot re-decide already decided approval (ApprovalAlreadyDecidedError)'
    );

    // Complete the post-approval task to reach completion
    const postTasks = await TaskService.listTasksByRequest(req1.id);
    const createVendorTask = postTasks.find((t) => t.title === 'Create vendor record');
    assert(Boolean(createVendorTask), 'Execution task "Create vendor record" is present');

    await WorkflowEngine.completeTaskAndAdvance(createVendorTask!.id, operator.id);
    const req1Completed = await RequestService.getRequestById(req1.id);
    assert(req1Completed.status === RequestStatus.COMPLETED, 'Request status reaches COMPLETED after all post-approval tasks done');

    // ------------------------------------------------------------------------
    // SECTION 5: REJECTION FLOW HALTS WORKFLOW & CANCELS TASKS
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Testing Manager Rejection Flow & Task Cancellation ---');
    const req2 = await RequestService.createRequest({
      title: `Onboard Risky Corp [${timestamp}]`,
      description: 'Vendor onboarding request with fake tax documents.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req2.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.HIGH,
        summary: 'Vendor onboarding for Risky Corp',
        suggested_department: 'procurement',
        confidence: 0.95,
        entities: { companyName: 'Risky Corp' },
        documents_mentioned: ['CAC document'],
        missing_information: [],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    await WorkflowEngine.initiateWorkflow(req2.id, requester.id);
    const req2Tasks = await TaskService.listTasksByRequest(req2.id);
    for (const t of req2Tasks) {
      await WorkflowEngine.completeTaskAndAdvance(t.id, operator.id);
    }

    const req2AtApproval = await RequestService.getRequestById(req2.id);
    const pendingApproval2 = req2AtApproval.approvals.find((a) => a.status === ApprovalStatus.PENDING);

    const rejectResult = await WorkflowEngine.decideApproval(
      pendingApproval2!.id,
      ApprovalDecision.REJECTED,
      manager.id,
      'Rejected: Documents failed tax compliance verification.'
    );

    assert(rejectResult.approval.status === ApprovalStatus.DECIDED, 'Rejection: Approval status is DECIDED');
    assert(rejectResult.approval.decision === ApprovalDecision.REJECTED, 'Rejection: Approval decision is REJECTED');
    assert(rejectResult.requestStatus === RequestStatus.REJECTED, 'Rejection: Request status transitioned AWAITING_APPROVAL -> REJECTED');

    const req2TasksAfter = await TaskService.listTasksByRequest(req2.id);
    const anyOpenTasks = req2TasksAfter.some((t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS);
    assert(!anyOpenTasks, 'Rejection: All remaining pending tasks were cancelled');

    // ------------------------------------------------------------------------
    // SECTION 6: HUMAN-IN-THE-LOOP FOR UNCERTAIN AI CLASSIFICATION
    // ------------------------------------------------------------------------
    console.log('\n--- 7. Testing Human-in-the-Loop for Uncertain AI Classification ---');
    const req3 = await RequestService.createRequest({
      title: `Ambiguous intake note [${timestamp}]`,
      description: 'Could we get some tools or items ordered for office cleanup?',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'LOW',
      requester_id: requester.id,
      source: 'TEST_M7',
    });

    // Low confidence AI classification (0.62 < 0.80 threshold)
    await prisma.requestAiAnalysis.create({
      data: {
        request_id: req3.id,
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.LOW,
        summary: 'Uncertain request with missing details',
        suggested_department: 'procurement',
        confidence: 0.62,
        entities: {},
        documents_mentioned: [],
        missing_information: ['Clarify purpose'],
        is_actionable: true,
        model_name: 'test-rules-engine',
      },
    });

    // Workflow Engine evaluates confidence
    const uncertainInit = await WorkflowEngine.initiateWorkflow(req3.id, requester.id);
    assert(uncertainInit.stage === 'AWAITING_REVIEW', 'Uncertain AI classification (< 0.80) triggered AWAITING_REVIEW stage');
    assert(uncertainInit.confidence === 0.62, 'Uncertain AI returned confidence 0.62');

    const req3Check = await RequestService.getRequestById(req3.id);
    assert(req3Check.status === RequestStatus.AWAITING_REVIEW, 'Request held in AWAITING_REVIEW status');
    assert(req3Check.tasks.length === 0, 'No automated tasks created while awaiting human review');

    // Human operator reviews, corrects classification, and confirms
    const confirmResult = await WorkflowEngine.confirmClassification(req3.id, {
      confirmedRequestType: 'GENERAL_OPS',
      confirmedDepartment: 'Operations',
      actorId: operator.id,
      comment: 'Triaged and reclassified to General Operations by human operator.',
    });

    assert(confirmResult.stage !== 'AWAITING_REVIEW', 'Human confirmation transitioned request out of AWAITING_REVIEW');

    const req3AfterConfirmation = await RequestService.getRequestById(req3.id);
    assert(req3AfterConfirmation.request_type === 'GENERAL_OPS', 'Request type successfully updated to GENERAL_OPS');
    assert(req3AfterConfirmation.tasks.length > 0, 'Workflow tasks generated after human confirmation');

    // ------------------------------------------------------------------------
    // SECTION 7: AUDIT EVENTS VERIFICATION
    // ------------------------------------------------------------------------
    console.log('\n--- 8. Verifying Defensible Audit Trail ---');
    const req1Events = await prisma.activityEvent.findMany({
      where: { request_id: req1.id },
      orderBy: { created_at: 'asc' },
    });
    const req1Types = req1Events.map((e) => e.event_type);
    assert(req1Types.includes('APPROVAL_REQUESTED'), 'Audit trail: APPROVAL_REQUESTED event logged');
    assert(req1Types.includes('APPROVAL_APPROVED'), 'Audit trail: APPROVAL_APPROVED event logged');
    assert(req1Types.includes('WORKFLOW_ADVANCED'), 'Audit trail: WORKFLOW_ADVANCED event logged');

    const req2Events = await prisma.activityEvent.findMany({
      where: { request_id: req2.id },
      orderBy: { created_at: 'asc' },
    });
    const req2Types = req2Events.map((e) => e.event_type);
    assert(req2Types.includes('APPROVAL_REJECTED'), 'Audit trail: APPROVAL_REJECTED event logged');
    assert(req2Types.includes('WORKFLOW_REJECTED'), 'Audit trail: WORKFLOW_REJECTED event logged');

    const req3Events = await prisma.activityEvent.findMany({
      where: { request_id: req3.id },
      orderBy: { created_at: 'asc' },
    });
    const req3Types = req3Events.map((e) => e.event_type);
    assert(req3Types.includes('HUMAN_REVIEW_REQUIRED'), 'Audit trail: HUMAN_REVIEW_REQUIRED event logged for uncertain AI');
    assert(req3Types.includes('CLASSIFICATION_OVERRIDDEN'), 'Audit trail: CLASSIFICATION_OVERRIDDEN event logged');
    assert(req3Types.includes('CLASSIFICATION_CONFIRMED'), 'Audit trail: CLASSIFICATION_CONFIRMED event logged');

    console.log('\n========================================================================');
    console.log(`  MILESTONE 7 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error running Milestone 7 tests:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
