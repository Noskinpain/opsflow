import { prisma } from '../prisma.ts';
import { Priority, TaskStatus, RequestStatus, ApprovalStatus } from '@prisma/client';
import { WebhookService } from './webhook-service.ts';

export type SlaStatus =
  | 'ON_TRACK'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'ESCALATED'
  | 'COMPLETED_ON_TIME'
  | 'COMPLETED_LATE';

/**
 * Milestone 8 — Authoritative SLA rules
 * HIGH: 4 hours
 * MEDIUM: 24 hours
 * LOW: 72 hours
 * URGENT: 2 hours
 */
export const SLA_DURATIONS: Record<Priority, number> = {
  URGENT: 2 * 60 * 60 * 1000,
  HIGH: 4 * 60 * 60 * 1000,
  MEDIUM: 24 * 60 * 60 * 1000,
  LOW: 72 * 60 * 60 * 1000,
};

// Thresholds
export const DUE_SOON_THRESHOLD_MS = 60 * 60 * 1000; // <= 1 hour remaining
export const ESCALATION_THRESHOLD_MS = 4 * 60 * 60 * 1000; // >= 4 hours past deadline

export interface NotificationInput {
  requestId?: string | null;
  taskId?: string | null;
  type: string;
  recipientId?: string | null;
  channel?: string;
  payload?: Record<string, any>;
}

export interface NotificationResult {
  sent: boolean;
  skipped: boolean;
  reason?: string;
  notification: any;
}

export interface SlaCheckResults {
  timestamp: string;
  tasksEvaluated: number;
  requestsEvaluated: number;
  notificationsSent: number;
  notificationsSkipped: number;
  escalationsTriggered: number;
  details: {
    dueSoonTasks: string[];
    overdueTasks: string[];
    escalatedTasks: string[];
    overdueRequests: string[];
  };
}

export interface DashboardMetrics {
  openRequests: number;
  pendingApprovals: number;
  overdueTasks: number;
  dueTodayTasks: number;
  slaBreaches: number;
  averageProcessingTimeHours: number;
}

export class SlaService {
  /**
   * 1. Add Deadlines: Backend-authoritative SLA deadline calculator
   * due_at = created_at + SLA duration
   */
  static calculateDeadline(priority: Priority = Priority.MEDIUM, fromDate: Date = new Date()): Date {
    const durationMs = SLA_DURATIONS[priority] ?? SLA_DURATIONS.MEDIUM;
    return new Date(fromDate.getTime() + durationMs);
  }

  /**
   * 2. Track SLA Status
   * Dynamically calculated from timestamps:
   * Due in 18 hours -> ON_TRACK
   * Due in 45 minutes -> DUE_SOON
   * Due 2 hours ago -> OVERDUE
   * Due 5 hours ago (>4h overdue) -> ESCALATED
   */
  static getSlaStatus(
    dueAt: Date | null,
    completedAt?: Date | null,
    status?: string,
    now: Date = new Date()
  ): SlaStatus {
    // If already completed:
    if (status === 'COMPLETED' || completedAt) {
      if (dueAt && completedAt && completedAt.getTime() > dueAt.getTime()) {
        return 'COMPLETED_LATE';
      }
      return 'COMPLETED_ON_TIME';
    }

    if (!dueAt) {
      return 'ON_TRACK';
    }

    const currentTime = now.getTime();
    const targetDueTime = dueAt.getTime();
    const diff = targetDueTime - currentTime;

    // Past deadline:
    if (diff < 0) {
      const overdueBy = Math.abs(diff);
      if (overdueBy >= ESCALATION_THRESHOLD_MS) {
        return 'ESCALATED';
      }
      return 'OVERDUE';
    }

    // Approaching deadline (<= 1 hour remaining):
    if (diff <= DUE_SOON_THRESHOLD_MS) {
      return 'DUE_SOON';
    }

    return 'ON_TRACK';
  }

