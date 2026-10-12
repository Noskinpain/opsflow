import { prisma } from '../lib/prisma.ts';
import { RequestService } from '../lib/services/request-service.ts';
import { TaskService } from '../lib/services/task-service.ts';
import { SlaService, SLA_DURATIONS } from '../lib/services/sla-service.ts';
import { Priority, TaskStatus, RequestStatus, UserRole } from '@prisma/client';

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
  console.log('\n======================================================');
  console.log('   MILESTONE 8: SLA TRACKING & NOTIFICATIONS TEST      ');
  console.log('======================================================\n');

  // 0. Setup test users
  let requester = await prisma.user.findFirst({ where: { role: UserRole.REQUESTER } });
  if (!requester) {
    requester = await prisma.user.create({
      data: {
        name: 'SLA Requester',
        email: `sla.req.${Date.now()}@corp.internal`,
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
        email: `sla.op.${Date.now()}@corp.internal`,
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
        email: `sla.mgr.${Date.now()}@corp.internal`,
        role: UserRole.MANAGER,
        department: 'Procurement',
      },
    });
  }

  // =========================================================================
  // 1. DEADLINE CALCULATION (Backend Authoritative)
  // =========================================================================
  console.log('--- 1. Testing Backend-Authoritative Deadline Calculation ---');
  const baseTime = new Date('2026-10-10T10:00:00Z');

  const urgentDeadline = SlaService.calculateDeadline(Priority.URGENT, baseTime);
  const highDeadline = SlaService.calculateDeadline(Priority.HIGH, baseTime);
  const mediumDeadline = SlaService.calculateDeadline(Priority.MEDIUM, baseTime);
  const lowDeadline = SlaService.calculateDeadline(Priority.LOW, baseTime);

  assert(
    urgentDeadline.getTime() - baseTime.getTime() === 2 * 60 * 60 * 1000,
    'URGENT priority deadline is exactly 2 hours'
  );
  assert(
    highDeadline.getTime() - baseTime.getTime() === 4 * 60 * 60 * 1000,
    'HIGH priority deadline is exactly 4 hours'
  );
  assert(
    mediumDeadline.getTime() - baseTime.getTime() === 24 * 60 * 60 * 1000,
    'MEDIUM priority deadline is exactly 24 hours'
  );
  assert(
    lowDeadline.getTime() - baseTime.getTime() === 72 * 60 * 60 * 1000,
    'LOW priority deadline is exactly 72 hours'
  );

  // Test automatic deadline calculation on request creation
  const createdReq = await RequestService.createRequest({
    title: 'Auto Deadline SLA Request',
    description: 'Verify backend automatically calculates authoritative deadline',
    request_type: 'PURCHASE_ORDER',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'TEST_SLA',
  }, false);

  assert(Boolean(createdReq.due_at), 'Request created with non-null due_at');
  if (createdReq.due_at) {
    const diffHours = (createdReq.due_at.getTime() - createdReq.created_at.getTime()) / (1000 * 60 * 60);
    assert(Math.round(diffHours) === 4, `Request calculated due_at +4 hours for HIGH priority (got ~${Math.round(diffHours)}h)`);
  }

  // Test automatic deadline calculation on task creation
  const createdTask = await TaskService.createTask({
    requestId: createdReq.id,
    title: 'Verify Vendor Compliance Documents',
    priority: 'HIGH',
    assignedTo: operator.id,
  });

  assert(Boolean(createdTask.due_at), 'Task created with non-null due_at');
  if (createdTask.due_at) {
    const taskDiffHours = (createdTask.due_at.getTime() - createdTask.created_at.getTime()) / (1000 * 60 * 60);
    assert(Math.round(taskDiffHours) === 4, `Task calculated due_at +4 hours for HIGH priority (got ~${Math.round(taskDiffHours)}h)`);
  }

  // =========================================================================
  // 2. DYNAMIC SLA STATUS TRACKING
  // =========================================================================
  console.log('\n--- 2. Testing Dynamic SLA Status Tracking ---');
  const now = new Date('2026-10-10T12:00:00Z');

  // Due in 18 hours -> ON_TRACK
  const dueIn18h = new Date('2026-10-11T06:00:00Z');
  assert(SlaService.getSlaStatus(dueIn18h, null, 'PENDING', now) === 'ON_TRACK', 'Due in 18 hours -> ON_TRACK');

  // Due in 45 minutes -> DUE_SOON
  const dueIn45m = new Date('2026-10-10T12:45:00Z');
  assert(SlaService.getSlaStatus(dueIn45m, null, 'PENDING', now) === 'DUE_SOON', 'Due in 45 minutes -> DUE_SOON');

  // Due in 10 minutes -> DUE_SOON
  const dueIn10m = new Date('2026-10-10T12:10:00Z');
  assert(SlaService.getSlaStatus(dueIn10m, null, 'PENDING', now) === 'DUE_SOON', 'Due in 10 minutes -> DUE_SOON');

  // Due 2 hours ago -> OVERDUE
  const due2hAgo = new Date('2026-10-10T10:00:00Z');
  assert(SlaService.getSlaStatus(due2hAgo, null, 'PENDING', now) === 'OVERDUE', 'Due 2 hours ago -> OVERDUE');

  // Due 5 hours ago (>= 4 hours overdue) -> ESCALATED
  const due5hAgo = new Date('2026-10-10T07:00:00Z');
  assert(SlaService.getSlaStatus(due5hAgo, null, 'PENDING', now) === 'ESCALATED', 'Due 5 hours ago (>4h overdue) -> ESCALATED');

  // Completed on time
  assert(
    SlaService.getSlaStatus(dueIn18h, new Date('2026-10-10T11:00:00Z'), 'COMPLETED', now) === 'COMPLETED_ON_TIME',
    'Task completed before due date -> COMPLETED_ON_TIME'
  );

  // Completed late
  assert(
    SlaService.getSlaStatus(due2hAgo, new Date('2026-10-10T11:30:00Z'), 'COMPLETED', now) === 'COMPLETED_LATE',
    'Task completed after due date -> COMPLETED_LATE'
  );

  // =========================================================================
  // 3 & 4. NOTIFICATION IDEMPOTENCY & ANTI-SPAM PROTECTION
  // =========================================================================
  console.log('\n--- 3 & 4. Testing Notification Anti-Spam Idempotency ---');
  const testTaskId = createdTask.id;

  // First notification send
  const res1 = await SlaService.sendNotificationIdempotent({
    requestId: createdReq.id,
    taskId: testTaskId,
    type: 'TASK_DUE_SOON',
    recipientId: operator.id,
    payload: { note: 'Deadline approaching' },
  });

  assert(res1.sent === true, 'First notification sent successfully');
  assert(res1.skipped === false, 'First notification not skipped');
  assert(res1.notification.type === 'TASK_DUE_SOON', 'Notification record created with type TASK_DUE_SOON');

  // Second notification send (duplicate trigger)
  const res2 = await SlaService.sendNotificationIdempotent({
    requestId: createdReq.id,
    taskId: testTaskId,
    type: 'TASK_DUE_SOON',
    recipientId: operator.id,
    payload: { note: 'Deadline approaching repeated' },
  });

  assert(res2.sent === false, 'Duplicate notification suppressed (sent === false)');
  assert(res2.skipped === true, 'Duplicate notification skipped');
  assert(res2.reason === 'ALREADY_SENT', 'Reason is ALREADY_SENT');

  // Verify exactly 1 notification of that type exists in DB
  const countInDb = await prisma.notificationEvent.count({
    where: { task_id: testTaskId, type: 'TASK_DUE_SOON' },
  });
  assert(countInDb === 1, 'Only exactly 1 notification record exists in notification_events (idempotency preserved)');

  // Different notification type for same task is permitted
  const res3 = await SlaService.sendNotificationIdempotent({
    requestId: createdReq.id,
    taskId: testTaskId,
    type: 'TASK_OVERDUE',
    recipientId: operator.id,
    payload: { note: 'Task is overdue' },
  });
  assert(res3.sent === true, 'Different notification type TASK_OVERDUE sent successfully');

  // =========================================================================
  // 5 & 6. SCHEDULED PROCESSING & ESCALATION ENGINE
  // =========================================================================
  console.log('\n--- 5 & 6. Testing Scheduled Processing & Escalation Engine ---');

  // Create task that is approaching deadline (<1h remaining)
  const dueSoonTime = new Date(Date.now() + 30 * 60 * 1000); // 30 mins from now
  const taskDueSoon = await prisma.task.create({
    data: {
      request_id: createdReq.id,
      title: 'Due Soon Task Test',
      priority: Priority.HIGH,
      due_at: dueSoonTime,
      assigned_to: operator.id,
      status: TaskStatus.PENDING,
    },
  });

  // Create task that is 5 hours overdue (>4h overdue for escalation)
  const overdue5hTime = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours in past
  const taskEscalated = await prisma.task.create({
    data: {
      request_id: createdReq.id,
      title: 'Severely Overdue Task Test',
      priority: Priority.HIGH,
      due_at: overdue5hTime,
      assigned_to: operator.id,
      status: TaskStatus.PENDING,
    },
  });

  // Run scheduled SLA check
  const schedulerResults1 = await SlaService.processScheduledSlaChecks();
  assert(schedulerResults1.tasksEvaluated >= 2, `Scheduler evaluated tasks (${schedulerResults1.tasksEvaluated} tasks evaluated)`);
  assert(schedulerResults1.details.dueSoonTasks.includes(taskDueSoon.id), 'Task due soon detected by scheduler');
  assert(schedulerResults1.details.overdueTasks.includes(taskEscalated.id), 'Overdue task detected by scheduler');
  assert(schedulerResults1.details.escalatedTasks.includes(taskEscalated.id), 'Severely overdue task flagged for escalation');
  assert(schedulerResults1.escalationsTriggered >= 1, 'Escalation triggered for >4h overdue task');

  // Verify escalation activity event was logged on the request
  const escalationEvents = await prisma.activityEvent.findMany({
    where: {
      request_id: createdReq.id,
      event_type: 'TASK_ESCALATED',
    },
  });
  assert(escalationEvents.length >= 1, 'TASK_ESCALATED activity event recorded in audit log');

  // Verify escalation notification was recorded
  const escalationNotifications = await prisma.notificationEvent.findMany({
    where: {
      task_id: taskEscalated.id,
      type: 'TASK_ESCALATED',
    },
  });
  assert(escalationNotifications.length === 1, 'TASK_ESCALATED notification recorded for manager');

  // Re-run scheduler immediately (Anti-spam verification)
  const schedulerResults2 = await SlaService.processScheduledSlaChecks();
  assert(schedulerResults2.notificationsSkipped >= 2, 'Scheduler skipped duplicate notifications on re-run (anti-spam)');

  // =========================================================================
  // 7. DASHBOARD METRICS CALCULATION
  // =========================================================================
  console.log('\n--- 7. Testing Dashboard Metrics Calculation ---');
  const metrics = await SlaService.getDashboardMetrics();

  assert(typeof metrics.openRequests === 'number' && metrics.openRequests >= 1, `Open Requests calculated: ${metrics.openRequests}`);
  assert(typeof metrics.pendingApprovals === 'number', `Pending Approvals calculated: ${metrics.pendingApprovals}`);
  assert(typeof metrics.overdueTasks === 'number' && metrics.overdueTasks >= 1, `Overdue Tasks calculated: ${metrics.overdueTasks}`);
  assert(typeof metrics.dueTodayTasks === 'number', `Due Today Tasks calculated: ${metrics.dueTodayTasks}`);
  assert(typeof metrics.slaBreaches === 'number' && metrics.slaBreaches >= 1, `SLA Breaches calculated: ${metrics.slaBreaches}`);
  assert(typeof metrics.averageProcessingTimeHours === 'number', `Average Processing Time Hours: ${metrics.averageProcessingTimeHours}h`);

  console.log('\n======================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
