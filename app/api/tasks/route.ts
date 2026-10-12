import { NextRequest } from 'next/server';
import { TaskService } from '@/lib/services/task-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { TaskStatus } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get('requestId') || searchParams.get('request_id') || undefined;
    const statusParam = searchParams.get('status') as TaskStatus | null;
    const assignedTo = searchParams.get('assignedTo') || searchParams.get('assigned_to') || undefined;

    const tasks = await TaskService.listTasks({
      requestId,
      status: statusParam || undefined,
      assignedTo,
    });

    return jsonResponse(tasks);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await TaskService.createTask(body);
    return jsonResponse(created, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
