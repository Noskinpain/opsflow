import { prisma } from '../prisma.ts';
import { TaskStatus, Priority } from '@prisma/client';
import {
  assertValidTaskTransition,
  TaskAlreadyCompletedError,
} from '../task-lifecycle.ts';
export { TaskAlreadyCompletedError };
import { isTerminalStatus } from '../state-machine.ts';
import {
  NotFoundError,
  DuplicateTaskError,
  ClosedRequestModificationError,
} from '../errors.ts';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from '../validation/schemas.ts';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  UpdateTaskStatusSchema,
} from '../validation/schemas.ts';
import { SlaService } from './sla-service.ts';

export class TaskService {
  /**
   * Spawns a new task under a request.
   * Invariants enforced:
   * 1. Parent request must exist.
   * 2. Parent request must not be in a terminal state (COMPLETED/CANCELLED/REJECTED).
   * 3. Assignee must exist if provided.
   * 4. Duplicate task check (no active task with identical title).
   * 5. Atomically records 'TASK_CREATED' (and 'TASK_ASSIGNED' if assigned) activity events.
   */
  static async createTask(input: CreateTaskInput) {
    const validated = CreateTaskSchema.parse(input);
    const requestId = validated.requestId || validated.request_id;
    const assignedTo = validated.assignedTo || validated.assigned_to || null;
    const dueAt = validated.dueAt || validated.due_at || null;
    const actorId = validated.actorId || validated.actor_id || null;

    if (!requestId) {
      throw new Error('requestId must be provided.');
    }

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        tasks: {
          where: {
            title: validated.title,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundError('Request', requestId);
    }

    if (isTerminalStatus(request.status)) {
      throw new ClosedRequestModificationError(
        request.id,
        request.status,
        'create new tasks'
      );
    }

    if (request.tasks.length > 0) {
      throw new DuplicateTaskError(request.id, validated.title);
    }

    let assigneeUser = null;
    if (assignedTo) {
      assigneeUser = await prisma.user.findUnique({
        where: { id: assignedTo },
      });
      if (!assigneeUser) {
        throw new NotFoundError('User (assignee)', assignedTo);
      }
    }

    const createdTask = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          request_id: requestId,
          title: validated.title,
          description: validated.description,
          assigned_to: assignedTo,
          priority: (validated.priority as Priority) || Priority.MEDIUM,
          status: TaskStatus.PENDING,
          due_at: dueAt
            ? new Date(dueAt)
            : SlaService.calculateDeadline((validated.priority as Priority) || Priority.MEDIUM),
        },
        include: {
          assignee: true,
        },
      });

      // 1. Log TASK_CREATED
      await tx.activityEvent.create({
        data: {
          request_id: requestId,
          actor_id: actorId,
          event_type: 'TASK_CREATED',
          description: `Task created: "${task.title}" with priority ${task.priority}`,
          metadata: {
            task_id: task.id,
            task_title: task.title,
            priority: task.priority,
            assigned_to: task.assigned_to,
          },
        },
      });

      // 2. If assigned, also log TASK_ASSIGNED
      if (assigneeUser) {
        await tx.activityEvent.create({
          data: {
            request_id: requestId,
            actor_id: actorId,
            event_type: 'TASK_ASSIGNED',
            description: `Task "${task.title}" assigned to ${assigneeUser.name}`,
            metadata: {
              task_id: task.id,
              assigned_to: assigneeUser.id,
              assignee_name: assigneeUser.name,
            },
          },
        });
      }

      return task;
    },
    { maxWait: 10000, timeout: 20000 }
  );

  // Send TASK_ASSIGNED notification outside transaction
  if (createdTask.assigned_to) {
    await SlaService.sendNotificationIdempotent({
      requestId: createdTask.request_id,
      taskId: createdTask.id,
      type: 'TASK_ASSIGNED',
      recipientId: createdTask.assigned_to,
      payload: {
        taskTitle: createdTask.title,
        priority: createdTask.priority,
        dueAt: createdTask.due_at?.toISOString(),
      },
    });
  }

  return createdTask;
  }

  /**
   * Retrieves a task by ID.
   */
  static async getTaskById(taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        request: true,
        assignee: true,
      },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    return task;
  }

  /**
   * Lists tasks with optional filters.
   */
  static async listTasks(filters?: {
    requestId?: string;
    request_id?: string;
    status?: TaskStatus;
    assignedTo?: string;
    assigned_to?: string;
  }) {
    const reqId = filters?.requestId || filters?.request_id;
    const assigned = filters?.assignedTo || filters?.assigned_to;

    return await prisma.task.findMany({
      where: {
        request_id: reqId,
        status: filters?.status,
        assigned_to: assigned,
      },
      include: {
        request: true,
        assignee: true,
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Updates task status (TODO/PENDING -> IN_PROGRESS -> COMPLETED).
   * Invariants enforced:
   * 1. Task must exist.
   * 2. Cannot modify an already completed task.
   * 3. Must follow allowed task transitions.
   * 4. Atomically logs specific activity event (TASK_STARTED, TASK_COMPLETED, etc.).
   */
  static async updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus,
    actorId?: string | null
  ) {
    UpdateTaskStatusSchema.parse({
      status: newStatus,
      actor_id: actorId,
    });

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { request: true },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new TaskAlreadyCompletedError(taskId);
    }

    assertValidTaskTransition(task.status, newStatus);

    return await prisma.$transaction(async (tx) => {
      // Milestone 9 Invariant: Atomic CAS (Compare-And-Swap) update
      // Ensures concurrent requests cannot double-complete or corrupt task status
      const updateResult = await tx.task.updateMany({
        where: {
          id: taskId,
          status: task.status,
        },
        data: {
          status: newStatus,
          completed_at: newStatus === TaskStatus.COMPLETED ? new Date() : null,
        },
      });

      if (updateResult.count === 0) {
        throw new TaskAlreadyCompletedError(taskId);
      }

      const updated = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          assignee: true,
        },
      });

      // Milestone 4 Event Type Mapping:
      let eventType = 'TASK_STATUS_UPDATED';
      let eventDesc = `Task "${task.title}" updated from ${task.status} to ${newStatus}`;

      if (newStatus === TaskStatus.IN_PROGRESS && task.status === TaskStatus.PENDING) {
        eventType = 'TASK_STARTED';
        eventDesc = `Task started: "${task.title}"`;
      } else if (newStatus === TaskStatus.COMPLETED) {
        eventType = 'TASK_COMPLETED';
        eventDesc = `Task completed: "${task.title}"`;
      } else if (newStatus === TaskStatus.CANCELLED) {
        eventType = 'TASK_CANCELLED';
        eventDesc = `Task cancelled: "${task.title}"`;
      }

      await tx.activityEvent.create({
        data: {
          request_id: task.request_id,
          actor_id: actorId || null,
          event_type: eventType,
          description: eventDesc,
          metadata: {
            task_id: task.id,
            task_title: task.title,
            from_status: task.status,
            to_status: newStatus,
            completed_at: updated.completed_at,
          },
        },
      });

      return updated;
    },
    { maxWait: 10000, timeout: 20000 }
  );
  }

  /**
   * Updates general task properties (PATCH /api/tasks/:id).
   */
  static async updateTask(taskId: string, input: UpdateTaskInput) {
    const validated = UpdateTaskSchema.parse(input);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { request: true },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.status === TaskStatus.COMPLETED && validated.status !== undefined) {
      throw new TaskAlreadyCompletedError(taskId);
    }

    const assignedTo = validated.assignedTo ?? validated.assigned_to;
    let assigneeUser = null;
    if (assignedTo) {
      assigneeUser = await prisma.user.findUnique({ where: { id: assignedTo } });
      if (!assigneeUser) {
        throw new NotFoundError('User (assignee)', assignedTo);
      }
    }

    const dueAt = validated.dueAt ?? validated.due_at;

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          title: validated.title ?? undefined,
          description: validated.description ?? undefined,
          priority: (validated.priority as Priority) ?? undefined,
          assigned_to: assignedTo !== undefined ? assignedTo : undefined,
          due_at: dueAt !== undefined ? (dueAt ? new Date(dueAt) : null) : undefined,
          status: validated.status ?? undefined,
          completed_at: validated.status === TaskStatus.COMPLETED ? new Date() : undefined,
        },
        include: {
          assignee: true,
        },
      });

      // If assignee changed, log TASK_ASSIGNED
      if (assignedTo && assignedTo !== task.assigned_to && assigneeUser) {
        await tx.activityEvent.create({
          data: {
            request_id: task.request_id,
            actor_id: validated.actorId || validated.actor_id || null,
            event_type: 'TASK_ASSIGNED',
            description: `Task "${task.title}" assigned to ${assigneeUser.name}`,
            metadata: {
              task_id: task.id,
              assigned_to: assigneeUser.id,
              assignee_name: assigneeUser.name,
            },
          },
        });
      }

      return updatedTask;
    },
    { maxWait: 10000, timeout: 20000 }
  );

  if (assignedTo && assignedTo !== task.assigned_to) {
    await SlaService.sendNotificationIdempotent({
      requestId: updated.request_id,
      taskId: updated.id,
      type: 'TASK_ASSIGNED',
      recipientId: assignedTo,
      payload: {
        taskTitle: updated.title,
        priority: updated.priority,
        dueAt: updated.due_at?.toISOString(),
      },
    });
  }

  return updated;
  }

  /**
   * Assigns a task to a user.
   */
  static async assignTask(
    taskId: string,
    assigneeId: string,
    actorId?: string | null
  ) {
    return await this.updateTask(taskId, {
      assignedTo: assigneeId,
      actorId,
    });
  }

  /**
   * Lists all tasks for a specific request.
   */
  static async listTasksByRequest(requestId: string) {
    return await prisma.task.findMany({
      where: { request_id: requestId },
      include: { assignee: true },
      orderBy: { created_at: 'asc' },
    });
  }
}
