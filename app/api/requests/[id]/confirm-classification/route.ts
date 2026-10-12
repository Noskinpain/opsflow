import { NextRequest } from 'next/server';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { jsonResponse, handleApiError } from '@/lib/api-response';
import { ConfirmClassificationSchema } from '@/lib/validation/schemas';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Milestone 7: Human-in-the-Loop AI Classification Confirmation
 * POST /api/requests/:id/confirm-classification
 * 
 * Allows a human operator to confirm or override an uncertain AI classification (confidence < threshold),
 * transitioning the request from AWAITING_REVIEW -> PROCESSING and resuming workflow execution.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));

    const validated = ConfirmClassificationSchema.parse(body);
    const result = await WorkflowEngine.confirmClassification(id, validated);

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
