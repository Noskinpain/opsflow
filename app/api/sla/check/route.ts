import { NextResponse } from 'next/server';
import { SlaService } from '@/lib/services/sla-service';

export async function POST(request: Request) {
  try {
    let now = new Date();
    try {
      const body = await request.json();
      if (body?.now) {
        now = new Date(body.now);
      }
    } catch {
      // Body is optional
    }

    const results = await SlaService.processScheduledSlaChecks(now);

    return NextResponse.json({
      success: true,
      message: 'SLA deadline check completed successfully',
      data: results,
    });
  } catch (error: any) {
    console.error('Error running SLA checks:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error during SLA check',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Allow checking current metrics / SLA summary via GET
  try {
    const metrics = await SlaService.getDashboardMetrics();
    return NextResponse.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
