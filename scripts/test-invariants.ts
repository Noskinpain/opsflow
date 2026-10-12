import {
  ALLOWED_REQUEST_TRANSITIONS,
  TERMINAL_REQUEST_STATES,
  canTransitionRequest,
  assertValidRequestTransition,
  InvalidStateTransitionError,
  IncompleteTasksError,
  isTerminalStatus,
} from '../lib/state-machine.ts';

import {
  ALLOWED_TASK_TRANSITIONS,
  canTransitionTask,
  assertValidTaskTransition,
  TaskAlreadyCompletedError,
  InvalidTaskTransitionError,
} from '../lib/task-lifecycle.ts';

import {
  CreateRequestSchema,
  AssignRequestSchema,
  CreateTaskSchema,
  TransitionRequestSchema,
} from '../lib/validation/schemas.ts';

import {
  DuplicateAssignmentError,
  ClosedRequestModificationError,
  DuplicateTaskError,
  NotFoundError,
} from '../lib/errors.ts';

import { RequestStatus, TaskStatus } from '@prisma/client';

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

function expectThrows(fn: () => void, expectedErrorName: string, testName: string) {
  try {
    fn();
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

console.log('\n======================================================');
console.log('  MILESTONE 1: INVARIANTS & STATE MACHINE TEST SUITE  ');
console.log('======================================================\n');

// ----------------------------------------------------------------------
// 1. REQUEST STATE MACHINE TRANSITIONS
// ----------------------------------------------------------------------
console.log('--- 1. Testing Request State Machine Transitions ---');

// Happy path transitions
assert(canTransitionRequest('NEW', 'PROCESSING'), 'NEW -> PROCESSING is allowed');
assert(canTransitionRequest('PROCESSING', 'AWAITING_REVIEW'), 'PROCESSING -> AWAITING_REVIEW is allowed');
assert(canTransitionRequest('AWAITING_REVIEW', 'AWAITING_APPROVAL'), 'AWAITING_REVIEW -> AWAITING_APPROVAL is allowed');
assert(canTransitionRequest('AWAITING_APPROVAL', 'IN_PROGRESS'), 'AWAITING_APPROVAL -> IN_PROGRESS is allowed');
assert(canTransitionRequest('IN_PROGRESS', 'COMPLETED'), 'IN_PROGRESS -> COMPLETED is allowed');

// Alternative allowed paths
assert(canTransitionRequest('NEW', 'CANCELLED'), 'NEW -> CANCELLED is allowed');
assert(canTransitionRequest('PROCESSING', 'REJECTED'), 'PROCESSING -> REJECTED is allowed');
assert(canTransitionRequest('AWAITING_REVIEW', 'PROCESSING'), 'AWAITING_REVIEW -> PROCESSING (rework) is allowed');
assert(canTransitionRequest('AWAITING_APPROVAL', 'REJECTED'), 'AWAITING_APPROVAL -> REJECTED is allowed');
assert(canTransitionRequest('IN_PROGRESS', 'CANCELLED'), 'IN_PROGRESS -> CANCELLED is allowed');

// Forbidden Transitions (Failure cases specified in prompt)
expectThrows(
  () => assertValidRequestTransition('COMPLETED', 'PROCESSING'),
  'InvalidStateTransitionError',
  'COMPLETED -> PROCESSING is strictly forbidden (Terminal state invariant)'
);

expectThrows(
  () => assertValidRequestTransition('REJECTED', 'IN_PROGRESS'),
  'InvalidStateTransitionError',
  'REJECTED -> IN_PROGRESS is strictly forbidden (Terminal state invariant)'
);

expectThrows(
  () => assertValidRequestTransition('CANCELLED', 'NEW'),
  'InvalidStateTransitionError',
  'CANCELLED -> NEW is strictly forbidden (Terminal state invariant)'
);

expectThrows(
  () => assertValidRequestTransition('NEW', 'AWAITING_APPROVAL'),
  'InvalidStateTransitionError',
  'NEW -> AWAITING_APPROVAL is forbidden (Approval before review violation)'
);

expectThrows(
  () => assertValidRequestTransition('NEW', 'COMPLETED'),
  'InvalidStateTransitionError',
  'NEW -> COMPLETED is forbidden (Skipping execution violation)'
);

expectThrows(
  () => assertValidRequestTransition('PROCESSING', 'COMPLETED'),
  'InvalidStateTransitionError',
  'PROCESSING -> COMPLETED is forbidden'
);

// Self-transition prohibition
expectThrows(
  () => assertValidRequestTransition('IN_PROGRESS', 'IN_PROGRESS'),
  'InvalidStateTransitionError',
  'Self-transition IN_PROGRESS -> IN_PROGRESS is rejected to prevent duplicate events'
);

// Terminal state detection
assert(isTerminalStatus('COMPLETED'), 'COMPLETED is identified as a terminal status');
assert(isTerminalStatus('REJECTED'), 'REJECTED is identified as a terminal status');
assert(isTerminalStatus('CANCELLED'), 'CANCELLED is identified as a terminal status');
assert(!isTerminalStatus('NEW'), 'NEW is not terminal');
assert(!isTerminalStatus('IN_PROGRESS'), 'IN_PROGRESS is not terminal');

// ----------------------------------------------------------------------
// 2. TASK LIFECYCLE & INVARIANTS
// ----------------------------------------------------------------------
console.log('\n--- 2. Testing Task Lifecycle & Invariants ---');

assert(canTransitionTask('PENDING', 'IN_PROGRESS'), 'Task PENDING -> IN_PROGRESS is allowed');
assert(canTransitionTask('IN_PROGRESS', 'COMPLETED'), 'Task IN_PROGRESS -> COMPLETED is allowed');
assert(canTransitionTask('PENDING', 'CANCELLED'), 'Task PENDING -> CANCELLED is allowed');

expectThrows(
  () => assertValidTaskTransition('COMPLETED', 'IN_PROGRESS'),
  'InvalidTaskTransitionError',
  'COMPLETED task cannot return to IN_PROGRESS'
);

expectThrows(
  () => assertValidTaskTransition('CANCELLED', 'PENDING'),
  'InvalidTaskTransitionError',
  'CANCELLED task cannot return to PENDING'
);

// Incomplete tasks blocking Request completion invariant
const sampleReqId = '11111111-1111-1111-1111-111111111111';
const incompleteTasksError = new IncompleteTasksError(sampleReqId, 2);
assert(
  incompleteTasksError.openTaskCount === 2,
  'IncompleteTasksError properly holds count of open tasks blocking completion'
);

// ----------------------------------------------------------------------
// 3. ZOD VALIDATION & SCHEMA INTEGRITY
// ----------------------------------------------------------------------
console.log('\n--- 3. Testing Input Validation Rules ---');

// Valid input passes
const validRequest = CreateRequestSchema.safeParse({
  title: 'Onboard Global Logistics Inc',
  description: 'Supplier registration with tax certificates',
  request_type: 'VENDOR_ONBOARDING',
  priority: 'HIGH',
  requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
});
assert(validRequest.success, 'Valid request payload passes schema validation');

// Failure case: Missing title
const missingTitle = CreateRequestSchema.safeParse({
  description: 'Missing title request',
  request_type: 'VENDOR_ONBOARDING',
  requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
});
assert(!missingTitle.success, 'Missing title is rejected by validation');

// Failure case: Title too short
const shortTitle = CreateRequestSchema.safeParse({
  title: 'AB',
  description: 'Supplier registration',
  request_type: 'VENDOR_ONBOARDING',
  requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
});
assert(!shortTitle.success, 'Title shorter than 3 chars is rejected');

// Failure case: Missing requester
const missingRequester = CreateRequestSchema.safeParse({
  title: 'Onboard Supplier',
  description: 'Supplier registration',
  request_type: 'VENDOR_ONBOARDING',
});
assert(!missingRequester.success, 'Missing requester_id is rejected');

// Failure case: Invalid requester UUID format
const invalidRequesterUUID = CreateRequestSchema.safeParse({
  title: 'Onboard Supplier',
  description: 'Supplier registration',
  request_type: 'VENDOR_ONBOARDING',
  requester_id: 'not-a-valid-uuid',
});
assert(!invalidRequesterUUID.success, 'Invalid requester UUID format is rejected');

// Failure case: Invalid priority
const invalidPriority = CreateRequestSchema.safeParse({
  title: 'Onboard Supplier',
  description: 'Supplier registration',
  request_type: 'VENDOR_ONBOARDING',
  priority: 'SUPER_URGENT', // Invalid enum
  requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
});
assert(!invalidPriority.success, 'Invalid priority enum value is rejected');

// ----------------------------------------------------------------------
// 4. ASSIGNMENT & MODIFICATION INVARIANTS
// ----------------------------------------------------------------------
console.log('\n--- 4. Testing Assignment & Closed Request Invariants ---');

// Duplicate assignment error
const dupAssign = new DuplicateAssignmentError('req-123', 'user-456');
assert(
  dupAssign.message.includes('already assigned to user'),
  'Duplicate assignment error correctly details violation'
);

// Modifying closed request error
const closedReqError = new ClosedRequestModificationError('req-123', 'COMPLETED', 'assign request');
assert(
  closedReqError.message.includes('terminal state'),
  'Closed request modification error details invariant breach'
);

// Duplicate task error
const dupTaskError = new DuplicateTaskError('req-123', 'Collect W-9 Tax Form');
assert(
  dupTaskError.message.includes('Collect W-9 Tax Form'),
  'Duplicate task error records duplicate task title'
);

console.log('\n======================================================');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL SYSTEM INVARIANTS AND TRANSITIONS VERIFIED SUCCESSFULLY!\n');
}
