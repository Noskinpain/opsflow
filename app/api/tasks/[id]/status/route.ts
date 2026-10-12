import { NextRequest } from 'next/server';
import { TaskService } from '@/lib/services/task-service';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { TaskStatus } from '@prisma/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const actorId = body.actorId || body.actor_id;

    const updated = await TaskService.updateTaskStatus(
      id,
      body.status,
      actorId
    );

    // Milestone 6: Event-driven workflow advancement upon task completion
    if (body.status === 'COMPLETED' || body.status === TaskStatus.COMPLETED) {
      try {
        const { WorkflowEngine } = await import('@/lib/workflows/engine');
        await WorkflowEngine.onTaskCompleted(id, actorId);
      } catch (wfErr) {
        console.warn('Workflow advancement after task completion error:', wfErr);
      }
    }

    return jsonResponse(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
