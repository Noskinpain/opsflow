import { RequestStatus } from '@prisma/client';

/**
 * Formal state transition map for Requests.
 * Keys represent the current state; values represent permitted next states.
 */
export const ALLOWED_REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  NEW: ['PROCESSING', 'AWAITING_REVIEW', 'CANCELLED'],
  PROCESSING: ['AWAITING_REVIEW', 'REJECTED', 'CANCELLED'],
  AWAITING_REVIEW: ['AWAITING_APPROVAL', 'PROCESSING', 'CANCELLED'],
  AWAITING_APPROVAL: ['IN_PROGRESS', 'REJECTED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  // Terminal states - no transitions out
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
} as const;

/**
 * Terminal states that cannot be transitioned out of once reached.
 */
export const TERMINAL_REQUEST_STATES: readonly RequestStatus[] = [
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export class InvalidStateTransitionError extends Error {
  public readonly from: RequestStatus;
  public readonly to: RequestStatus;

  constructor(from: RequestStatus, to: RequestStatus, message?: string) {
    super(
      message ||
        `Invalid request transition: Cannot move from '${from}' to '${to}'. Allowed transitions from '${from}': [${
          ALLOWED_REQUEST_TRANSITIONS[from].join(', ') || 'none (terminal state)'
        }].`
    );
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class IncompleteTasksError extends Error {
  public readonly requestId: string;
  public readonly openTaskCount: number;

  constructor(requestId: string, openTaskCount: number) {
    super(
      `Cannot complete request '${requestId}': There are ${openTaskCount} open task(s) that must be finished first.`
    );
    this.name = 'IncompleteTasksError';
    this.requestId = requestId;
    this.openTaskCount = openTaskCount;
  }
}

/**
 * Checks if a given status is a terminal state.
 */
export function isTerminalStatus(status: RequestStatus): boolean {
  return (TERMINAL_REQUEST_STATES as readonly string[]).includes(status);
}

/**
 * Checks if a state transition is permitted by the formal state machine.
 */
export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  if (from === to) {
    return false; // No-op transitions are rejected to prevent duplicate events
  }
  const allowedNext = ALLOWED_REQUEST_TRANSITIONS[from];
  return allowedNext.includes(to);
}

/**
 * Milestone 3 requirement: canTransition(currentStatus, nextStatus)
 */
export const canTransition = canTransitionRequest;

/**
 * Asserts that a state transition is valid, throwing InvalidStateTransitionError if not.
 */
export function assertValidRequestTransition(
  from: RequestStatus,
  to: RequestStatus
): void {
  if (!canTransitionRequest(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
