import { NextRequest } from 'next/server';
import { TaskService } from '@/lib/services/task-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const task = await TaskService.getTaskById(id);
    return jsonResponse(task);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const updated = await TaskService.updateTask(id, body);
    return jsonResponse(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
