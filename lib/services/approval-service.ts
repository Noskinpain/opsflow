import { prisma } from '../prisma.ts';
import { ApprovalStatus, ApprovalDecision } from '@prisma/client';
import {
  NotFoundError,
  ClosedRequestModificationError,
  ApprovalAlreadyDecidedError,
} from '../errors.ts';
export { ApprovalAlreadyDecidedError };
import { isTerminalStatus } from '../state-machine.ts';
import type {
  CreateApprovalInput,
  DecideApprovalInput,
} from '../validation/schemas.ts';
import {
  CreateApprovalSchema,
  DecideApprovalSchema,
} from '../validation/schemas.ts';
import { SlaService } from './sla-service.ts';

export class ApprovalService {
  /**
   * Creates an approval request on a Request.
   */
  static async createApproval(input: CreateApprovalInput) {
    const validated = CreateApprovalSchema.parse(input);

    const request = await prisma.request.findUnique({
      where: { id: validated.request_id },
    });
    if (!request) {
      throw new NotFoundError('Request', validated.request_id);
    }

    if (isTerminalStatus(request.status)) {
      throw new ClosedRequestModificationError(
        request.id,
        request.status,
        'request approval'
      );
    }

    const approver = await prisma.user.findUnique({
      where: { id: validated.approver_id },
    });
    if (!approver) {
      throw new NotFoundError('User (approver)', validated.approver_id);
    }

    const createdApproval = await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.create({
        data: {
          request_id: validated.request_id,
          approver_id: validated.approver_id,
          status: ApprovalStatus.PENDING,
        },
      });

      await tx.activityEvent.create({
        data: {
          request_id: validated.request_id,
          actor_id: validated.actor_id || null,
          event_type: 'APPROVAL_REQUESTED',
          description: `Approval requested from ${approver.name} (${approver.role})`,
          metadata: {
            approval_id: approval.id,
            approver_id: approver.id,
            approver_name: approver.name,
          },
        },
      });

      return approval;
    });

    // Milestone 8: Emit APPROVAL_REQUESTED notification idempotently
    await SlaService.sendNotificationIdempotent({
      requestId: validated.request_id,
      type: 'APPROVAL_REQUESTED',
      recipientId: validated.approver_id,
      payload: {
        approvalId: createdApproval.id,
        approverName: approver.name,
      },
    });

    return createdApproval;
  }

  /**
   * Decides an approval (APPROVED or REJECTED).
   * Invariant: Once decided, an approval cannot be changed.
   */
  static async decideApproval(approvalId: string, input: DecideApprovalInput) {
    const validated = DecideApprovalSchema.parse(input);

    const approval = await prisma.approval.findUnique({
      where: { id: approvalId },
      include: { approver: true, request: true },
    });

    if (!approval) {
      throw new NotFoundError('Approval', approvalId);
    }

    if (approval.status === ApprovalStatus.DECIDED) {
      throw new ApprovalAlreadyDecidedError(approvalId, approval.status);
    }

    return await prisma.$transaction(async (tx) => {
      // Milestone 9 Invariant: Atomic conditional update
      // Effectively executes: UPDATE approvals SET status='DECIDED' WHERE id=? AND status='PENDING'
      // If count === 0, another concurrent transaction won the race.
      const updateResult = await tx.approval.updateMany({
        where: {
          id: approvalId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.DECIDED,
          decision: validated.decision as ApprovalDecision,
          comment: validated.comment,
          decided_at: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new ApprovalAlreadyDecidedError(approvalId, 'ALREADY_DECIDED');
      }

      const updated = await tx.approval.findUniqueOrThrow({
        where: { id: approvalId },
        include: { approver: true, request: true },
      });

      await tx.activityEvent.create({
        data: {
          request_id: approval.request_id,
          actor_id: validated.actor_id || approval.approver_id,
          event_type: 'APPROVAL_DECIDED',
          description: `Approval decided: ${validated.decision} by ${approval.approver.name}${
            validated.comment ? ` - "${validated.comment}"` : ''
          }`,
          metadata: {
            approval_id: approval.id,
            decision: validated.decision,
            comment: validated.comment || null,
            decided_at: updated.decided_at,
          },
        },
      });

      return updated;
    });
  }
}
