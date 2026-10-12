import { NextRequest } from 'next/server';
import { RequestService } from '@/lib/services/request-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const request = await RequestService.getRequestById(id);
    return jsonResponse(request);
  } catch (error) {
    return handleApiError(error);
  }
}
