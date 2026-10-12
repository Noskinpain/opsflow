import { AI_BENCHMARK_DATASET, type EvaluationSample } from './ai-evaluation-dataset.ts';
import { AiClassifierService } from '../lib/services/ai-classifier-service.ts';
import { AiClassificationOutputSchema } from '../lib/validation/schemas.ts';

export interface ClassMetrics {
  className: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
}

export interface AiEvaluationReport {
  timestamp: string;
  totalSamples: number;
  correctClassifications: number;
  accuracyPercent: number;
  schemaValidityRatePercent: number;
  missingInfoDetectionRatePercent: number;
  actionabilityDetectionRatePercent: number;
  failureRatePercent: number;
  averageLatencyMs: number;
  totalLatencyMs: number;
  estimatedCostPerRequestUsd: number;
  estimatedTotalCostUsd: number;
  perClassMetrics: ClassMetrics[];
  macroF1Score: number;
  sampleResults: Array<{
    id: number;
    title: string;
    expectedType: string;
    predictedType: string;
    passed: boolean;
    latencyMs: number;
    confidence: number;
    isActionable: boolean;
    missingInfoFound: boolean;
  }>;
}

export async function runAiEvaluation(): Promise<AiEvaluationReport> {
  const samples = AI_BENCHMARK_DATASET;
  const startTime = Date.now();
  
  let correctClassifications = 0;
  let schemaValidCount = 0;
  let failuresCount = 0;
  let totalLatency = 0;
  
  let missingInfoTargetCount = 0;
  let missingInfoDetectedCount = 0;

  let actionabilityTargetCount = 0;
  let actionabilityCorrectCount = 0;

  // Track per-class statistics
  const distinctClasses = Array.from(new Set(samples.map((s) => s.expectedType)));
  const classStats: Record<string, { tp: number; fp: number; fn: number; support: number }> = {};
  for (const c of distinctClasses) {
    classStats[c] = { tp: 0, fp: 0, fn: 0, support: 0 };
  }

  const sampleResults: AiEvaluationReport['sampleResults'] = [];

  for (const sample of samples) {
    classStats[sample.expectedType].support++;
    if (sample.hasMissingInformation) missingInfoTargetCount++;
    actionabilityTargetCount++;

    const sampleStart = Date.now();
    try {
      const output = await AiClassifierService.classifyText(sample.title, sample.description);
      const latency = Date.now() - sampleStart;
      totalLatency += latency;

      // 1. Check Schema Validity
      const schemaCheck = AiClassificationOutputSchema.safeParse(output);
      if (schemaCheck.success) {
        schemaValidCount++;
      }

      // 2. Check Request Type Classification
      const isTypeCorrect = output.requestType === sample.expectedType;
      if (isTypeCorrect) {
        correctClassifications++;
        classStats[sample.expectedType].tp++;
      } else {
        classStats[sample.expectedType].fn++;
        if (classStats[output.requestType]) {
          classStats[output.requestType].fp++;
        }
      }

      // 3. Check Missing Information Detection
      const missingInfoFound = output.missingInformation && output.missingInformation.length > 0;
      if (sample.hasMissingInformation && missingInfoFound) {
        missingInfoDetectedCount++;
      }

      // 4. Check Actionability
      if (output.isActionable === sample.expectedActionable) {
        actionabilityCorrectCount++;
      }

      sampleResults.push({
        id: sample.id,
        title: sample.title,
        expectedType: sample.expectedType,
        predictedType: output.requestType,
        passed: isTypeCorrect,
        latencyMs: latency,
        confidence: output.confidence,
        isActionable: output.isActionable,
        missingInfoFound: Boolean(missingInfoFound),
      });
    } catch (err) {
      failuresCount++;
      classStats[sample.expectedType].fn++;
      const latency = Date.now() - sampleStart;
      totalLatency += latency;

      sampleResults.push({
        id: sample.id,
        title: sample.title,
        expectedType: sample.expectedType,
        predictedType: 'ERROR',
        passed: false,
        latencyMs: latency,
        confidence: 0,
        isActionable: false,
        missingInfoFound: false,
      });
    }
  }

  // Calculate Per-Class Precision, Recall, F1
  let sumF1 = 0;
  const perClassMetrics: ClassMetrics[] = distinctClasses.map((className) => {
    const stats = classStats[className];
    const precision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : (stats.support === 0 ? 1 : 0);
    const recall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    sumF1 += f1Score;

    return {
      className,
      truePositives: stats.tp,
      falsePositives: stats.fp,
      falseNegatives: stats.fn,
      precision: Number((precision * 100).toFixed(1)),
      recall: Number((recall * 100).toFixed(1)),
      f1Score: Number((f1Score * 100).toFixed(1)),
      support: stats.support,
    };
  });

  const totalSamples = samples.length;
  const accuracyPercent = Number(((correctClassifications / totalSamples) * 100).toFixed(1));
  const schemaValidityRatePercent = Number(((schemaValidCount / totalSamples) * 100).toFixed(1));
  const missingInfoDetectionRatePercent =
    missingInfoTargetCount > 0
      ? Number(((missingInfoDetectedCount / missingInfoTargetCount) * 100).toFixed(1))
      : 100;
  const actionabilityDetectionRatePercent = Number(
    ((actionabilityCorrectCount / actionabilityTargetCount) * 100).toFixed(1)
  );
  const failureRatePercent = Number(((failuresCount / totalSamples) * 100).toFixed(1));
  const averageLatencyMs = Math.round(totalLatency / totalSamples);
  const macroF1Score = Number(((sumF1 / distinctClasses.length) * 100).toFixed(1));

  // Cost calculation estimate:
  // Avg input: 260 tokens, avg output: 140 tokens = 400 total tokens
  // Rates (Gemini Flash / mini models): $0.15 / 1M input, $0.60 / 1M output
  // Cost per sample = (260 * 0.15 / 1e6) + (140 * 0.60 / 1e6) = $0.000123
  const estimatedCostPerRequestUsd = 0.000123;
  const estimatedTotalCostUsd = Number((totalSamples * estimatedCostPerRequestUsd).toFixed(5));

  return {
    timestamp: new Date().toISOString(),
    totalSamples,
    correctClassifications,
    accuracyPercent,
    schemaValidityRatePercent,
    missingInfoDetectionRatePercent,
    actionabilityDetectionRatePercent,
    failureRatePercent,
    averageLatencyMs,
    totalLatencyMs: totalLatency,
    estimatedCostPerRequestUsd,
    estimatedTotalCostUsd,
    perClassMetrics,
    macroF1Score,
    sampleResults,
  };
}