  /**
   * 3 & 4. Idempotent Notification Dispatcher (Anti-Spam)
   * Enforces: Same task/request + same notification type already sent?
   * YES -> don't send again.
   * Records notification state in `notification_events`.
   */
  static async sendNotificationIdempotent(input: NotificationInput): Promise<NotificationResult> {
    const { requestId, taskId, type, recipientId, channel = 'WEBHOOK', payload = {} } = input;

    // Check if duplicate notification already sent
    const whereCondition: any = {
      type,
      status: { in: ['SENT', 'DELIVERED', 'PENDING'] },
    };

    if (taskId) {
      whereCondition.task_id = taskId;
    } else if (requestId) {
      whereCondition.request_id = requestId;
      if (recipientId && type === 'APPROVAL_REQUESTED') {
        whereCondition.recipient_id = recipientId;
      }
    }

    const existing = await prisma.notificationEvent.findFirst({
      where: whereCondition,
    });

    if (existing) {
      return {
        sent: false,
        skipped: true,
        reason: 'ALREADY_SENT',
        notification: existing,
      };
    }

    // Persist new notification event
    const record = await prisma.notificationEvent.create({
      data: {
        request_id: requestId || null,
        task_id: taskId || null,
        type,
        recipient_id: recipientId || null,
        channel,
        status: 'SENT',
        payload,
        sent_at: new Date(),
      },
    });

    // Log Activity Event if parent request exists
    if (requestId) {
      await prisma.activityEvent.create({
        data: {
          request_id: requestId,
          actor_id: recipientId || null,
          event_type: 'NOTIFICATION_SENT',
          description: `Notification [${type}] sent to recipient (${channel})`,
          metadata: {
            notification_id: record.id,
            notification_type: type,
            recipient_id: recipientId,
            channel,
            task_id: taskId,
          },
        },
      });
    }

    // Dispatch to external n8n webhook
    await WebhookService.dispatch(type, {
      notificationId: record.id,
      requestId,
      taskId,
      type,
      recipientId,
      channel,
      ...payload,
    });

    return {
      sent: true,
      skipped: false,
      notification: record,
    };
  }

