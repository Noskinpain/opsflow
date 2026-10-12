import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Execution ID is required' }, { status: 400 });
    }

    const execution = await prisma.workflowExecution.findUnique({
      where: { id },
      include: {
        request: {
          include: {
            requester: { select: { id: true, name: true, email: true, department: true } },
            assignee: { select: { id: true, name: true, email: true, department: true } },
            tasks: true,
            approvals: true,
            ai_analyses: true,
          },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      execution,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve workflow execution' },
      { status: 500 }
    );
  }
}
