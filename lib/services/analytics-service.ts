import { prisma } from '../prisma.ts';
import { RequestStatus, TaskStatus, ApprovalStatus, Priority } from '@prisma/client';

export interface AnalyticsFilter {
  dateRange?: 'today' | '7d' | '30d' | 'all';
  requestType?: string;
  priority?: Priority | 'ALL';
  status?: RequestStatus | 'ALL';
  assigneeId?: string;
}

export interface OperationsMetrics {
  openRequests: number;
  pendingApprovals: number;
  activeTasks: number;
  overdueTasks: number;
  completedRequests: number;
  totalCohortRequests: number;
  averageProcessingTimeHours: number;
  averageProcessingTimeFormatted: string;
  slaBreachRatePercent: number;
  completionRatePercent: number;
  applicableSlaRequestsCount: number;
  breachedSlaRequestsCount: number;
  
  // Workload distributions
  workloadByAssignee: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    department: string;
    openRequestsCount: number;
    activeTasksCount: number;
    overdueTasksCount: number;
  }>;
  requestsByType: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
  requestsByPriority: Array<{
    priority: string;
    count: number;
  }>;
  
  // Urgent items needing attention
  attentionItems: {
    pendingApprovals: Array<{
      approvalId: string;
      requestId: string;
      requestTitle: string;
      approverName: string;
      priority: string;
      createdAt: Date;
    }>;
    overdueTasks: Array<{
      taskId: string;
      requestId: string;
      requestTitle: string;
      taskTitle: string;
      assigneeName: string;
      dueAt: Date | null;
      hoursOverdue: number;
    }>;
    breachedRequests: Array<{
      requestId: string;
      title: string;
      status: string;
      priority: string;
      dueAt: Date | null;
      hoursOverdue: number;
    }>;
  };
}

export class AnalyticsService {
  /**
   * Calculates authoritative operations dashboard metrics directly from PostgreSQL records.
   * Milestone 10: Accurate definitions, cohort filtering, and multi-dimensional distribution.
   */
  static async getOperationsMetrics(filter: AnalyticsFilter = {}): Promise<OperationsMetrics> {
    const now = new Date();
    
    // 1. Calculate Date Range Boundary
    let startDate: Date | undefined;
    if (filter.dateRange === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filter.dateRange === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    } else if (filter.dateRange === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    }

    // 2. Build Prisma Request Filter
    const requestWhere: any = {};
    if (startDate) {
      requestWhere.created_at = { gte: startDate };
    }
    if (filter.requestType && filter.requestType !== 'ALL') {
      requestWhere.request_type = filter.requestType;
    }
    if (filter.priority && filter.priority !== 'ALL') {
      requestWhere.priority = filter.priority;
    }
    if (filter.status && filter.status !== 'ALL') {
      requestWhere.status = filter.status;
    }
    if (filter.assigneeId && filter.assigneeId !== 'ALL') {
      requestWhere.assigned_to = filter.assigneeId;
    }

    // 3. Query Requests, Tasks, Approvals, and Users in Parallel
    const [
      cohortRequests,
      allOpenRequests,
      allActiveTasks,
      allPendingApprovals,
      allUsers,
    ] = await Promise.all([
      // Cohort requests matching current filters
      prisma.request.findMany({
        where: requestWhere,
        include: {
          assignee: true,
          requester: true,
          tasks: true,
        },
      }),

      // Global or filtered Open Requests (NEW, PROCESSING, AWAITING_REVIEW, AWAITING_APPROVAL, IN_PROGRESS)
      prisma.request.findMany({
        where: {
          ...requestWhere,
          status: {
            notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED],
          },
        },
      }),

      // Active tasks (PENDING, IN_PROGRESS)
      prisma.task.findMany({
        where: {
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          ...(filter.assigneeId && filter.assigneeId !== 'ALL' ? { assigned_to: filter.assigneeId } : {}),
        },
        include: {
          assignee: true,
          request: true,
        },
      }),

      // Pending Approvals
      prisma.approval.findMany({
        where: {
          status: ApprovalStatus.PENDING,
        },
        include: {
          approver: true,
          request: true,
        },
      }),

      // Users for workload distribution
      prisma.user.findMany({
        orderBy: { name: 'asc' },
      }),
    ]);

    // 4. Metric 1: Open Requests
    const openRequestsCount = allOpenRequests.length;

    // 5. Metric 2: Pending Approvals
    const pendingApprovalsCount = allPendingApprovals.length;

    // 6. Metric 3: Active Tasks
    const activeTasksCount = allActiveTasks.length;

    // 7. Metric 4: Overdue Tasks (missed deadline and not completed/cancelled)
    const overdueTasks = allActiveTasks.filter(
      (t) => t.due_at && new Date(t.due_at).getTime() < now.getTime()
    );
    const overdueTasksCount = overdueTasks.length;

    // 8. Metric 5: Completed Requests in selected cohort
    const completedRequests = cohortRequests.filter(
      (r) => r.status === RequestStatus.COMPLETED
    );
    const completedRequestsCount = completedRequests.length;
    const totalCohortRequests = cohortRequests.length;

    // 9. Metric 6: Average Processing Time
    // Formula: Sum(completed_at - created_at) / completedRequestsCount
    let totalProcessingTimeMs = 0;
    for (const req of completedRequests) {
      // Find completion event or last completed task / updated_at
      const completionTime = req.updated_at.getTime();
      const creationTime = req.created_at.getTime();
      const duration = Math.max(0, completionTime - creationTime);
      totalProcessingTimeMs += duration;
    }

