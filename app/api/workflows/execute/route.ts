import { NextRequest } from 'next/server';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { jsonResponse, handleApiError } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const requestId = body.requestId || body.request_id;
    const actorId = body.actorId || body.actor_id;

    if (!requestId) {
      return jsonResponse({ error: 'requestId is required' }, 400);
    }

    const result = await WorkflowEngine.initiateWorkflow(requestId, actorId);
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
