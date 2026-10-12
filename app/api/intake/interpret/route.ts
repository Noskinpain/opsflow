import { NextRequest, NextResponse } from 'next/server';
import { generateGeminiJson, isGeminiConfigured, getGeminiModel } from '@/lib/ai/gemini-client';

export interface InterpretRequestInput {
  rawPrompt: string;
}

export const PERMITTED_ACTIONS = [
  'INSPECT_DOCUMENTS',
  'CONFIRM_TAX_CERTIFICATE',
  'REQUEST_MISSING_DOCUMENT',
  'ASSIGN_DEPARTMENT_REVIEW',
  'REQUEST_MANAGER_APPROVAL',
  'DISPATCH_ERP_RECORD',
  'COMPLETE_ONBOARDING',
  'ESCALATE_EXCEPTION',
] as const;

export type PermittedAction = (typeof PERMITTED_ACTIONS)[number];

interface InterpretedPlanOutput {
  requestAnalysis: {
    type: string;
    supplier: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    deadline: string;
    requiredDepartment: string;
    determinationReason: string;
  };
  requirementsAnalysis: Array<{
    item: string;
    status: string;
    detail: string;
  }>;
  proposedWorkflow: Array<{
    stepNumber: number;
    actionKey: PermittedAction;
    title: string;
    targetRole: string;
    department: string;
    description: string;
    conditional?: string;
  }>;
}

