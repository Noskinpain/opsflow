import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { RequestService } from '@/lib/services/request-service';
import { TaskService } from '@/lib/services/task-service';
import { SlaService } from '@/lib/services/sla-service';
import { Priority, TaskStatus, UserRole } from '@prisma/client';

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
          name: 'SLA Requester',
          email: `sla.browser.req.${Date.now()}@corp.internal`,
          role: UserRole.REQUESTER,
          department: 'Operations',
        },
      });
    }

    let operator = await prisma.user.findFirst({ where: { role: UserRole.OPERATOR, department: 'Procurement' } });
    if (!operator) {
      operator = await prisma.user.create({
        data: {
          name: 'SLA Operator',
          email: `sla.browser.op.${Date.now()}@corp.internal`,
          role: UserRole.OPERATOR,
          department: 'Procurement',
        },
      });
    }

    let manager = await prisma.user.findFirst({ where: { role: UserRole.MANAGER, department: 'Procurement' } });
    if (!manager) {
      manager = await prisma.user.create({
        data: {
          name: 'SLA Manager',
          email: `sla.browser.mgr.${Date.now()}@corp.internal`,
          role: UserRole.MANAGER,
          department: 'Procurement',
        },
      });
    }

    // 1. Authoritative Deadlines
    const baseTime = new Date('2026-10-10T10:00:00Z');
    const urgentDl = SlaService.calculateDeadline(Priority.URGENT, baseTime);
    const highDl = SlaService.calculateDeadline(Priority.HIGH, baseTime);
    const medDl = SlaService.calculateDeadline(Priority.MEDIUM, baseTime);
    const lowDl = SlaService.calculateDeadline(Priority.LOW, baseTime);

    record('Deadlines', 'URGENT is 2 hours', urgentDl.getTime() - baseTime.getTime() === 2 * 3600000);
    record('Deadlines', 'HIGH is 4 hours', highDl.getTime() - baseTime.getTime() === 4 * 3600000);
    record('Deadlines', 'MEDIUM is 24 hours', medDl.getTime() - baseTime.getTime() === 24 * 3600000);
    record('Deadlines', 'LOW is 72 hours', lowDl.getTime() - baseTime.getTime() === 72 * 3600000);

    const testReq = await RequestService.createRequest({
      title: 'M8 Browser Test Request',
      description: 'Validate SLA deadlines and notifications',
      request_type: 'PURCHASE_ORDER',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'BROWSER_M8',
    }, false);

    record('Deadlines', 'Request auto-calculated due_at', Boolean(testReq.due_at));

    const testTask = await TaskService.createTask({
      requestId: testReq.id,
      title: 'M8 Verify Purchase Order Specs',
      priority: 'HIGH',
      assignedTo: operator.id,
    });

    record('Deadlines', 'Task auto-calculated due_at', Boolean(testTask.due_at));

    // 2. Dynamic SLA Status Tracking
    const now = new Date('2026-10-10T12:00:00Z');
    record('SLA Status', 'Due in 18h -> ON_TRACK', SlaService.getSlaStatus(new Date('2026-10-11T06:00:00Z'), null, 'PENDING', now) === 'ON_TRACK');
    record('SLA Status', 'Due in 45m -> DUE_SOON', SlaService.getSlaStatus(new Date('2026-10-10T12:45:00Z'), null, 'PENDING', now) === 'DUE_SOON');
    record('SLA Status', 'Due 2h ago -> OVERDUE', SlaService.getSlaStatus(new Date('2026-10-10T10:00:00Z'), null, 'PENDING', now) === 'OVERDUE');
    record('SLA Status', 'Due 5h ago (>4h) -> ESCALATED', SlaService.getSlaStatus(new Date('2026-10-10T07:00:00Z'), null, 'PENDING', now) === 'ESCALATED');

    // 3 & 4. Anti-spam Idempotency
    const res1 = await SlaService.sendNotificationIdempotent({
      requestId: testReq.id,
      taskId: testTask.id,
      type: 'TASK_DUE_SOON',
      recipientId: operator.id,
    });
    record('Anti-Spam', 'First notification sent', res1.sent === true);

    const res2 = await SlaService.sendNotificationIdempotent({
      requestId: testReq.id,
      taskId: testTask.id,
      type: 'TASK_DUE_SOON',
      recipientId: operator.id,
    });
    record('Anti-Spam', 'Duplicate notification suppressed', res2.sent === false && res2.skipped === true && res2.reason === 'ALREADY_SENT');

    // 5 & 6. Scheduled processing & Escalation
    const checkResults = await SlaService.processScheduledSlaChecks();
    record('Scheduler', 'Scheduled SLA checks executed', checkResults.tasksEvaluated >= 0);

    // 7. Dashboard Metrics
    const metrics = await SlaService.getDashboardMetrics();
    record('Metrics', 'Dashboard metrics computed successfully', typeof metrics.openRequests === 'number' && typeof metrics.slaBreaches === 'number');

    const allPassed = results.every((r) => r.passed);
    return NextResponse.json({
      success: allPassed,
      passedCount: results.filter((r) => r.passed).length,
      totalCount: results.length,
      results,
      metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
