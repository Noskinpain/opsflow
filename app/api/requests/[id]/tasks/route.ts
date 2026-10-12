import { NextRequest } from 'next/server';
import { TaskService } from '@/lib/services/task-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const created = await TaskService.createTask({
      ...body,
      request_id: id,
    });

    return jsonResponse(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
