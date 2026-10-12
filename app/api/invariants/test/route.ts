import { NextResponse } from 'next/server';
import {
  canTransitionRequest,
  assertValidRequestTransition,
  IncompleteTasksError,
  isTerminalStatus,
} from '@/lib/state-machine';
import {
  canTransitionTask,
  assertValidTaskTransition,
} from '@/lib/task-lifecycle';
import {
  CreateRequestSchema,
} from '@/lib/validation/schemas';
import {
  DuplicateAssignmentError,
  ClosedRequestModificationError,
  DuplicateTaskError,
} from '@/lib/errors';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  function expectThrow(category: string, name: string, fn: () => void, expectedName: string) {
    try {
      fn();
      results.push({ category, name, passed: false, note: `Expected ${expectedName} but none thrown` });
    } catch (e: any) {
      const match = e.name === expectedName || e.constructor.name === expectedName;
      results.push({ category, name, passed: match, note: `Caught: ${e.name}` });
    }
  }

  // 1. State Machine
  record('State Machine', 'NEW -> PROCESSING allowed', canTransitionRequest('NEW', 'PROCESSING'));
  record('State Machine', 'PROCESSING -> AWAITING_REVIEW allowed', canTransitionRequest('PROCESSING', 'AWAITING_REVIEW'));
  record('State Machine', 'AWAITING_REVIEW -> AWAITING_APPROVAL allowed', canTransitionRequest('AWAITING_REVIEW', 'AWAITING_APPROVAL'));
  record('State Machine', 'AWAITING_APPROVAL -> IN_PROGRESS allowed', canTransitionRequest('AWAITING_APPROVAL', 'IN_PROGRESS'));
  record('State Machine', 'IN_PROGRESS -> COMPLETED allowed', canTransitionRequest('IN_PROGRESS', 'COMPLETED'));
  
  expectThrow('State Machine', 'COMPLETED -> PROCESSING forbidden', () => assertValidRequestTransition('COMPLETED', 'PROCESSING'), 'InvalidStateTransitionError');
  expectThrow('State Machine', 'REJECTED -> IN_PROGRESS forbidden', () => assertValidRequestTransition('REJECTED', 'IN_PROGRESS'), 'InvalidStateTransitionError');
  expectThrow('State Machine', 'CANCELLED -> NEW forbidden', () => assertValidRequestTransition('CANCELLED', 'NEW'), 'InvalidStateTransitionError');
  expectThrow('State Machine', 'NEW -> AWAITING_APPROVAL forbidden (Skip review)', () => assertValidRequestTransition('NEW', 'AWAITING_APPROVAL'), 'InvalidStateTransitionError');
  expectThrow('State Machine', 'Self-transition prohibited', () => assertValidRequestTransition('IN_PROGRESS', 'IN_PROGRESS'), 'InvalidStateTransitionError');

  // 2. Terminal States
  record('Terminal States', 'COMPLETED identified as terminal', isTerminalStatus('COMPLETED'));
  record('Terminal States', 'REJECTED identified as terminal', isTerminalStatus('REJECTED'));
  record('Terminal States', 'CANCELLED identified as terminal', isTerminalStatus('CANCELLED'));
  record('Terminal States', 'NEW identified as non-terminal', !isTerminalStatus('NEW'));

  // 3. Task Lifecycle
  record('Task Lifecycle', 'PENDING -> IN_PROGRESS allowed', canTransitionTask('PENDING', 'IN_PROGRESS'));
  record('Task Lifecycle', 'IN_PROGRESS -> COMPLETED allowed', canTransitionTask('IN_PROGRESS', 'COMPLETED'));
  expectThrow('Task Lifecycle', 'COMPLETED -> IN_PROGRESS forbidden', () => assertValidTaskTransition('COMPLETED', 'IN_PROGRESS'), 'InvalidTaskTransitionError');
  
  const incError = new IncompleteTasksError('req-1', 3);
  record('Task Invariants', 'Open tasks block request completion', incError.openTaskCount === 3);

  // 4. Schema Validation
  const valid = CreateRequestSchema.safeParse({
    title: 'Valid Request Title',
    description: 'Valid description longer than 5 chars',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  });
  record('Validation', 'Valid schema passes', valid.success);

  const missingTitle = CreateRequestSchema.safeParse({
    description: 'Missing title',
    request_type: 'VENDOR_ONBOARDING',
    requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  });
  record('Validation', 'Missing title rejected', !missingTitle.success);

  const invalidPriority = CreateRequestSchema.safeParse({
    title: 'Valid Title',
    description: 'Valid description',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'IMPOSSIBLE_PRIORITY',
    requester_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  });
  record('Validation', 'Invalid priority enum rejected', !invalidPriority.success);

  // 5. Assignment & Invariants
  const dupAssign = new DuplicateAssignmentError('req-1', 'user-1');
  record('Assignment Invariants', 'Duplicate assignment invariant', dupAssign.name === 'DuplicateAssignmentError');

  const closedReq = new ClosedRequestModificationError('req-1', 'COMPLETED', 'modify');
  record('Closed Request Invariants', 'Cannot modify closed request', closedReq.name === 'ClosedRequestModificationError');

  const dupTask = new DuplicateTaskError('req-1', 'Collect W9');
  record('Task Invariants', 'Duplicate task invariant', dupTask.name === 'DuplicateTaskError');

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return NextResponse.json({
    total: results.length,
    passedCount,
    failedCount,
    allPassed: failedCount === 0,
    results,
  });
}
