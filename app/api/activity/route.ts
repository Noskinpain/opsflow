import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, jsonResponse } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get('requestId') || undefined;
    const eventType = searchParams.get('eventType') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const where: any = {};
    if (requestId) where.request_id = requestId;
    if (eventType) where.event_type = eventType;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { event_type: { contains: search, mode: 'insensitive' } },
      ];
    }

    const events = await prisma.activityEvent.findMany({
      where,
      include: {
        actor: {
          select: { id: true, name: true, email: true, role: true, department: true },
        },
        request: {
          select: { id: true, title: true, request_type: true, status: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return jsonResponse(events);
  } catch (error) {
    return handleApiError(error);
  }
}
