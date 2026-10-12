import { NextRequest } from 'next/server';
import { RequestService } from '@/lib/services/request-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const actorId = body.actorId || body.actor_id;

    const updated = await RequestService.transitionStatus(
      id,
      body.status,
      actorId,
      body.reason
    );

    return jsonResponse(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
