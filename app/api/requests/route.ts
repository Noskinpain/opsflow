import { NextRequest } from 'next/server';
import { RequestService } from '@/lib/services/request-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { RequestStatus, Priority } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') as RequestStatus | null;
    const priority = searchParams.get('priority') as Priority | null;
    const request_type = searchParams.get('request_type') || undefined;
    const assigned_to = searchParams.get('assigned_to') || undefined;

    const requests = await RequestService.listRequests({
      status: status || undefined,
      priority: priority || undefined,
      request_type,
      assigned_to,
    });

    return jsonResponse(requests);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await RequestService.createRequest(body);
    return jsonResponse(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