// Standalone execution runner
async function main() {
  console.log('\n==================================================================');
  console.log('   MILESTONE 10: AI CLASSIFIER BENCHMARK & EVALUATION SUITE       ');
  console.log('==================================================================\n');
  console.log(`Evaluating ${AI_BENCHMARK_DATASET.length} representative operational samples across 8 domains...\n`);

  const report = await runAiEvaluation();

  console.log('------------------------------------------------------------------');
  console.log('                     EVALUATION REPORT SUMMARY                    ');
  console.log('------------------------------------------------------------------');
  console.log(`  Total Dataset Samples:          ${report.totalSamples}`);
  console.log(`  Correct Classifications:        ${report.correctClassifications}/${report.totalSamples}`);
  console.log(`  Classification Accuracy:        ${report.accuracyPercent}%`);
  console.log(`  Macro F1-Score:                 ${report.macroF1Score}%`);
  console.log(`  Schema Validity Rate:           ${report.schemaValidityRatePercent}% (Zod compliant)`);
  console.log(`  Missing Information Detection:  ${report.missingInfoDetectionRatePercent}%`);
  console.log(`  Actionability Detection:        ${report.actionabilityDetectionRatePercent}%`);
  console.log(`  Failure Rate:                   ${report.failureRatePercent}%`);
  console.log(`  Average Latency:                ${report.averageLatencyMs} ms`);
  console.log(`  Estimated Cost / Request:       $${report.estimatedCostPerRequestUsd.toFixed(6)}`);
  console.log(`  Estimated Total Dataset Cost:   $${report.estimatedTotalCostUsd.toFixed(5)}`);
  console.log('------------------------------------------------------------------\n');

  console.log('------------------------------------------------------------------');
  console.log('                   PER-CLASS PRECISION & RECALL                   ');
  console.log('------------------------------------------------------------------');
  console.log('Class                     | Precision | Recall | F1-Score | Support');
  console.log('--------------------------+-----------+--------+----------+--------');
  for (const c of report.perClassMetrics) {
    const name = c.className.padEnd(25, ' ');
    const prec = `${c.precision}%`.padStart(9, ' ');
    const rec = `${c.recall}%`.padStart(6, ' ');
    const f1 = `${c.f1Score}%`.padStart(8, ' ');
    const supp = `${c.support}`.padStart(7, ' ');
    console.log(`${name} | ${prec} | ${rec} | ${f1} | ${supp}`);
  }
  const misclassified = report.sampleResults.filter((s) => !s.passed);
  if (misclassified.length > 0) {
    console.log('------------------------------------------------------------------');
    console.log('                  MISCLASSIFIED SAMPLES ANALYSIS                  ');
    console.log('------------------------------------------------------------------');
    for (const m of misclassified) {
      console.log(`  Sample #${m.id}: "${m.title}"`);
      console.log(`    Expected:  ${m.expectedType}`);
      console.log(`    Predicted: ${m.predictedType}`);
    }
    console.log('------------------------------------------------------------------\n');
  }

  if (report.accuracyPercent < 80) {
    console.error(`❌ Benchmark failure: Accuracy ${report.accuracyPercent}% below target 80% threshold.`);
    process.exit(1);
  } else {
    console.log(`🎉 AI Classifier benchmark PASSED with ${report.accuracyPercent}% accuracy and ${report.schemaValidityRatePercent}% schema validity!\n`);
  }
}

if (process.argv[1]?.endsWith('evaluate-ai-classifier.ts')) {
  main().catch((e) => {
    console.error('Fatal evaluation error:', e);
    process.exit(1);
  });
}
