import { prisma } from '../lib/prisma.ts';
import { UserRole, RequestStatus } from '@prisma/client';
import { RequestService } from '../lib/services/request-service.ts';
import { AiClassifierService } from '../lib/services/ai-classifier-service.ts';
import {
  AiClassificationOutputSchema,
  ClassifyRequestInputSchema,
} from '../lib/validation/schemas.ts';

async function runMilestoneFiveTests() {
  await prisma.$connect();
  console.log('\n=============================================================');
  console.log('  MILESTONE 5: AI CLASSIFICATION & STRUCTURED EXTRACTION     ');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // 1. ZOD SCHEMA VALIDATION RULES & INVARIANTS
  // -------------------------------------------------------------
  console.log('--- 1. Testing Zod Output Schema Validation & Invariants ---');

  const validAiPayload = {
    requestType: 'vendor_onboarding',
    priority: 'HIGH',
    summary: 'Onboard Acme Ltd as a new supplier',
    entities: { companyName: 'Acme Ltd' },
    documentsMentioned: ['CAC certificate', 'tax documents'],
    missingInformation: [],
    suggestedDepartment: 'procurement',
    confidence: 0.95,
    isActionable: true,
  };

  const parsedValid = AiClassificationOutputSchema.safeParse(validAiPayload);
  assert(parsedValid.success, 'Valid AI output conforms to schema');
  if (parsedValid.success) {
    assert(
      parsedValid.data.requestType === 'VENDOR_ONBOARDING',
      'Normalizes requestType to domain enum VENDOR_ONBOARDING'
    );
    assert(
      parsedValid.data.suggestedDepartment === 'procurement',
      'Normalizes suggestedDepartment to lowercase procurement'
    );
  }

  // Test rejection when summary is missing
  const missingSummary = { ...validAiPayload, summary: '' };
  const parsedMissingSummary = AiClassificationOutputSchema.safeParse(missingSummary);
  assert(!parsedMissingSummary.success, 'Rejects output missing summary or summary < 3 chars');

  // Test rejection when documentsMentioned is not an array
  const invalidDocs = { ...validAiPayload, documentsMentioned: 'cac.pdf' };
  const parsedInvalidDocs = AiClassificationOutputSchema.safeParse(invalidDocs);
  assert(!parsedInvalidDocs.success, 'Rejects output when documentsMentioned is not an array');

  // Test rejection on out-of-range confidence (> 1)
  const invalidConfidence = { ...validAiPayload, confidence: 1.5 };
  const parsedInvalidConfidence = AiClassificationOutputSchema.safeParse(invalidConfidence);
  assert(!parsedInvalidConfidence.success, 'Rejects output with out-of-bounds confidence');

  // -------------------------------------------------------------
  // 2. DIFFICULT INPUT TESTING (THE 6 MANDATORY TEST CASES)
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Difficult Inputs Matrix (Section 6) ---');

  // CASE 1: Clean Example
  console.log('\n  [Case 1: Clean Example]');
  const cleanTitle = 'Need to onboard new supplier';
  const cleanDesc =
    'We need to onboard Acme Ltd as a supplier. They sent their CAC certificate and tax documents. Please get procurement to verify everything.';
  const case1 = await AiClassifierService.classifyText(cleanTitle, cleanDesc, {
    forceDeterministic: true,
  });

  assert(case1.requestType === 'VENDOR_ONBOARDING', 'Case 1: Classified as VENDOR_ONBOARDING');
  assert(case1.priority === 'HIGH', 'Case 1: Priority correctly classified as HIGH');
  assert(case1.entities.companyName === 'Acme Ltd', 'Case 1: Extracted companyName "Acme Ltd"');
  assert(
    case1.documentsMentioned.includes('CAC certificate') &&
      case1.documentsMentioned.includes('tax documents'),
    'Case 1: Extracted CAC and tax documents'
  );
  assert(case1.suggestedDepartment === 'procurement', 'Case 1: Suggested department is procurement');
  assert(case1.isActionable === true, 'Case 1: Identified as actionable request');
  assert(case1.confidence >= 0.9, 'Case 1: High confidence score (>= 0.9)');

  // CASE 2: Ambiguous
  console.log('\n  [Case 2: Ambiguous Input]');
  const ambTitle = 'Supplier question';
  const ambDesc = 'Need something done for the new supplier.';
  const case2 = await AiClassifierService.classifyText(ambTitle, ambDesc, {
    forceDeterministic: true,
  });

  assert(case2.confidence < 0.8, 'Case 2: Confidence lowered due to ambiguity (< 0.8)');
  assert(
    case2.missingInformation.length > 0,
    'Case 2: Flags missing information (specific action required)'
  );
  assert(case2.suggestedDepartment === 'procurement', 'Case 2: Maps to procurement domain');

  // CASE 3: Messy
  console.log('\n  [Case 3: Messy Input]');
  const messyTitle = 'urgent vendor';
  const messyDesc = 'hey pls help onboard this vendor asap docs attached';
  const case3 = await AiClassifierService.classifyText(messyTitle, messyDesc, {
    forceDeterministic: true,
  });

  assert(case3.requestType === 'VENDOR_ONBOARDING', 'Case 3: Correctly identifies onboarding intent');
  assert(case3.priority === 'URGENT', 'Case 3: Detects urgency from "asap" indicator');
  assert(
    case3.documentsMentioned.includes('attached documents'),
    'Case 3: Captures "docs attached"'
  );
  assert(
    case3.missingInformation.some((m) => m.toLowerCase().includes('name')),
    'Case 3: Identifies missing vendor name'
  );

  // CASE 4: Multiple Requests (Multi-Intent)
  console.log('\n  [Case 4: Multiple Requests]');
  const multiTitle = 'Vendor and laptops';
  const multiDesc = 'Please onboard Acme and also purchase 20 laptops.';
  const case4 = await AiClassifierService.classifyText(multiTitle, multiDesc, {
    forceDeterministic: true,
  });

  assert(case4.entities.companyName === 'Acme Ltd', 'Case 4: Extracted Acme company entity');
  assert(case4.entities.quantity === 20, 'Case 4: Extracted item quantity 20');
  assert(case4.entities.item === 'laptops', 'Case 4: Extracted item "laptops"');
  assert(
    case4.missingInformation.some((m) => m.toLowerCase().includes('multi-request') || m.toLowerCase().includes('purchase order')),
    'Case 4: Flagged that separate purchase order is required for laptops'
  );

  // CASE 5: Missing Information
  console.log('\n  [Case 5: Missing Information]');
  const missingTitle = 'Account creation';
  const missingDesc = 'I need a new employee account created.';
  const case5 = await AiClassifierService.classifyText(missingTitle, missingDesc, {
    forceDeterministic: true,
  });

  assert(case5.requestType === 'IT_ACCESS', 'Case 5: Classified as IT_ACCESS');
  assert(case5.suggestedDepartment === 'it', 'Case 5: Suggested department is IT');
  assert(
    case5.missingInformation.length >= 2,
    'Case 5: Explicitly flags missing employee name, department, or role'
  );

  // CASE 6: Completely Unrelated
  console.log('\n  [Case 6: Completely Unrelated]');
  const unrelatedTitle = 'General question';
  const unrelatedDesc = 'What time does the office close?';
  const case6 = await AiClassifierService.classifyText(unrelatedTitle, unrelatedDesc, {
    forceDeterministic: true,
  });

  assert(case6.isActionable === false, 'Case 6: Marked as NOT actionable (conversational)');
  assert(case6.priority === 'LOW', 'Case 6: Assigned LOW priority');
  assert(
    case6.missingInformation.some((m) => m.toLowerCase().includes('not an actionable') || m.toLowerCase().includes('conversational')),
    'Case 6: Categorized as non-operational inquiry'
  );

  // -------------------------------------------------------------
  // 3. PERSISTENCE & EVALUATION DATA (request_ai_analysis)
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Database Persistence & Evaluation Record ---');

  const requester = await prisma.user.upsert({
    where: { email: 'requester.m5@example.com' },
    update: {},
    create: {
      name: 'Alice Requester',
      email: 'requester.m5@example.com',
      role: UserRole.REQUESTER,
      department: 'Operations',
    },
  });

  // Create Request with auto-classification
  const req = await RequestService.createRequest({
    title: 'Onboard Acme Ltd as Supplier',
    description: 'We need to onboard Acme Ltd as a supplier. They sent their CAC certificate and tax documents. Please get procurement to verify everything.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'M5_AI_SUITE',
  });

  assert(req.id !== undefined, 'Request created in PostgreSQL');

  // Verify stored AI analysis in request_ai_analysis table
  const analyses = await prisma.requestAiAnalysis.findMany({
    where: { request_id: req.id },
  });

  assert(analyses.length >= 1, 'AI analysis stored in request_ai_analysis table');
  const storedAnalysis = analyses[0];
  assert(storedAnalysis.request_type === 'VENDOR_ONBOARDING', 'Stored request_type matches classification');
  assert(storedAnalysis.suggested_department === 'procurement', 'Stored suggested_department is procurement');
  assert(storedAnalysis.confidence >= 0.9, 'Stored confidence score preserved');
  assert(storedAnalysis.is_actionable === true, 'Stored is_actionable flag is true');

  // Verify atomic AI_CLASSIFICATION_COMPLETED event in activity_events
  const aiEvents = await prisma.activityEvent.findMany({
    where: { request_id: req.id, event_type: 'AI_CLASSIFICATION_COMPLETED' },
  });

  assert(aiEvents.length >= 1, 'Atomic AI_CLASSIFICATION_COMPLETED audit event logged');
  assert(
    (aiEvents[0].metadata as any)?.suggested_department === 'procurement',
    'Audit event metadata includes AI classification details'
  );

  // -------------------------------------------------------------
  // 4. DETERMINISTIC BOUNDARY ENFORCEMENT
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Invariant: AI Does Not Control Workflow Directly ---');

  // AI classified, but request status MUST remain in NEW (no direct LLM state mutations)
  const freshReq = await prisma.request.findUnique({ where: { id: req.id } });
  assert(freshReq?.status === RequestStatus.NEW, 'Request status remains deterministic NEW (AI cannot bypass state machine)');

  console.log('\n=============================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failed === 0) {
    console.log('🎉 MILESTONE 5: AI CLASSIFICATION & STRUCTURED EXTRACTION FULLY VERIFIED!\n');
  } else {
    process.exit(1);
  }
}

runMilestoneFiveTests()
  .catch((e) => {
    console.error('Test suite error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