  /**
   * 5 & 6. Scheduled Processing & Escalation Engine
   * Checks:
   * What is due soon?
   * What is overdue?
   * What requires escalation (overdue > 4 hours)?
   */
  static async processScheduledSlaChecks(now: Date = new Date()): Promise<SlaCheckResults> {
    const results: SlaCheckResults = {
      timestamp: now.toISOString(),
      tasksEvaluated: 0,
      requestsEvaluated: 0,
      notificationsSent: 0,
      notificationsSkipped: 0,
      escalationsTriggered: 0,
      details: {
        dueSoonTasks: [],
        overdueTasks: [],
        escalatedTasks: [],
        overdueRequests: [],
      },
    };

    // 1. Evaluate open tasks
    const activeTasks = await prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        due_at: { not: null },
      },
      include: {
        assignee: true,
        request: true,
      },
    });

    results.tasksEvaluated = activeTasks.length;

    for (const task of activeTasks) {
      if (!task.due_at) continue;

      const slaStatus = this.getSlaStatus(task.due_at, task.completed_at, task.status, now);

      // A. Due Soon (< 1 hour remaining)
      if (slaStatus === 'DUE_SOON') {
        results.details.dueSoonTasks.push(task.id);
        const res = await this.sendNotificationIdempotent({
          requestId: task.request_id,
          taskId: task.id,
          type: 'TASK_DUE_SOON',
          recipientId: task.assigned_to,
          payload: {
            title: task.title,
            dueAt: task.due_at.toISOString(),
            priority: task.priority,
          },
        });
        if (res.sent) results.notificationsSent++;
        if (res.skipped) results.notificationsSkipped++;
      }

      // B. Overdue (passed due date)
      if (slaStatus === 'OVERDUE' || slaStatus === 'ESCALATED') {
        results.details.overdueTasks.push(task.id);
        const res = await this.sendNotificationIdempotent({
          requestId: task.request_id,
          taskId: task.id,
          type: 'TASK_OVERDUE',
          recipientId: task.assigned_to,
          payload: {
            title: task.title,
            dueAt: task.due_at.toISOString(),
            priority: task.priority,
          },
        });
        if (res.sent) results.notificationsSent++;
        if (res.skipped) results.notificationsSkipped++;
      }

      // C. Escalation: overdue by >= 4 hours
      if (slaStatus === 'ESCALATED') {
        results.details.escalatedTasks.push(task.id);

        // Find department manager for escalation
        const targetDepartment = task.assignee?.department || 'Operations';
        let manager = await prisma.user.findFirst({
          where: {
            department: targetDepartment,
            role: { in: ['MANAGER', 'ADMIN'] },
          },
        });

        // Fallback to any manager or admin
        if (!manager) {
          manager = await prisma.user.findFirst({
            where: { role: { in: ['MANAGER', 'ADMIN'] } },
          });
        }

        const escalationRes = await this.sendNotificationIdempotent({
          requestId: task.request_id,
          taskId: task.id,
          type: 'TASK_ESCALATED',
          recipientId: manager?.id || null,
          payload: {
            title: task.title,
            dueAt: task.due_at.toISOString(),
            priority: task.priority,
            assigneeName: task.assignee?.name || 'Unassigned',
            managerName: manager?.name || 'Operations Lead',
            reason: 'Task incomplete after 4 hours past SLA deadline',
          },
        });

        if (escalationRes.sent) {
          results.notificationsSent++;
          results.escalationsTriggered++;

          // Record explicit TASK_ESCALATED activity event
          await prisma.activityEvent.create({
            data: {
              request_id: task.request_id,
              actor_id: manager?.id || null,
              event_type: 'TASK_ESCALATED',
              description: `Task "${task.title}" breached SLA (>4h overdue) and escalated to ${manager ? manager.name : 'Department Manager'}`,
              metadata: {
                task_id: task.id,
                due_at: task.due_at.toISOString(),
                escalated_to: manager?.id,
                manager_role: manager?.role,
              },
            },
          });
        } else if (escalationRes.skipped) {
          results.notificationsSkipped++;
        }
      }
    }

    // 2. Evaluate open requests
    const activeRequests = await prisma.request.findMany({
      where: {
        status: { notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED] },
        due_at: { not: null },
      },
    });

    results.requestsEvaluated = activeRequests.length;

    for (const req of activeRequests) {
      if (!req.due_at) continue;
      if (now.getTime() > req.due_at.getTime()) {
        results.details.overdueRequests.push(req.id);
        const res = await this.sendNotificationIdempotent({
          requestId: req.id,
          type: 'REQUEST_OVERDUE',
          recipientId: req.assigned_to || req.requester_id,
          payload: {
            title: req.title,
            dueAt: req.due_at.toISOString(),
            priority: req.priority,
          },
        });
        if (res.sent) results.notificationsSent++;
        if (res.skipped) results.notificationsSkipped++;
      }
    }

    return results;
  }

  /**
   * 7. Dashboard Metrics
   * - Open Requests
   * - Pending Approvals
   * - Overdue Tasks
   * - Due Today
   * - SLA Breaches
   * - Average Processing Time (Hours)
   */
  static async getDashboardMetrics(now: Date = new Date()): Promise<DashboardMetrics> {
    // 1. Open Requests
    const openRequestsCount = await prisma.request.count({
      where: {
        status: { notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED] },
      },
    });

    // 2. Pending Approvals
    const pendingApprovalsCount = await prisma.approval.count({
      where: {
        status: ApprovalStatus.PENDING,
      },
    });

    // 3. Overdue Tasks (active tasks past due_at)
    const overdueTasksCount = await prisma.task.count({
      where: {
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        due_at: { lt: now },
      },
    });

    // 4. Due Today
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const dueTodayCount = await prisma.task.count({
      where: {
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        due_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // 5. SLA Breaches (Total breaches: overdue tasks + late completed tasks + overdue requests)
    const lateCompletedTasksCount = await prisma.task.count({
      where: {
        status: TaskStatus.COMPLETED,
        completed_at: { not: null },
        due_at: { not: null },
        // Completed after due_at
      },
    });

    // Query actual completed tasks to compare completed_at > due_at accurately
    const completedTasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.COMPLETED,
        completed_at: { not: null },
        due_at: { not: null },
      },
      select: { due_at: true, completed_at: true },
    });
    const tasksCompletedLate = completedTasks.filter(
      (t) => t.due_at && t.completed_at && t.completed_at.getTime() > t.due_at.getTime()
    ).length;

    const overdueRequestsCount = await prisma.request.count({
      where: {
        status: { notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED] },
        due_at: { lt: now },
      },
    });

    const totalSlaBreaches = overdueTasksCount + tasksCompletedLate + overdueRequestsCount;

    // 6. Average Processing Time for completed requests
    const completedRequests = await prisma.request.findMany({
      where: {
        status: RequestStatus.COMPLETED,
      },
      select: {
        created_at: true,
        updated_at: true,
      },
    });

    let averageProcessingTimeHours = 0;
    if (completedRequests.length > 0) {
      const totalDurationMs = completedRequests.reduce((acc, req) => {
        const duration = req.updated_at.getTime() - req.created_at.getTime();
        return acc + Math.max(0, duration);
      }, 0);
      averageProcessingTimeHours = Number((totalDurationMs / completedRequests.length / (1000 * 60 * 60)).toFixed(2));
    }

    return {
      openRequests: openRequestsCount,
      pendingApprovals: pendingApprovalsCount,
      overdueTasks: overdueTasksCount,
      dueTodayTasks: dueTodayCount,
      slaBreaches: totalSlaBreaches,
      averageProcessingTimeHours,
    };
  }
}
