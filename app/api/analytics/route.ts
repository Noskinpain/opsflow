import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/lib/services/analytics-service';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const dateRange = (searchParams.get('dateRange') as any) || 'all';
    const requestType = searchParams.get('requestType') || undefined;
    const priority = (searchParams.get('priority') as any) || undefined;
    const status = (searchParams.get('status') as any) || undefined;
    const assigneeId = searchParams.get('assigneeId') || undefined;

    const metrics = await AnalyticsService.getOperationsMetrics({
      dateRange,
      requestType,
      priority,
      status,
      assigneeId,
    });

    return NextResponse.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    console.error('Error fetching operations analytics:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch operations analytics',
      },
      { status: 500 }
    );
  }
}