export async function POST(req: NextRequest) {
  try {
    const { rawPrompt }: InterpretRequestInput = await req.json();

    if (!rawPrompt || rawPrompt.trim().length < 10) {
      return NextResponse.json(
        { error: 'Prompt must be at least 10 characters long to analyze requirements.' },
        { status: 400 }
      );
    }

    let plan: InterpretedPlanOutput | null = null;
    let aiEngine: { source: string; model: string; latencyMs: number; tokens?: number; costUsd?: number } | null = null;

    // 1. Attempt LLM Interpretation via Gemini if configured
    if (isGeminiConfigured()) {
      try {
        const prompt = `You are an enterprise operations orchestrator. Analyze this unstructured stakeholder request and synthesize a structured execution plan.

PERMITTED_ACTIONS whitelist (every actionKey in proposedWorkflow MUST be one of these exact values):
${PERMITTED_ACTIONS.map((a) => ` - "${a}"`).join('\n')}

ALLOWED request types: VENDOR_ONBOARDING, PURCHASE_ORDER, EQUIPMENT_REQUEST, COMPLIANCE_AUDIT, CONTRACT_REVIEW, FACILITIES_REQUEST, IT_ACCESS, GENERAL_OPS.
ALLOWED priorities: LOW, MEDIUM, HIGH, URGENT.
ALLOWED targetRoles: OPERATOR, MANAGER, SYSTEM_OPERATOR.

Output valid JSON matching this exact schema:
{
  "requestAnalysis": {
    "type": string,
    "supplier": string (name of company, entity, or service mentioned),
    "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "deadline": string,
    "requiredDepartment": string,
    "determinationReason": string
  },
  "requirementsAnalysis": [
    {
      "item": string,
      "status": "PRESENT_PENDING_VERIFICATION" | "PRESENCE_UNCONFIRMED" | "REQUIRED" | "MANDATORY" | "OPTIONAL" | "NOT_MENTIONED",
      "detail": string
    }
  ],
  "proposedWorkflow": [
    {
      "stepNumber": number (1-based sequence),
      "actionKey": string (MUST be one of PERMITTED_ACTIONS),
      "title": string,
      "targetRole": "OPERATOR" | "MANAGER" | "SYSTEM_OPERATOR",
      "department": string,
      "description": string,
      "conditional": string (optional)
    }
  ]
}

STAKEHOLDER REQUEST TO ANALYZE:
"${rawPrompt.trim()}"

Return ONLY valid JSON.`;

        const { data, meta } = await generateGeminiJson<InterpretedPlanOutput>(prompt, { timeoutMs: 15000 });

        // Governance verification: confirm every actionKey is strictly inside PERMITTED_ACTIONS
        const allPermitted = Array.isArray(data?.proposedWorkflow) &&
          data.proposedWorkflow.length > 0 &&
          data.proposedWorkflow.every((w) => PERMITTED_ACTIONS.includes(w.actionKey));

        if (data?.requestAnalysis?.type && allPermitted) {
          plan = data;
          aiEngine = {
            source: 'gemini',
            model: meta.model,
            latencyMs: meta.latencyMs,
            tokens: meta.inputTokens + meta.outputTokens,
            costUsd: meta.costUsdEstimated,
          };
        } else {
          console.warn('[interpret] Gemini output failed action whitelist check, falling back to deterministic plan.');
        }
      } catch (err: any) {
        console.warn('[interpret] Gemini call failed, falling back to deterministic analyzer:', err?.message || err);
      }
    }

    // 2. Deterministic Fallback Analyzer
    if (!plan) {
      const started = Date.now();
      plan = runDeterministicInterpretation(rawPrompt);
      aiEngine = {
        source: 'deterministic',
        model: 'deterministic-rules-engine-v1',
        latencyMs: Date.now() - started,
      };
    }

    const allActionsPermitted = plan.proposedWorkflow.every((w) =>
      PERMITTED_ACTIONS.includes(w.actionKey)
    );

    return NextResponse.json({
      success: true,
      data: {
        rawPrompt,
        requestAnalysis: plan.requestAnalysis,
        requirementsAnalysis: plan.requirementsAnalysis,
        proposedWorkflow: plan.proposedWorkflow,
        governanceValidation: {
          schemaValid: allActionsPermitted,
          unauthorizedActionsDetected: !allActionsPermitted,
          operatorAuthorizationRequired: true,
          status: 'PENDING_OPERATOR_AUTHORIZATION',
        },
        engine: aiEngine,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to interpret unstructured request' },
      { status: 500 }
    );
  }
}

function runDeterministicInterpretation(rawPrompt: string): InterpretedPlanOutput {
  const lower = rawPrompt.toLowerCase();

  let type = 'VENDOR_ONBOARDING';
  if (lower.includes('invoice') || lower.includes('purchase order') || lower.includes('po ') || lower.includes('buy') || lower.includes('license')) {
    type = 'PURCHASE_ORDER';
  } else if (lower.includes('audit') || lower.includes('compliance') || lower.includes('soc2')) {
    type = 'COMPLIANCE_AUDIT';
  } else if (lower.includes('access') || lower.includes('vpn') || lower.includes('aws') || lower.includes('github')) {
    type = 'IT_ACCESS';
  }

  let supplier = 'Acme Ltd';
  const supplierMatch = rawPrompt.match(/(?:called|supplier|vendor|company|for)\s+([A-Z][A-Za-z0-9&.\s]{2,30}?)(?=[,.\n]|\s+with|\s+and|\s+before|\s+to)/i);
  if (supplierMatch) {
    supplier = supplierMatch[1].trim();
  } else if (lower.includes('cloudflare')) {
    supplier = 'CloudFlare Inc';
  } else if (lower.includes('oracle')) {
    supplier = 'Oracle Cloud Infrastructure';
  }

  let priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM';
  if (lower.includes('urgent') || lower.includes('asap') || lower.includes('immediately') || lower.includes('today')) {
    priority = 'URGENT';
  } else if (lower.includes('friday') || lower.includes('deadline') || lower.includes('high priority')) {
    priority = 'HIGH';
  }

  let deadlineDesc = 'Standard 72h SLA';
  if (lower.includes('friday')) {
    deadlineDesc = 'Friday 5:00 PM (subject to explicit date confirmation)';
  } else if (lower.includes('today') || lower.includes('asap')) {
    deadlineDesc = 'Today EOD (Urgent expedited SLA: 2h)';
  }

  let requiredDepartment = 'Procurement';
  if (type === 'COMPLIANCE_AUDIT') requiredDepartment = 'Compliance';
  else if (type === 'IT_ACCESS') requiredDepartment = 'IT Support';
  else if (lower.includes('legal') || lower.includes('contract')) requiredDepartment = 'Legal';

  const hasRegistrationDocs = lower.includes('registration') || lower.includes('cac') || lower.includes('certificate of incorporation');
  const hasTaxDoubt = lower.includes('tax') || lower.includes('not sure whether the tax') || lower.includes('tax certificate is included');
  const requiresProcurementReview = lower.includes('procurement') || lower.includes('review everything') || type === 'VENDOR_ONBOARDING';
  const requiresManagerApproval = lower.includes('manager') || lower.includes('approv') || priority === 'HIGH';

  const requirementsAnalysis = [
    {
      item: 'Company registration documents',
      status: hasRegistrationDocs ? 'PRESENT_PENDING_VERIFICATION' : 'NOT_MENTIONED',
      detail: hasRegistrationDocs ? 'Attached in request submission, pending validity check.' : 'No incorporation files detected.',
    },
    {
      item: 'Tax Clearance Certificate (TCC)',
      status: hasTaxDoubt ? 'PRESENCE_UNCONFIRMED' : 'REQUIRED',
      detail: hasTaxDoubt ? 'Sender expressed uncertainty about inclusion. Verification required.' : 'Mandatory regulatory requirement for vendor onboarding.',
    },
    {
      item: 'Procurement department technical review',
      status: requiresProcurementReview ? 'MANDATORY' : 'OPTIONAL',
      detail: 'Commercial terms and SLA evaluation required before managerial signoff.',
    },
    {
      item: 'Managerial signoff and authorization',
      status: requiresManagerApproval ? 'MANDATORY' : 'OPTIONAL',
      detail: 'Formal governance gate required before ERP vendor account provisioning.',
    },
  ];

  const proposedWorkflow = [
    {
      stepNumber: 1,
      actionKey: 'INSPECT_DOCUMENTS' as const,
      title: 'Inspect submitted company registration documents',
      targetRole: 'OPERATOR',
      department: requiredDepartment,
      description: 'Verify CAC certificate and proof of legal incorporation.',
    },
    {
      stepNumber: 2,
      actionKey: 'CONFIRM_TAX_CERTIFICATE' as const,
      title: 'Confirm presence and validity of Tax Clearance Certificate',
      targetRole: 'OPERATOR',
      department: requiredDepartment,
      description: 'Resolve sender uncertainty regarding tax compliance documents.',
    },
    {
      stepNumber: 3,
      actionKey: 'REQUEST_MISSING_DOCUMENT' as const,
      title: 'Request missing compliance documentation if unverified',
      targetRole: 'OPERATOR',
      department: requiredDepartment,
      conditional: 'Executes only if step 2 identifies missing or expired tax documents.',
      description: 'Request missing compliance documentation from vendor.',
    },
    {
      stepNumber: 4,
      actionKey: 'ASSIGN_DEPARTMENT_REVIEW' as const,
      title: `Assign formal ${requiredDepartment} review`,
      targetRole: 'OPERATOR',
      department: requiredDepartment,
      description: 'Review pricing structure, credit terms, and service agreements.',
    },
    {
      stepNumber: 5,
      actionKey: 'REQUEST_MANAGER_APPROVAL' as const,
      title: 'Request manager signoff and authorization',
      targetRole: 'MANAGER',
      department: requiredDepartment,
      description: 'Executive governance gateway before ERP vendor creation.',
    },
    {
      stepNumber: 6,
      actionKey: 'COMPLETE_ONBOARDING' as const,
      title: 'Complete supplier onboarding and provision ERP code',
      targetRole: 'SYSTEM_OPERATOR',
      department: requiredDepartment,
      description: 'Finalize onboarding once all prerequisite steps are marked satisfied.',
    },
  ];

  return {
    requestAnalysis: {
      type,
      supplier,
      priority,
      deadline: deadlineDesc,
      requiredDepartment,
      determinationReason: `Priority marked as ${priority} based on deadline cues and regulatory requirements.`,
    },
    requirementsAnalysis,
    proposedWorkflow,
  };
}
