import { NextRequest, NextResponse } from 'next/server';
import { WorkflowEngine } from '@/lib/workflows/engine.ts';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Execution ID is required' }, { status: 400 });
    }

    const result = await WorkflowEngine.retryExecution(id);

    return NextResponse.json({
      success: true,
      message: 'Workflow execution successfully retried.',
      result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to retry workflow execution',
      },
      { status: 500 }
    );
  }
}
