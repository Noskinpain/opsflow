import { PrismaClient, RequestStatus, Priority, UserRole } from '@prisma/client';
import { RequestService } from '../lib/services/request-service.ts';
import { canTransition } from '../lib/state-machine.ts';

const prisma = new PrismaClient();

async function runMilestoneThreeTests() {
  console.log('\n=============================================================');
  console.log('  MILESTONE 3: ASSIGNMENT & STATE MANAGEMENT TEST SUITE       ');
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

  // Setup test users
  const requester = await prisma.user.upsert({
    where: { email: 'requester.m3@example.com' },
    update: {},
    create: {
      name: 'Alice Requester',
      email: 'requester.m3@example.com',
      role: UserRole.REQUESTER,
      department: 'Operations',
    },
  });

  const johnProcurement = await prisma.user.upsert({
    where: { email: 'john.procurement@example.com' },
    update: {},
    create: {
      name: 'John Procurement',
      email: 'john.procurement@example.com',
      role: UserRole.OPERATOR,
      department: 'Procurement',
    },
  });

  const secondAssignee = await prisma.user.upsert({
    where: { email: 'sarah.compliance@example.com' },
    update: {},
    create: {
      name: 'Sarah Compliance',
      email: 'sarah.compliance@example.com',
      role: UserRole.OPERATOR,
      department: 'Compliance',
    },
  });

  // -------------------------------------------------------------
  // 1. STATE MACHINE TRANSITION MATRIX
  // -------------------------------------------------------------
  console.log('--- 1. Testing State Machine Matrix: canTransition(from, to) ---');

  // Valid
  assert(canTransition('NEW', 'PROCESSING'), 'Valid: NEW -> PROCESSING');
  assert(canTransition('PROCESSING', 'AWAITING_REVIEW'), 'Valid: PROCESSING -> AWAITING_REVIEW');
  assert(canTransition('AWAITING_REVIEW', 'AWAITING_APPROVAL'), 'Valid: AWAITING_REVIEW -> AWAITING_APPROVAL');
  assert(canTransition('AWAITING_APPROVAL', 'IN_PROGRESS'), 'Valid: AWAITING_APPROVAL -> IN_PROGRESS');
  assert(canTransition('IN_PROGRESS', 'COMPLETED'), 'Valid: IN_PROGRESS -> COMPLETED');

  // Alternative valid
  assert(canTransition('PROCESSING', 'REJECTED'), 'Valid: PROCESSING -> REJECTED');
  assert(canTransition('IN_PROGRESS', 'CANCELLED'), 'Valid: IN_PROGRESS -> CANCELLED');

  // Invalid
  assert(!canTransition('NEW', 'COMPLETED'), 'Invalid: NEW -> COMPLETED is blocked');
  assert(!canTransition('COMPLETED', 'PROCESSING'), 'Invalid: COMPLETED -> PROCESSING is blocked');
  assert(!canTransition('REJECTED', 'COMPLETED'), 'Invalid: REJECTED -> COMPLETED is blocked');
  assert(!canTransition('CANCELLED', 'PROCESSING'), 'Invalid: CANCELLED -> PROCESSING is blocked');
  assert(!canTransition('AWAITING_REVIEW', 'COMPLETED'), 'Invalid: AWAITING_REVIEW -> COMPLETED is blocked');
  assert(!canTransition('REJECTED', 'IN_PROGRESS'), 'Invalid: REJECTED -> IN_PROGRESS is blocked');

  // -------------------------------------------------------------
  // 2. LIVE INTAKE & ASSIGNMENT WORKFLOW
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Request Assignment (PATCH /api/requests/:id/assign) ---');

  const request = await RequestService.createRequest({
    title: 'Milestone 3 Workflow Test Request',
    description: 'Testing end-to-end assignment, state transitions, and audit trail.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'WORKFLOW_TEST',
  }, false);

  // 2a. Assign to John
  const assigned = await RequestService.assignRequest(
    request.id,
    johnProcurement.id,
    requester.id
  );

  assert(assigned.assigned_to === johnProcurement.id, 'Request successfully assigned to John');

  // 2b. Verify REQUEST_ASSIGNED in activity_events
  const assignEvents = await prisma.activityEvent.findMany({
    where: {
      request_id: request.id,
      event_type: 'REQUEST_ASSIGNED',
    },
  });

  assert(assignEvents.length === 1, 'Atomic REQUEST_ASSIGNED event stored in activity_events');
  assert(assignEvents[0].actor_id === requester.id, 'Activity event actor matches the assigning user');
  assert(
    assignEvents[0].description.includes(johnProcurement.name),
    'Activity description includes assigned user name'
  );

  // 2c. Duplicate Assignment Check
  try {
    await RequestService.assignRequest(request.id, johnProcurement.id, requester.id);
    assert(false, 'Should block duplicate assignment to same user');
  } catch (e: any) {
    assert(e.name === 'DuplicateAssignmentError', 'Throws DuplicateAssignmentError when assigning to current assignee');
  }

  // 2d. Assign to Nonexistent User
  try {
    await RequestService.assignRequest(
      request.id,
      'a0000000-0000-4000-8000-000000000000',
      requester.id
    );
    assert(false, 'Should block assignment to non-existent user');
  } catch (e: any) {
    assert(e.name === 'NotFoundError', 'Throws NotFoundError when assigning non-existent user');
  }

  // -------------------------------------------------------------
  // 3. CONTROLLED STATE TRANSITIONS WITH AUDIT EVENTS
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Sequential Controlled State Transitions ---');

  // Transition 1: NEW -> PROCESSING
  const step1 = await RequestService.transitionStatus(
    request.id,
    RequestStatus.PROCESSING,
    johnProcurement.id,
    'John started preliminary document verification'
  );
  assert(step1.status === RequestStatus.PROCESSING, 'Transitioned: NEW -> PROCESSING');

  // Transition 2: PROCESSING -> AWAITING_REVIEW
  const step2 = await RequestService.transitionStatus(
    request.id,
    RequestStatus.AWAITING_REVIEW,
    johnProcurement.id,
    'Documents collected, awaiting compliance review'
  );
  assert(step2.status === RequestStatus.AWAITING_REVIEW, 'Transitioned: PROCESSING -> AWAITING_REVIEW');

  // Transition 3: AWAITING_REVIEW -> AWAITING_APPROVAL
  const step3 = await RequestService.transitionStatus(
    request.id,
    RequestStatus.AWAITING_APPROVAL,
    secondAssignee.id,
    'Compliance review passed, forwarded for manager sign-off'
  );
  assert(step3.status === RequestStatus.AWAITING_APPROVAL, 'Transitioned: AWAITING_REVIEW -> AWAITING_APPROVAL');

  // Transition 4: AWAITING_APPROVAL -> IN_PROGRESS
  const step4 = await RequestService.transitionStatus(
    request.id,
    RequestStatus.IN_PROGRESS,
    johnProcurement.id,
    'Approved by management, starting onboarding configuration'
  );
  assert(step4.status === RequestStatus.IN_PROGRESS, 'Transitioned: AWAITING_APPROVAL -> IN_PROGRESS');

  // Transition 5: IN_PROGRESS -> COMPLETED
  const step5 = await RequestService.transitionStatus(
    request.id,
    RequestStatus.COMPLETED,
    johnProcurement.id,
    'Vendor ERP account configured and activated'
  );
  assert(step5.status === RequestStatus.COMPLETED, 'Transitioned: IN_PROGRESS -> COMPLETED');

  // -------------------------------------------------------------
  // 4. AUDIT TRAIL / TIMELINE VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Audit Trail Sequence & Metadata ---');

  const allEvents = await prisma.activityEvent.findMany({
    where: { request_id: request.id },
    orderBy: { created_at: 'asc' },
  });

  const eventTypes = allEvents.map((e) => e.event_type);
  assert(eventTypes[0] === 'REQUEST_CREATED', 'Step 1 audit event: REQUEST_CREATED');
  assert(eventTypes[1] === 'REQUEST_ASSIGNED', 'Step 2 audit event: REQUEST_ASSIGNED');
  assert(eventTypes[2] === 'REQUEST_STATUS_CHANGED', 'Step 3 audit event: REQUEST_STATUS_CHANGED');

  // Verify transition metadata contains { from, to }
  const statusEvents = allEvents.filter((e) => e.event_type === 'REQUEST_STATUS_CHANGED');
  assert(statusEvents.length === 5, 'Exactly 5 REQUEST_STATUS_CHANGED events recorded for 5 transitions');

  const firstTransitionMeta = statusEvents[0].metadata as any;
  assert(
    firstTransitionMeta?.from === 'NEW' && firstTransitionMeta?.to === 'PROCESSING',
    'Metadata explicitly contains { from: "NEW", to: "PROCESSING" }'
  );

  // -------------------------------------------------------------
  // 5. TERMINAL STATE & EDGE CASE ENFORCEMENT
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing Terminal State Invariants ---');

  // 5a. Completed request cannot be assigned
  try {
    await RequestService.assignRequest(request.id, secondAssignee.id, requester.id);
    assert(false, 'Should block assignment on completed request');
  } catch (e: any) {
    assert(
      e.name === 'ClosedRequestModificationError',
      'Throws ClosedRequestModificationError when assigning completed request'
    );
  }

  // 5b. Completed request cannot transition to PROCESSING
  try {
    await RequestService.transitionStatus(request.id, RequestStatus.PROCESSING, johnProcurement.id);
    assert(false, 'Should block transition out of COMPLETED');
  } catch (e: any) {
    assert(
      e.name === 'ClosedRequestModificationError' || e.name === 'InvalidStateTransitionError',
      'Blocks illegal transition from COMPLETED -> PROCESSING'
    );
  }

  // 5c. Changing nonexistent request
  try {
    await RequestService.transitionStatus(
      'a0000000-0000-4000-8000-000000000000',
      RequestStatus.PROCESSING
    );
    assert(false, 'Should block transition on nonexistent request');
  } catch (e: any) {
    assert(e.name === 'NotFoundError', 'Throws NotFoundError on nonexistent request ID');
  }

  console.log('\n=============================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 MILESTONE 3: ASSIGNMENT & STATE MANAGEMENT FULLY VERIFIED!\n');
  }
}

runMilestoneThreeTests().catch((e) => {
  console.error('Test suite error:', e);
  process.exit(1);
});
