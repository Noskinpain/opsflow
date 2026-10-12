import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {
    // 1. Ensure a requester and manager exist
    const requester = await prisma.user.findFirst({ where: { role: 'REQUESTER' } }) || await prisma.user.findFirst();
    const manager = await prisma.user.findFirst({ where: { role: 'MANAGER' } }) || await prisma.user.findFirst();

    if (!requester || !manager) {
      return NextResponse.json({ error: 'Team members required' }, { status: 400 });
    }

    // 2. Create or find Request for Execution #1042 (Invoice Processing)
    let invoiceReq = await prisma.request.findFirst({
      where: { title: { contains: 'Invoice INV-1042' } },
    });

    if (!invoiceReq) {
      invoiceReq = await prisma.request.create({
        data: {
          title: 'Invoice Processing: Acme Ltd INV-1042 (₦450,000)',
          description: 'Invoice #INV-1042 submitted for Cloud and Software Services. Amount: ₦450,000 NGN. Due: Oct 20, 2026.',
          request_type: 'PURCHASE_ORDER',
          priority: 'HIGH',
          status: 'AWAITING_APPROVAL',
          requester_id: requester.id,
          source: 'DOCUMENT_UPLOAD',
          due_at: new Date(Date.now() + 14 * 86400000),
        },
      });
    }

    // Create execution for Invoice #1042
    await prisma.workflowExecution.deleteMany({
      where: { request_id: invoiceReq.id },
    });

    const now = Date.now();
    await prisma.workflowExecution.create({
      data: {
        request_id: invoiceReq.id,
        workflow_type: 'invoice_processing_v1',
        status: 'RUNNING',
        attempt: 1,
        max_attempts: 3,
        started_at: new Date(now - 180000),
        context: {
          executionCode: '#1042',
          invoiceNumber: 'INV-1042',
          supplier: 'Acme Ltd',
          amount: '₦450,000',
          currency: 'NGN',
          steps: [
            {
              stepId: 'step_receive',
              name: '1. Ingest & Store Document',
              type: 'INGEST',
              status: 'SUCCESS',
              startedAt: new Date(now - 180000).toISOString(),
              completedAt: new Date(now - 179920).toISOString(),
              durationMs: 80,
              input: {
                fileName: 'invoice_acme_inv1042.pdf',
                fileSize: '148 KB',
                mimeType: 'application/pdf',
                sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              },
              output: {
                storageBucket: 'secure-vault-prod',
                storedPath: '/documents/invoices/2026/INV-1042.pdf',
                status: 'VERIFIED_CLEAN',
              },
            },
            {
              stepId: 'step_extract',
              name: '2. AI Document Field Extraction',
              type: 'AI_EXTRACTION',
              status: 'SUCCESS',
              startedAt: new Date(now - 179900).toISOString(),
              completedAt: new Date(now - 178550).toISOString(),
              durationMs: 1350,
              aiMetadata: {
                modelName: 'gemini-3.5-flash-lite',
                promptSnippet: 'Extract structured invoice fields: supplier, number, amount, date, due_date, line_items',
                schemaValid: true,
                confidence: 0.98,
                tokensEstimated: 412,
                costUsdEstimated: 0.00018,
                latencyMs: 1350,
              },
              input: {
                ocrEngine: 'Tesseract/Vision-OCR-v4',
                rawTextLength: 1240,
              },
              output: {
                fieldsExtracted: 6,
                extracted: {
                  supplier: 'Acme Ltd',
                  invoiceNumber: 'INV-1042',
                  amount: 450000,
                  currency: 'NGN',
                  invoiceDate: '2026-10-05',
                  dueDate: '2026-10-20',
                  taxId: 'RC-994821',
                },
              },
            },
            {
              stepId: 'step_validate',
              name: '3. Schema & Required Field Validation',
              type: 'BUSINESS_RULES',
              status: 'SUCCESS',
              startedAt: new Date(now - 178500).toISOString(),
              completedAt: new Date(now - 178460).toISOString(),
              durationMs: 40,
              input: {
                mandatoryFields: ['supplier', 'invoiceNumber', 'amount', 'dueDate'],
              },
              output: {
                allMandatoryPresent: true,
                validationErrorsCount: 0,
                formatCheck: 'PASSED',
              },
            },
            {
              stepId: 'step_duplicate_check',
              name: '4. Deterministic Duplicate Invoice Guard',
              type: 'BUSINESS_RULES',
              status: 'SUCCESS',
              startedAt: new Date(now - 178450).toISOString(),
              completedAt: new Date(now - 178410).toISOString(),
              durationMs: 40,
              input: {
                invoiceNumber: 'INV-1042',
                supplierName: 'Acme Ltd',
              },
              output: {
                duplicateDetected: false,
                previousSubmissionsCount: 0,
                fingerprintUnique: true,
              },
            },
            {
              stepId: 'step_evaluate_rules',
              name: '5. Approval Policy & Threshold Rules',
              type: 'BUSINESS_RULES',
              status: 'SUCCESS',
              startedAt: new Date(now - 178400).toISOString(),
              completedAt: new Date(now - 178350).toISOString(),
              durationMs: 50,
              input: {
                invoiceAmount: 450000,
                standardThreshold: 500000,
                currency: 'NGN',
              },
              output: {
                approvalRequired: true,
                policyPath: 'STANDARD_FINANCE_APPROVAL',
                reason: 'Amount (₦450,000) is within standard manager authority (≤ ₦500,000 threshold). Routed to Procurement Manager.',
              },
            },
            {
              stepId: 'step_approval_gate',
              name: '6. Human-in-the-Loop Manager Signoff',
              type: 'HUMAN_APPROVAL',
              status: 'WAITING',
              startedAt: new Date(now - 178300).toISOString(),
              input: {
                assignedManager: `${manager.name} (${manager.department})`,
                approverRole: 'MANAGER',
                separationOfDuties: true,
              },
              output: {
                gateStatus: 'WAITING_FOR_DECISION',
                note: `Paused waiting for digital approval from ${manager.name}.`,
              },
            },
          ],
        },
      },
    });

    // 3. Create Execution #1038 (Failed & Retryable integration example)
    let erpReq = await prisma.request.findFirst({
      where: { title: { contains: 'ERP Vendor Sync' } },
    });

    if (!erpReq) {
      erpReq = await prisma.request.create({
        data: {
          title: 'ERP Vendor Sync: Global Tech Logistics (#1038)',
          description: 'Outbound sync of approved supplier profile to SAP S/4HANA ERP accounting module.',
          request_type: 'VENDOR_ONBOARDING',
          priority: 'MEDIUM',
          status: 'PROCESSING',
          requester_id: requester.id,
          source: 'SYSTEM_SYNC',
        },
      });
    }

    await prisma.workflowExecution.deleteMany({
      where: { request_id: erpReq.id },
    });

    await prisma.workflowExecution.create({
      data: {
        request_id: erpReq.id,
        workflow_type: 'erp_vendor_sync_v2',
        status: 'FAILED',
        attempt: 2,
        max_attempts: 3,
        error: 'EXTERNAL_GATEWAY_TIMEOUT: ERP endpoint https://erp-api.internal.corp/v1/vendors timed out after 5000ms',
        started_at: new Date(now - 360000),
        completed_at: new Date(now - 355000),
        context: {
          executionCode: '#1038',
          vendorId: 'VND-8831',
          steps: [
            {
              stepId: 'step_compile_profile',
              name: '1. Compile Supplier Payload',
              type: 'INGEST',
              status: 'SUCCESS',
              startedAt: new Date(now - 360000).toISOString(),
              completedAt: new Date(now - 359950).toISOString(),
              durationMs: 50,
              input: { vendorCode: 'VND-8831', country: 'NG' },
              output: { payloadCompiled: true, byteSize: 420 },
            },
            {
              stepId: 'step_erp_call',
              name: '2. Remote ERP API Gateway Dispatch',
              type: 'WEBHOOK_OUTBOUND',
              status: 'FAILED',
              startedAt: new Date(now - 359900).toISOString(),
              completedAt: new Date(now - 354900).toISOString(),
              durationMs: 5000,
              retryCount: 2,
              error: 'EXTERNAL_GATEWAY_TIMEOUT: Socket hang up on internal gateway (504 Gateway Timeout). Scheduled for exponential backoff.',
              input: {
                endpoint: 'https://erp-api.internal.corp/v1/vendors',
                method: 'POST',
                timeoutMs: 5000,
              },
              output: {
                httpStatus: 504,
                retryScheduled: true,
                nextAttemptInSeconds: 30,
              },
            },
          ],
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Workflow executions seeded successfully.',
      invoiceExecutionRequestId: invoiceReq.id,
      erpExecutionRequestId: erpReq.id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to seed executions' },
      { status: 500 }
    );
  }
}
