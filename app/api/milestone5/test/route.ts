import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { AiClassifierService } from '@/lib/services/ai-classifier-service';
import { AiClassificationOutputSchema } from '@/lib/validation/schemas';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  try {
    // 1. Schema Validation Checks
    const sampleOutput = {
      requestType: 'vendor_onboarding',
      priority: 'HIGH',
      summary: 'Onboard Acme Ltd as supplier',
      entities: { companyName: 'Acme Ltd' },
      documentsMentioned: ['CAC certificate', 'tax documents'],
      missingInformation: [],
      suggestedDepartment: 'procurement',
      confidence: 0.95,
      isActionable: true,
    };

    const parsed = AiClassificationOutputSchema.safeParse(sampleOutput);
    record('Zod Schema', 'Validates structured output against schema', parsed.success);
    record('Zod Schema', 'Normalizes requestType to domain enum (VENDOR_ONBOARDING)', parsed.success && parsed.data.requestType === 'VENDOR_ONBOARDING');
    record('Zod Schema', 'Rejects output missing required summary', !AiClassificationOutputSchema.safeParse({ ...sampleOutput, summary: '' }).success);

    // 2. Difficult Inputs Matrix (Section 6)
    // Case 1: Clean
    const case1 = await AiClassifierService.classifyText(
      'Need to onboard new supplier',
      'We need to onboard Acme Ltd as a supplier. They sent their CAC certificate and tax documents. Please get procurement to verify everything.',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 1 (Clean): Classified as VENDOR_ONBOARDING', case1.requestType === 'VENDOR_ONBOARDING');
    record('Difficult Inputs', 'Case 1 (Clean): Extracted companyName "Acme Ltd"', case1.entities.companyName === 'Acme Ltd');
    record('Difficult Inputs', 'Case 1 (Clean): Extracted CAC and tax documents', case1.documentsMentioned.length >= 2);
    record('Difficult Inputs', 'Case 1 (Clean): Suggested department is procurement', case1.suggestedDepartment === 'procurement');

    // Case 2: Ambiguous
    const case2 = await AiClassifierService.classifyText(
      'Supplier inquiry',
      'Need something done for the new supplier.',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 2 (Ambiguous): Flags missing specific action', case2.missingInformation.length > 0);
    record('Difficult Inputs', 'Case 2 (Ambiguous): Confidence reflects uncertainty (< 0.8)', case2.confidence < 0.8);

    // Case 3: Messy
    const case3 = await AiClassifierService.classifyText(
      'urgent vendor',
      'hey pls help onboard this vendor asap docs attached',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 3 (Messy): Detects urgency from "asap" as URGENT', case3.priority === 'URGENT');
    record('Difficult Inputs', 'Case 3 (Messy): Flags missing vendor name', case3.missingInformation.length > 0);

    // Case 4: Multiple Requests
    const case4 = await AiClassifierService.classifyText(
      'Vendor and laptops',
      'Please onboard Acme and also purchase 20 laptops.',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 4 (Multi-Request): Flags multi-intent requiring separate purchase order', case4.missingInformation.some((m) => m.toLowerCase().includes('purchase order') || m.toLowerCase().includes('multi-request')));
    record('Difficult Inputs', 'Case 4 (Multi-Request): Extracted 20 laptops entity', case4.entities.quantity === 20 && case4.entities.item === 'laptops');

    // Case 5: Missing Information
    const case5 = await AiClassifierService.classifyText(
      'Account setup',
      'I need a new employee account created.',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 5 (Missing Info): Classified as IT_ACCESS for IT department', case5.requestType === 'IT_ACCESS' && case5.suggestedDepartment === 'it');
    record('Difficult Inputs', 'Case 5 (Missing Info): Flags missing employee name & access level', case5.missingInformation.length >= 2);

    // Case 6: Completely Unrelated
    const case6 = await AiClassifierService.classifyText(
      'Office question',
      'What time does the office close?',
      { forceDeterministic: true }
    );
    record('Difficult Inputs', 'Case 6 (Unrelated): Marked as isActionable: false', case6.isActionable === false);

    // 3. Persistence in request_ai_analysis & Audit Trail
    const requester = await prisma.user.upsert({
      where: { email: 'requester.m5test@example.com' },
      update: {},
      create: {
        name: 'Alice Requester',
        email: 'requester.m5test@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const req = await RequestService.createRequest({
      title: 'Onboard Acme Ltd as Supplier',
      description: 'We need to onboard Acme Ltd as a supplier. They sent their CAC certificate and tax documents.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'M5_VERIFICATION_SUITE',
    });

    const analyses = await prisma.requestAiAnalysis.findMany({
      where: { request_id: req.id },
    });
    record('Database Persistence', 'Structured AI output stored in request_ai_analysis table', analyses.length >= 1);

    const events = await prisma.activityEvent.findMany({
      where: { request_id: req.id, event_type: 'AI_CLASSIFICATION_COMPLETED' },
    });
    record('Audit Trail', 'Atomic AI_CLASSIFICATION_COMPLETED audit event logged', events.length >= 1);

    // 4. Invariant: AI Does NOT directly mutate request status
    const freshReq = await prisma.request.findUnique({ where: { id: req.id } });
    record('Deterministic Guard', 'Request status remains deterministic NEW (no direct LLM state mutations)', freshReq?.status === RequestStatus.NEW);

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return NextResponse.json({
      success: true,
      total: results.length,
      passedCount,
      failedCount,
      allPassed: failedCount === 0,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, results }, { status: 500 });
  }
}
