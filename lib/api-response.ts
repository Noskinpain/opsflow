import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  NotFoundError,
  DuplicateAssignmentError,
  ClosedRequestModificationError,
  DuplicateTaskError,
  PrerequisiteNotMetError,
  UnauthorizedApproverError,
  ApprovalAlreadyDecidedError,
  InvalidApprovalStateError,
} from '@/lib/errors';
import {
  InvalidStateTransitionError,
  IncompleteTasksError,
} from '@/lib/state-machine';
import {
  InvalidTaskTransitionError,
  TaskAlreadyCompletedError,
} from '@/lib/task-lifecycle';

export function handleApiError(error: unknown) {
  console.error('[API Error]:', error);

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid input parameters.',
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  if (error instanceof NotFoundError) {
    return NextResponse.json(
      {
        success: false,
        error: 'NOT_FOUND',
        message: error.message,
      },
      { status: 404 }
    );
  }

  if (error instanceof UnauthorizedApproverError) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED_APPROVER',
        message: error.message,
      },
      { status: 403 }
    );
  }

  if (error instanceof ApprovalAlreadyDecidedError) {
    return NextResponse.json(
      {
        success: false,
        error: 'APPROVAL_ALREADY_DECIDED',
        message: error.message,
      },
      { status: 409 }
    );
  }

  if (
    error instanceof InvalidStateTransitionError ||
    error instanceof InvalidTaskTransitionError ||
    error instanceof InvalidApprovalStateError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_STATE_TRANSITION',
        message: error.message,
      },
      { status: 422 }
    );
  }

  if (error instanceof IncompleteTasksError) {
    return NextResponse.json(
      {
        success: false,
        error: 'INCOMPLETE_TASKS',
        message: error.message,
        openTaskCount: error.openTaskCount,
      },
      { status: 409 }
    );
  }

  if (
    error instanceof DuplicateAssignmentError ||
    error instanceof DuplicateTaskError ||
    error instanceof TaskAlreadyCompletedError ||
    error instanceof ClosedRequestModificationError ||
    error instanceof PrerequisiteNotMetError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVARIANT_VIOLATION',
        message: error.message,
      },
      { status: 409 }
    );
  }

  const message = error instanceof Error ? error.message : 'Internal Server Error';
  return NextResponse.json(
    {
      success: false,
      error: 'SERVER_ERROR',
      message,
    },
    { status: 500 }
  );
}

export function jsonResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
