import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SlaService } from '@/lib/services/sla-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') || 50), 100);
    const type = searchParams.get('type');
    const taskId = searchParams.get('taskId');
    const requestId = searchParams.get('requestId');

    const where: any = {};
    if (type) where.type = type;
    if (taskId) where.task_id = taskId;
    if (requestId) where.request_id = requestId;

    const notifications = await prisma.notificationEvent.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        recipient: { select: { id: true, name: true, email: true, role: true, department: true } },
        task: { select: { id: true, title: true, priority: true, due_at: true, status: true } },
        request: { select: { id: true, title: true, priority: true, status: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: notifications,
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch notification events',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await SlaService.sendNotificationIdempotent({
      requestId: body.requestId,
      taskId: body.taskId,
      type: body.type,
      recipientId: body.recipientId,
      channel: body.channel || 'WEBHOOK',
      payload: body.payload || {},
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error sending notification:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to send notification',
      },
      { status: 400 }
    );
  }
}
