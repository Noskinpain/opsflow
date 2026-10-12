import { NextRequest } from 'next/server';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { jsonResponse, handleApiError } from '@/lib/api-response';
import { DecideApprovalSchema } from '@/lib/validation/schemas';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { ApprovalDecision } from '@prisma/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Milestone 7: Approval API
 * POST /api/approvals/:id/decision
 * 
 * Verifies on the server:
 * 1. Approval exists
 * 2. Approver is authorized (Role is MANAGER or ADMIN, or matches designated approver)
 * 3. Approval is still PENDING
 * 4. Request is in AWAITING_APPROVAL state
 * 5. Decision is valid ('APPROVED' or 'REJECTED')
 * 
 * Triggers the workflow engine to advance execution or halt upon rejection.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const validated = DecideApprovalSchema.parse(body);

    let approverId = validated.approverId || validated.approver_id || validated.actor_id;

    // If approverId was not passed in body, lookup the approval to get the assigned approver
    if (!approverId) {
      const existing = await prisma.approval.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new NotFoundError('Approval', id);
      }
      approverId = existing.approver_id;
    }

    const result = await WorkflowEngine.decideApproval(
      id,
      validated.decision as ApprovalDecision,
      approverId,
      validated.comment || undefined
    );

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
