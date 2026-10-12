import { NextResponse } from 'next/server';
import { runAiEvaluation } from '@/scripts/evaluate-ai-classifier';

export async function GET() {
  try {
    const report = await runAiEvaluation();

    const perClass: Record<string, { support: number; precision: number; recall: number; f1: number }> = {};
    if (Array.isArray(report.perClassMetrics)) {
      for (const c of report.perClassMetrics) {
        perClass[c.className] = {
          support: c.support,
          precision: c.precision / 100,
          recall: c.recall / 100,
          f1: c.f1Score / 100,
        };
      }
    }

    const summary = {
      total: report.totalSamples,
      correctCount: report.correctClassifications,
      accuracyFormatted: `${report.accuracyPercent}%`,
      macroF1Formatted: `${(report.macroF1Score * 100).toFixed(1)}%`,
      schemaValidityFormatted: `${report.schemaValidityRatePercent}%`,
      missingInfoRateFormatted: `${report.missingInfoDetectionRatePercent}%`,
      averageLatencyMs: Math.round(report.averageLatencyMs),
      costPerRequest: report.estimatedCostPerRequestUsd?.toFixed(5) || '0.00012',
    };

    return NextResponse.json({
      success: true,
      data: {
        summary,
        perClass,
        report,
      },
      summary,
      perClass,
      report,
    });
  } catch (error: any) {
    console.error('Error running AI evaluation:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to evaluate AI classifier',
      },
      { status: 500 }
    );
  }
}
