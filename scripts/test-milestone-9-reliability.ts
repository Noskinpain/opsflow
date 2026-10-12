import { prisma } from '../lib/prisma.ts';
import { isRetryableError, withRetry } from '../lib/reliability/retry.ts';
import { IdempotencyService } from '../lib/reliability/idempotency.ts';
import { ExecutionService } from '../lib/services/execution-service.ts';
import { ApprovalService, ApprovalAlreadyDecidedError } from '../lib/services/approval-service.ts';
import { TaskService, TaskAlreadyCompletedError } from '../lib/services/task-service.ts';
import { RequestService } from '../lib/services/request-service.ts';
import { WorkflowEngine } from '../lib/workflows/engine.ts';
import { UserRole, RequestStatus, ApprovalStatus, TaskStatus } from '@prisma/client';

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
  console.log('   MILESTONE 9: RELIABILITY, FAILURE HANDLING & IDEMPOTENCY TEST  ');
  console.log('==================================================================\n');

  // 0. Setup test users
  let requester = await prisma.user.findFirst({ where: { role: UserRole.REQUESTER } });
  if (!requester) {
    requester = await prisma.user.create({
      data: {
        name: 'Reliability Requester',
        email: `reliability.req.${Date.now()}@corp.internal`,
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });
  }

  let operator = await prisma.user.findFirst({ where: { role: UserRole.OPERATOR, department: 'Procurement' } });
  if (!operator) {
    operator = await prisma.user.create({
      data: {
        name: 'Reliability Operator',
        email: `reliability.op.${Date.now()}@corp.internal`,
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });
  }

  let manager = await prisma.user.findFirst({ where: { role: UserRole.MANAGER, department: 'Procurement' } });
  if (!manager) {
    manager = await prisma.user.create({
      data: {
        name: 'Reliability Manager',
        email: `reliability.mgr.${Date.now()}@corp.internal`,
        role: UserRole.MANAGER,
        department: 'Procurement',
      },
    });
  }

  // =========================================================================
  // 1. FAILURE BOUNDARIES & ERROR CLASSIFICATION
  // =========================================================================
  console.log('--- 1. Testing Failure Boundaries & Error Classification ---');

  const err429 = new Error('HTTP 429: Too Many Requests');
  (err429 as any).status = 429;
  assert(isRetryableError(err429) === true, 'HTTP 429 Rate Limit error is correctly classified as retryable');

  const err502 = new Error('HTTP 502: Bad Gateway');
  (err502 as any).statusCode = 502;
  assert(isRetryableError(err502) === true, 'HTTP 502 Bad Gateway is correctly classified as retryable');

  const err503 = new Error('HTTP 503: Service Unavailable');
  (err503 as any).status = 503;
  assert(isRetryableError(err503) === true, 'HTTP 503 Service Unavailable is correctly classified as retryable');

  const err504 = new Error('HTTP 504: Gateway Timeout');
  (err504 as any).statusCode = 504;
  assert(isRetryableError(err504) === true, 'HTTP 504 Gateway Timeout is correctly classified as retryable');

  const errTimeout = new Error('Client network socket disconnected before secure TLS connection was established: ETIMEDOUT');
  (errTimeout as any).code = 'ETIMEDOUT';
  assert(isRetryableError(errTimeout) === true, 'Network timeout / ETIMEDOUT is correctly classified as retryable');

  const errConnReset = new Error('read ECONNRESET');
  (errConnReset as any).code = 'ECONNRESET';
  assert(isRetryableError(errConnReset) === true, 'Network reset ECONNRESET is correctly classified as retryable');

  const err400 = new Error('HTTP 400: Bad Request — Missing title');
  (err400 as any).status = 400;
  assert(isRetryableError(err400) === false, 'HTTP 400 Bad Request is NOT retryable');

  const err401 = new Error('HTTP 401: Unauthorized');
  (err401 as any).status = 401;
  assert(isRetryableError(err401) === false, 'HTTP 401 Unauthorized is NOT retryable');

  const err403 = new Error('HTTP 403: Forbidden');
  (err403 as any).status = 403;
  assert(isRetryableError(err403) === false, 'HTTP 403 Forbidden is NOT retryable');

  const err404 = new Error('HTTP 404: Not Found');
  (err404 as any).status = 404;
  assert(isRetryableError(err404) === false, 'HTTP 404 Not Found is NOT retryable');

  const zodErr = new Error('ZodValidationError: Invalid string format in email field');
  assert(isRetryableError(zodErr) === false, 'Zod schema validation error is NOT retryable');

  // =========================================================================
  // 2. RETRIES WITH EXPONENTIAL BACKOFF
  // =========================================================================
  console.log('\n--- 2. Testing Retries with Exponential Backoff ---');

  let callAttempts = 0;
  const backoffSuccess = await withRetry(
    async () => {
      callAttempts++;
      if (callAttempts < 3) {
        const transient = new Error('Transient 503 Server Busy');
        (transient as any).status = 503;
        throw transient;
      }
      return 'recovered_data';
    },
    { maxRetries: 3, initialDelayMs: 25, backoffFactor: 2, jitter: false }
  );

  assert(backoffSuccess === 'recovered_data', 'Transient failure recovered successfully after retries');
  assert(callAttempts === 3, `Retried exactly 3 times before succeeding (actual: ${callAttempts})`);

  // Verify non-retryable error aborts immediately
  let nonRetryCount = 0;
  let nonRetryAborted = false;
  try {
    await withRetry(
      async () => {
        nonRetryCount++;
        const badPayload = new Error('400 Bad Request: Invalid JSON Schema');
        (badPayload as any).status = 400;
        throw badPayload;
      },
      { maxRetries: 3, initialDelayMs: 25 }
    );
  } catch (e: any) {
    nonRetryAborted = true;
    assert(e.message.includes('400 Bad Request'), 'Original error propagated on non-retryable abort');
  }

  assert(nonRetryCount === 1, `Non-retryable error aborted immediately on attempt 1 without wasteful retries (actual: ${nonRetryCount})`);
  assert(nonRetryAborted === true, 'Non-retryable error raised caught exception');

  // =========================================================================
  // 3. IDEMPOTENT OPERATIONS & PROCESSED_EVENTS
  // =========================================================================
  console.log('\n--- 3. Testing Idempotent Event Processing (processed_events) ---');

  const testEventId = `evt_webhook_task_completed_${Date.now()}`;
  let workDoneTimes = 0;

  const mockWork = async () => {
    workDoneTimes++;
    return {
      status: 'TASK_ADVANCED',
      processedRecordId: 'rec_abc_123',
      timestamp: new Date().toISOString(),
    };
  };

  // First execution: should execute operation
  const run1 = await IdempotencyService.runIdempotent(testEventId, 'TASK_COMPLETED', { taskId: 'task-1' }, mockWork);
  assert(run1.cached === false, 'First run is not cached (cached === false)');
  assert(run1.processed === true, 'First run marks processed === true');
  assert(workDoneTimes === 1, `Inner operation executed exactly once (actual: ${workDoneTimes})`);
  assert(run1.data.status === 'TASK_ADVANCED', 'First run returned expected payload');

  // Second execution with duplicate eventId: must return cached result WITHOUT running mockWork
  const run2 = await IdempotencyService.runIdempotent(testEventId, 'TASK_COMPLETED', { taskId: 'task-1' }, mockWork);
  assert(run2.cached === true, 'Second run is cached (cached === true)');
  assert(run2.processed === true, 'Second run marks processed === true');
  assert(workDoneTimes === 1, `Inner operation NOT executed second time (actual: ${workDoneTimes})`);
  assert(run2.data.status === 'TASK_ADVANCED', 'Second run returned identical cached payload');

  // Third check: isProcessed helper
  const isRecorded = await IdempotencyService.isProcessed(testEventId);
  assert(isRecorded === true, 'IdempotencyService.isProcessed returns true for recorded eventId');

  const unrecorded = await IdempotencyService.isProcessed(`non_existent_${Date.now()}`);
  assert(unrecorded === false, 'IdempotencyService.isProcessed returns false for unrecorded eventId');

  // =========================================================================
  // 4. PROTECTED STATE TRANSITIONS (ATOMIC COMPARE-AND-SWAP)
  // =========================================================================
  console.log('\n--- 4. Testing Race Condition Protection on State Transitions ---');

  const testReq = await RequestService.createRequest({
    title: 'Atomic Transition Test Request',
    description: 'Ensure double approval and duplicate task transitions are blocked',
    request_type: 'PURCHASE_ORDER',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'TEST_SUITE',
  }, false);

  const approval = await prisma.approval.create({
    data: {
      request_id: testReq.id,
      approver_id: manager.id,
      status: ApprovalStatus.PENDING,
    },
  });

  // Test concurrent approvals: Two parallel approval attempts
  const [attempt1, attempt2] = await Promise.allSettled([
    ApprovalService.decideApproval(approval.id, {
      decision: 'APPROVED',
      actor_id: manager.id,
      comment: 'First decider',
    }),
    ApprovalService.decideApproval(approval.id, {
      decision: 'APPROVED',
      actor_id: manager.id,
      comment: 'Second decider',
    }),
  ]);

  const fulfilledCount = [attempt1, attempt2].filter((a) => a.status === 'fulfilled').length;
  const rejectedCount = [attempt1, attempt2].filter((a) => a.status === 'rejected').length;

  assert(fulfilledCount === 1, `Exactly one concurrent approval succeeded (actual: ${fulfilledCount})`);
  assert(rejectedCount === 1, `Second concurrent approval failed atomically (actual: ${rejectedCount})`);

  const rejectedReason = [attempt1, attempt2].find((a) => a.status === 'rejected') as PromiseRejectedResult;
  assert(rejectedReason.reason instanceof ApprovalAlreadyDecidedError, 'Second attempt threw ApprovalAlreadyDecidedError');

  // Verify status in DB is DECIDED with decision APPROVED and decided_at is set
  const dbApproval = await prisma.approval.findUnique({ where: { id: approval.id } });
  assert(dbApproval?.status === ApprovalStatus.DECIDED, 'Approval status is DECIDED');
  assert(dbApproval?.decision === 'APPROVED', 'Approval decision is APPROVED');
  assert(dbApproval?.decided_at !== null, 'Approval decided_at is set');

  // Verify attempting to decide an already approved record throws synchronously
  let postDecisionCaught = false;
  try {
    await ApprovalService.decideApproval(approval.id, {
      decision: 'REJECTED',
      actor_id: manager.id,
      comment: 'Late rejection',
    });
  } catch (err: any) {
    if (err instanceof ApprovalAlreadyDecidedError) {
      postDecisionCaught = true;
    }
  }
  assert(postDecisionCaught === true, 'Subsequent decision on already decided approval throws ApprovalAlreadyDecidedError');

  // =========================================================================
  // 5. ATOMIC TASK TRANSITION RACE CONDITION PROTECTION
  // =========================================================================
  console.log('\n--- 5. Testing Task Transition CAS Protection ---');

  const task = await TaskService.createTask({
    requestId: testReq.id,
    title: 'Verify Procurement Quote',
    priority: 'HIGH',
    assignedTo: operator.id,
  });

  // Move to IN_PROGRESS
  await TaskService.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS, operator.id);

  // Attempt concurrent status completion
  const [t1, t2] = await Promise.allSettled([
    TaskService.updateTaskStatus(task.id, TaskStatus.COMPLETED, operator.id),
    TaskService.updateTaskStatus(task.id, TaskStatus.COMPLETED, operator.id),
  ]);

  const tSuccess = [t1, t2].filter((t) => t.status === 'fulfilled').length;
  const tFail = [t1, t2].filter((t) => t.status === 'rejected').length;

  assert(tSuccess === 1, `Exactly one concurrent task completion succeeded (actual: ${tSuccess})`);
  assert(tFail === 1, `Second concurrent task completion rejected by CAS guard (actual: ${tFail})`);

  // Verify task status in database is COMPLETED
  const finalTask = await prisma.task.findUnique({ where: { id: task.id } });
  assert(finalTask?.status === TaskStatus.COMPLETED, 'Task is in COMPLETED state');

  // =========================================================================
  // 6. TECHNICAL EXECUTION STATE VS BUSINESS STATE SEPARATION
  // =========================================================================
  console.log('\n--- 6. Testing Execution Log & State Separation ---');

  const executionReq = await RequestService.createRequest({
    title: 'State Separation Verification Request',
    description: 'Verify execution table logs failures without breaking business status',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'MEDIUM',
    requester_id: requester.id,
    source: 'TEST_SUITE',
  }, false);

  // Start execution log
  const execution = await ExecutionService.startExecution({
    requestId: executionReq.id,
    workflowType: 'vendor_onboarding',
    context: { triggeredBy: 'auto_intake' },
  });

  assert(execution.status === 'RUNNING', 'Technical execution initialized as RUNNING');
  assert(execution.attempt === 1, 'Technical execution starts at attempt 1');
  assert(execution.request_id === executionReq.id, 'Execution correctly linked to request_id');

  // Simulate a technical failure (e.g. n8n webhook unreachable)
  await ExecutionService.failExecution(
    execution.id,
    'ECONNREFUSED: Webhook dispatch to n8n server failed after 3 retries',
    { webhookUrl: 'http://localhost:5678/webhook/vendor' }
  );

  const failedExecution = await prisma.workflowExecution.findUnique({
    where: { id: execution.id },
  });

  assert(failedExecution?.status === 'FAILED', 'Technical execution status updated to FAILED');
  assert(failedExecution?.error?.includes('ECONNREFUSED') === true, 'Failure error reason recorded in execution log');
  assert(failedExecution?.completed_at !== null, 'Technical failure completed_at timestamp recorded');

  // Verify business request status is intact and not corrupted
  const reqCheck = await RequestService.getRequestById(executionReq.id);
  assert(reqCheck?.status === RequestStatus.NEW, `Business request status remains uncorrupted NEW (actual: ${reqCheck?.status})`);

  // =========================================================================
  // 7. TECHNICAL RECOVERY VIA RETRY WITHOUT DATABASE TAMPERING
  // =========================================================================
  console.log('\n--- 7. Testing Technical Recovery & Retry Mechanism ---');

  // Resuming/retrying the failed execution increments attempt counter
  const retryExecution = await ExecutionService.startExecution({
    requestId: executionReq.id,
    workflowType: 'vendor_onboarding',
    context: { triggeredBy: 'operator_ui_retry' },
  });

  assert(retryExecution.id === execution.id, 'Execution record ID preserved for audit continuity');
  assert(retryExecution.attempt === 2, `Execution attempt counter correctly incremented to 2 (actual: ${retryExecution.attempt})`);
  assert(retryExecution.status === 'RUNNING', 'Retried execution status restored to RUNNING');
  assert(retryExecution.error === null, 'Previous error cleared upon retry execution');

  // Complete execution
  await ExecutionService.completeExecution(retryExecution.id, {
    completedTasksCount: 3,
    workflowStage: 'PROCESSING',
  });

  const finalExec = await prisma.workflowExecution.findUnique({
    where: { id: retryExecution.id },
  });

  assert(finalExec?.status === 'SUCCESS', 'Execution successfully recovered and marked SUCCESS');
  assert(finalExec?.completed_at !== null, 'Execution completed_at timestamp recorded');

  // Test list recent executions
  const recentExecs = await ExecutionService.listRecentExecutions(10);
  assert(recentExecs.length > 0, `Recent executions listed successfully (count: ${recentExecs.length})`);
  assert(recentExecs[0].request !== undefined, 'Recent executions include joined request relation');

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
    console.error('Fatal error running Milestone 9 reliability tests:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
