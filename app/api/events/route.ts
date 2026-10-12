import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { IdempotencyService } from '@/lib/reliability/idempotency.ts';
import { WorkflowEngine } from '@/lib/workflows/engine.ts';
import { TaskService } from '@/lib/services/task-service.ts';
import { RequestService } from '@/lib/services/request-service.ts';
import { TaskStatus, RequestStatus } from '@prisma/client';

const eventSchema = z.object({
  eventId: z.string().min(1, 'eventId is required for idempotent processing'),
  eventType: z.enum([
    'TASK_COMPLETED',
    'TASK_IN_PROGRESS',
    'WORKFLOW_TRIGGER',
    'REQUEST_CANCELLED',
    'PING',
  ]),
  data: z.record(z.string(), z.any()).default({}),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = eventSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid event payload',
          issues: validation.error.format(),
        },
        { status: 400 }
      );
    }

    const { eventId, eventType, data } = validation.data;

    const result = await IdempotencyService.runIdempotent(
      eventId,
      eventType,
      data,
      async () => {
        switch (eventType) {
          case 'TASK_COMPLETED': {
            if (!data.taskId) {
              throw new Error('taskId is required in data for TASK_COMPLETED event');
            }
            return await WorkflowEngine.completeTaskAndAdvance(
              data.taskId,
              data.actorId ?? null
            );
          }

          case 'TASK_IN_PROGRESS': {
            if (!data.taskId) {
              throw new Error('taskId is required in data for TASK_IN_PROGRESS event');
            }
            return await TaskService.updateTaskStatus(
              data.taskId,
              TaskStatus.IN_PROGRESS,
              data.actorId ?? null
            );
          }

          case 'WORKFLOW_TRIGGER': {
            if (!data.requestId) {
              throw new Error('requestId is required in data for WORKFLOW_TRIGGER event');
            }
            return await WorkflowEngine.initiateWorkflow(
              data.requestId,
              data.actorId ?? null
            );
          }

          case 'REQUEST_CANCELLED': {
            if (!data.requestId) {
              throw new Error('requestId is required in data for REQUEST_CANCELLED event');
            }
            return await RequestService.transitionStatus(
              data.requestId,
              RequestStatus.CANCELLED,
              data.actorId ?? null,
              data.reason || 'External event triggered cancellation'
            );
          }

          case 'PING': {
            return {
              pong: true,
              receivedAt: new Date().toISOString(),
              echoData: data,
            };
          }

          default:
            throw new Error(`Unhandled event type: ${eventType}`);
        }
      }
    );

    return NextResponse.json({
      success: true,
      eventId,
      eventType,
      cached: result.cached,
      processedAt: result.processedAt,
      data: result.data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to process event',
      },
      { status: 500 }
    );
  }
}
