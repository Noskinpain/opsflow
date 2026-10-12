import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isRetryableError, withRetry } from '@/lib/reliability/retry';
import { IdempotencyService } from '@/lib/reliability/idempotency';
import { ExecutionService } from '@/lib/services/execution-service';
import { ApprovalService, ApprovalAlreadyDecidedError } from '@/lib/services/approval-service';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { RequestService } from '@/lib/services/request-service';
import { UserRole, RequestStatus, ApprovalStatus } from '@prisma/client';

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
        data: {
          name: 'Reliability Requester',
          email: `m9.req.${Date.now()}@corp.internal`,
          role: UserRole.REQUESTER,
          department: 'Procurement',
        },
      });
    }

    let manager = await prisma.user.findFirst({ where: { role: UserRole.MANAGER } });
    if (!manager) {
      manager = await prisma.user.create({
        data: {
          name: 'Reliability Manager',
          email: `m9.mgr.${Date.now()}@corp.internal`,
          role: UserRole.MANAGER,
          department: 'Management',
        },
      });
    }

    // 1. Failure Boundaries & Error Classification
    const transient429 = new Error('Rate limit exceeded: 429 Too Many Requests');
    (transient429 as any).status = 429;
    const transient503 = new Error('Service Unavailable: 503');
    (transient503 as any).statusCode = 503;
    const timeoutErr = new Error('ETIMEDOUT connection failed');
    (timeoutErr as any).code = 'ETIMEDOUT';
    const permanent400 = new Error('Invalid request payload: 400 Bad Request');
    (permanent400 as any).status = 400;
    const auth401 = new Error('Unauthorized API token');
    (auth401 as any).status = 401;

    record('Error Classification', '429 is retryable', isRetryableError(transient429) === true);
    record('Error Classification', '503 is retryable', isRetryableError(transient503) === true);
    record('Error Classification', 'ETIMEDOUT is retryable', isRetryableError(timeoutErr) === true);
    record('Error Classification', '400 is NOT retryable', isRetryableError(permanent400) === false);
    record('Error Classification', '401 is NOT retryable', isRetryableError(auth401) === false);

    // 2. Retries with Exponential Backoff
    let attemptsCount = 0;
    const retryResult = await withRetry(
      async () => {
        attemptsCount++;
        if (attemptsCount < 3) {
          const err = new Error('Temporary gateway timeout (504)');
          (err as any).status = 504;
          throw err;
        }
        return 'success_after_retries';
      },
      { maxRetries: 3, initialDelayMs: 20, backoffFactor: 1.5, jitter: false }
    );
    record('Retries', 'Exponential retry recovers transient 504 after attempts', retryResult === 'success_after_retries' && attemptsCount === 3);

    let nonRetryAttempts = 0;
    let nonRetryCaught = false;
    try {
      await withRetry(
        async () => {
          nonRetryAttempts++;
          const err = new Error('Zod validation error: title is required');
          (err as any).status = 400;
          throw err;
        },
        { maxRetries: 3, initialDelayMs: 20 }
      );
    } catch {
      nonRetryCaught = true;
    }
    record('Retries', 'Non-retryable 400 error halts immediately without loop', nonRetryAttempts === 1 && nonRetryCaught);

    // 3. Idempotent Processing (processed_events)
    const testEventId = `evt_m9_test_${Date.now()}`;
    let executedCount = 0;
    const op = async () => {
      executedCount++;
      return { orderNumber: 9942, status: 'PROCESSED' };
    };

    const firstRun = await IdempotencyService.runIdempotent(testEventId, 'ORDER_SYNC', { order: 9942 }, op);
    const secondRun = await IdempotencyService.runIdempotent(testEventId, 'ORDER_SYNC', { order: 9942 }, op);

    record('Idempotency', 'First event run executes operation', firstRun.cached === false && executedCount === 1);
    record('Idempotency', 'Second event run returns cached data without re-executing', secondRun.cached === true && executedCount === 1 && (secondRun.data as any).orderNumber === 9942);

    const isRecordedInDb = await IdempotencyService.isProcessed(testEventId);
    record('Idempotency', 'Event is persisted in processed_events table', isRecordedInDb === true);

    // 4. Race Condition Protection on State Transitions (Atomic CAS)
    const raceReq = await RequestService.createRequest({
      title: 'Race Condition Test Request',
      description: 'Testing atomic approval decision guard',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'TEST_SUITE',
    }, false);

    const approval = await prisma.approval.create({
      data: {
        request_id: raceReq.id,
        approver_id: manager.id,
        status: ApprovalStatus.PENDING,
      },
    });

    // Launch 2 simultaneous approvals at the exact same time
    const [p1, p2] = await Promise.allSettled([
      ApprovalService.decideApproval(approval.id, {
        decision: 'APPROVED',
        actor_id: manager.id,
        comment: 'Decision 1',
      }),
      ApprovalService.decideApproval(approval.id, {
        decision: 'APPROVED',
        actor_id: manager.id,
        comment: 'Decision 2',
      }),
    ]);

    const successes = [p1, p2].filter((p) => p.status === 'fulfilled');
    const rejected = [p1, p2].filter((p) => p.status === 'rejected');

    record('Race Condition Protection', 'Exactly one concurrent approval succeeds', successes.length === 1);
    record('Race Condition Protection', 'Second concurrent approval safely throws ApprovalAlreadyDecidedError', rejected.length === 1 && (rejected[0] as PromiseRejectedResult).reason instanceof ApprovalAlreadyDecidedError);

    // 5. Technical Execution Log & Separation of Business State
    const execReq = await RequestService.createRequest({
      title: 'Execution Log Test Request',
      description: 'Verify execution tracking and failure handling',
      request_type: 'PURCHASE_ORDER',
      priority: 'MEDIUM',
      requester_id: requester.id,
      source: 'TEST_SUITE',
    }, false);

    const execLog = await ExecutionService.startExecution({
      requestId: execReq.id,
      workflowType: 'purchase_request',
      context: { testRun: true },
    });
    record('Execution Log', 'Workflow execution started in RUNNING state', execLog.status === 'RUNNING' && execLog.attempt === 1);

    await ExecutionService.failExecution(execLog.id, 'Third-party API connection timeout (n8n webhook down)');
    const failedExec = await prisma.workflowExecution.findUnique({ where: { id: execLog.id } });
    record('Execution Log', 'Execution logged as FAILED without altering request.status', Boolean(failedExec?.status === 'FAILED' && failedExec.error?.includes('n8n webhook down')));

    // Business request remains clean
    const untouchedReq = await RequestService.getRequestById(execReq.id);
    record('State Separation', 'Business request status remains clean NEW', untouchedReq?.status === RequestStatus.NEW);

    // 6. Recovery without Database Tampering
    const recovered = await ExecutionService.startExecution({
      requestId: execReq.id,
      workflowType: 'purchase_request',
      context: { retryViaUI: true },
    });
    record('Execution Log', 'Subsequent retry increments attempt count to 2', recovered.attempt === 2 && recovered.status === 'RUNNING');

    await ExecutionService.completeExecution(recovered.id, { recoveryCompleted: true });
    const completedExec = await prisma.workflowExecution.findUnique({ where: { id: recovered.id } });
    record('Execution Log', 'Execution finishes with SUCCESS', completedExec?.status === 'SUCCESS');

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
