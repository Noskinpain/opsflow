export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} with ID '${id}' was not found.`);
    this.name = 'NotFoundError';
  }
}

export class DuplicateAssignmentError extends Error {
  constructor(requestId: string, userId: string) {
    super(`Request '${requestId}' is already assigned to user '${userId}'.`);
    this.name = 'DuplicateAssignmentError';
  }
}

export class ClosedRequestModificationError extends Error {
  constructor(requestId: string, status: string, action: string) {
    super(`Cannot ${action} on request '${requestId}' because it is in terminal state '${status}'.`);
    this.name = 'ClosedRequestModificationError';
  }
}

export class DuplicateTaskError extends Error {
  constructor(requestId: string, title: string) {
    super(`An active task with title "${title}" already exists on request '${requestId}'.`);
    this.name = 'DuplicateTaskError';
  }
}

export class PrerequisiteNotMetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrerequisiteNotMetError';
  }
}

export class UnauthorizedApproverError extends Error {
  constructor(userId: string, role: string, requiredRole: string) {
    super(
      `User '${userId}' with role '${role}' is not authorized to decide this approval. Required role: '${requiredRole}'.`
    );
    this.name = 'UnauthorizedApproverError';
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(approvalId: string, currentStatus: string) {
    super(
      `Approval '${approvalId}' cannot be decided because it is already '${currentStatus}'.`
    );
    this.name = 'ApprovalAlreadyDecidedError';
  }
}

export class InvalidApprovalStateError extends Error {
  constructor(requestId: string, currentStatus: string) {
    super(
      `Cannot decide approval for request '${requestId}': request is in state '${currentStatus}', but must be 'AWAITING_APPROVAL'.`
    );
    this.name = 'InvalidApprovalStateError';
  }
}
