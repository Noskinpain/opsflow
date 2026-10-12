import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma.ts';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { ApprovalStatus } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status') as ApprovalStatus | null;
    const approverId = searchParams.get('approverId') || undefined;
    const requestId = searchParams.get('requestId') || undefined;

    const where: any = {};
    if (statusParam) where.status = statusParam;
    if (approverId) where.approver_id = approverId;
    if (requestId) where.request_id = requestId;

    const approvals = await prisma.approval.findMany({
      where,
      include: {
        approver: {
          select: { id: true, name: true, email: true, role: true, department: true },
        },
        request: {
          select: {
            id: true,
            title: true,
            request_type: true,
            priority: true,
            status: true,
            created_at: true,
            due_at: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return jsonResponse(approvals);
  } catch (error) {
    return handleApiError(error);
  }
}
