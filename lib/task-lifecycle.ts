import { TaskStatus } from '@prisma/client';

export const ALLOWED_TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'PENDING'],
  COMPLETED: [], // Terminal
  CANCELLED: [], // Terminal
} as const;

export class InvalidTaskTransitionError extends Error {
  public readonly from: TaskStatus;
  public readonly to: TaskStatus;

  constructor(from: TaskStatus, to: TaskStatus, message?: string) {
    super(
      message ||
        `Invalid task transition: Cannot move from '${from}' to '${to}'. Allowed: [${
          ALLOWED_TASK_TRANSITIONS[from].join(', ') || 'none'
        }].`
    );
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class TaskAlreadyCompletedError extends Error {
  constructor(taskId: string) {
    super(`Task '${taskId}' is already completed and cannot be modified.`);
    this.name = 'TaskAlreadyCompletedError';
  }
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TASK_TRANSITIONS[from].includes(to);
}

export function assertValidTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === 'COMPLETED') {
    throw new InvalidTaskTransitionError(
      from,
      to,
      `Task is already COMPLETED and cannot transition to '${to}'.`
    );
  }
  if (!canTransitionTask(from, to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
}