    const averageProcessingTimeHours =
      completedRequestsCount > 0
        ? Number((totalProcessingTimeMs / completedRequestsCount / (1000 * 3600)).toFixed(2))
        : 0;

    const avgMinutes =
      completedRequestsCount > 0
        ? Math.round(totalProcessingTimeMs / completedRequestsCount / (1000 * 60))
        : 0;
    const averageProcessingTimeFormatted =
      avgMinutes >= 60
        ? `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m`
        : `${avgMinutes}m`;

    // 10. Metric 7: SLA Breach Rate
    // Denominator: Applicable requests with an SLA deadline (due_at != null)
    const applicableSlaRequests = cohortRequests.filter((r) => r.due_at !== null);
    const applicableSlaRequestsCount = applicableSlaRequests.length;

    const breachedSlaRequests = applicableSlaRequests.filter((r) => {
      if (r.status === RequestStatus.COMPLETED) {
        // If completed late
        return r.updated_at.getTime() > new Date(r.due_at!).getTime();
      }
      // If still open and past deadline
      return now.getTime() > new Date(r.due_at!).getTime();
    });
    const breachedSlaRequestsCount = breachedSlaRequests.length;

    const slaBreachRatePercent =
      applicableSlaRequestsCount > 0
        ? Number(((breachedSlaRequestsCount / applicableSlaRequestsCount) * 100).toFixed(1))
        : 0;

    // 11. Metric 8: Completion Rate
    // Formula: Completed requests / Total cohort requests * 100
    const completionRatePercent =
      totalCohortRequests > 0
        ? Number(((completedRequestsCount / totalCohortRequests) * 100).toFixed(1))
        : 0;

    // 12. Workload Distribution by Assignee
    const workloadByAssignee = allUsers.map((user) => {
      const userOpenReqs = allOpenRequests.filter((r) => r.assigned_to === user.id).length;
      const userActiveTasks = allActiveTasks.filter((t) => t.assigned_to === user.id).length;
      const userOverdueTasks = overdueTasks.filter((t) => t.assigned_to === user.id).length;

      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        department: user.department,
        openRequestsCount: userOpenReqs,
        activeTasksCount: userActiveTasks,
        overdueTasksCount: userOverdueTasks,
      };
    }).filter((w) => w.openRequestsCount > 0 || w.activeTasksCount > 0);

    // 13. Distribution by Request Type
    const typeCounts: Record<string, number> = {};
    for (const req of cohortRequests) {
      typeCounts[req.request_type] = (typeCounts[req.request_type] || 0) + 1;
    }
    const requestsByType = Object.entries(typeCounts).map(([type, count]) => ({
      type,
      count,
      percentage: totalCohortRequests > 0 ? Number(((count / totalCohortRequests) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.count - a.count);

    // 14. Distribution by Priority
    const priorityCounts: Record<string, number> = {};
    for (const req of cohortRequests) {
      priorityCounts[req.priority] = (priorityCounts[req.priority] || 0) + 1;
    }
    const requestsByPriority = Object.entries(priorityCounts).map(([priority, count]) => ({
      priority,
      count,
    }));

    // 15. Urgent Attention Items
    const attentionPendingApprovals = allPendingApprovals.slice(0, 10).map((a) => ({
      approvalId: a.id,
      requestId: a.request_id,
      requestTitle: a.request.title,
      approverName: a.approver.name,
      priority: a.request.priority,
      createdAt: a.created_at,
    }));

    const attentionOverdueTasks = overdueTasks.slice(0, 10).map((t) => {
      const hoursOverdue = t.due_at
        ? Number(((now.getTime() - new Date(t.due_at).getTime()) / 3600000).toFixed(1))
        : 0;
      return {
        taskId: t.id,
        requestId: t.request_id,
        requestTitle: t.request.title,
        taskTitle: t.title,
        assigneeName: t.assignee?.name || 'Unassigned',
        dueAt: t.due_at,
        hoursOverdue,
      };
    });

    const attentionBreachedRequests = breachedSlaRequests
      .filter((r) => r.status !== RequestStatus.COMPLETED)
      .slice(0, 10)
      .map((r) => {
        const hoursOverdue = r.due_at
          ? Number(((now.getTime() - new Date(r.due_at).getTime()) / 3600000).toFixed(1))
          : 0;
        return {
          requestId: r.id,
          title: r.title,
          status: r.status,
          priority: r.priority,
          dueAt: r.due_at,
          hoursOverdue,
        };
      });

    return {
      openRequests: openRequestsCount,
      pendingApprovals: pendingApprovalsCount,
      activeTasks: activeTasksCount,
      overdueTasks: overdueTasksCount,
      completedRequests: completedRequestsCount,
      totalCohortRequests,
      averageProcessingTimeHours,
      averageProcessingTimeFormatted,
      slaBreachRatePercent,
      completionRatePercent,
      applicableSlaRequestsCount,
      breachedSlaRequestsCount,
      workloadByAssignee,
      requestsByType,
      requestsByPriority,
      attentionItems: {
        pendingApprovals: attentionPendingApprovals,
        overdueTasks: attentionOverdueTasks,
        breachedRequests: attentionBreachedRequests,
      },
    };
  }
}
