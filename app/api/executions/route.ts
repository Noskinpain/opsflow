import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma.ts';
import { ExecutionService } from '@/lib/services/execution-service.ts';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const requestId = searchParams.get('requestId');

    if (requestId) {
      const executions = await ExecutionService.getExecutionsByRequest(requestId);
      return NextResponse.json({
        success: true,
        executions,
      });
    }

    const executions = await ExecutionService.listRecentExecutions(limit);

    // Compute execution statistics
    const stats = {
      total: executions.length,
      success: executions.filter((e) => e.status === 'SUCCESS').length,
      failed: executions.filter((e) => e.status === 'FAILED').length,
      running: executions.filter((e) => e.status === 'RUNNING').length,
    };

    return NextResponse.json({
      success: true,
      stats,
      executions,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to list workflow executions',
      },
      { status: 500 }
    );
  }
}
