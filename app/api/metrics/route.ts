import { NextResponse } from 'next/server';
import { SlaService } from '@/lib/services/sla-service';

export async function GET() {
  try {
    const metrics = await SlaService.getDashboardMetrics();
    return NextResponse.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    console.error('Error fetching dashboard metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch dashboard metrics',
      },
      { status: 500 }
    );
  }
}
