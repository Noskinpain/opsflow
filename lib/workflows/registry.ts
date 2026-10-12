import { Priority, UserRole } from '@prisma/client';
import type { WorkflowDefinition } from './types.ts';

export const VendorOnboardingWorkflow: WorkflowDefinition = {
  id: 'vendor_onboarding',
  requestType: 'VENDOR_ONBOARDING',
  name: 'Vendor Onboarding Workflow',
  description: 'Validates company information, verifies compliance documents, conducts procurement review, obtains manager approval, and creates ERP vendor record.',
  targetDepartment: 'Procurement',
  initialTasks: [
    {
      id: 'verify_docs',
      title: 'Verify company documents',
      description: 'Check CAC certificate, tax clearance, and incorporation documents for compliance.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
    {
      id: 'procurement_review',
      title: 'Procurement review',
      description: 'Evaluate vendor pricing, commercial terms, delivery SLAs, and credit terms.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: true,
    approverRole: UserRole.MANAGER,
    department: 'Procurement',
    title: 'Manager Approval: Vendor Onboarding',
    description: 'Final manager signoff required to authorize new supplier registration.',
    minConfidence: 0.80,
    requiresSeparationOfDuties: true,
    verificationItems: [
      'CAC Certificate verified',
      'Tax Clearance Certificate verified',
      'Bank details confirmed',
      'Procurement commercial terms approved',
    ],
  },
  postApprovalTasks: [
    {
      id: 'create_vendor_record',
      title: 'Create vendor record',
      description: 'Register verified supplier profile in ERP, configure banking details, and issue vendor code.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

export const PurchaseRequestWorkflow: WorkflowDefinition = {
  id: 'purchase_request',
  requestType: 'PURCHASE_ORDER',
  name: 'Purchase Request Workflow',
  description: 'Validates purchase requisition, verifies budget availability, obtains management approval, and issues purchase order.',
  targetDepartment: 'Procurement',
  initialTasks: [
    {
      id: 'validate_requisition',
      title: 'Validate purchase request',
      description: 'Check item specifications, quantities, and competitive quotes.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
    {
      id: 'budget_check',
      title: 'Check budget allocation',
      description: 'Confirm departmental cost-center budget availability with finance.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: true,
    approverRole: UserRole.MANAGER,
    department: 'Finance',
    title: 'Manager Approval: Purchase Requisition',
    description: 'Financial approval required before committing funds.',
    minConfidence: 0.80,
    amountThreshold: 1000,
    requiresSeparationOfDuties: true,
    verificationItems: [
      'Item specifications verified',
      'Department budget availability verified',
      'Vendor quotation attached',
    ],
  },
  postApprovalTasks: [
    {
      id: 'issue_po',
      title: 'Issue purchase order',
      description: 'Transmit approved PO to supplier and log delivery milestones.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

export const ItAccessWorkflow: WorkflowDefinition = {
  id: 'it_access',
  requestType: 'IT_ACCESS',
  name: 'IT Access & Credential Workflow',
  description: 'Verifies user identity, obtains security clearance, and provisions system credentials.',
  targetDepartment: 'IT',
  initialTasks: [
    {
      id: 'verify_security_clearance',
      title: 'Verify security clearance',
      description: 'Verify employee role, manager signoff, and required privilege levels.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: true,
    approverRole: UserRole.MANAGER,
    department: 'IT',
    title: 'Manager Approval: System Access Grant',
    description: 'IT Security manager approval required to grant production access.',
  },
  postApprovalTasks: [
    {
      id: 'provision_credentials',
      title: 'Provision system credentials',
      description: 'Create user account, configure 2FA authentication, and assign security groups.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

export const ContractReviewWorkflow: WorkflowDefinition = {
  id: 'contract_review',
  requestType: 'CONTRACT_REVIEW',
  name: 'Legal Contract Review Workflow',
  description: 'Conducts legal liability review, obtains General Counsel approval, and coordinates contract execution.',
  targetDepartment: 'Legal',
  initialTasks: [
    {
      id: 'legal_clause_analysis',
      title: 'Analyze contract clauses',
      description: 'Review liability caps, indemnity, data privacy, and termination conditions.',
      priority: Priority.HIGH,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: true,
    approverRole: UserRole.MANAGER,
    department: 'Legal',
    title: 'General Counsel Approval',
    description: 'Executive legal approval required to sign commercial agreement.',
  },
  postApprovalTasks: [
    {
      id: 'execute_contract',
      title: 'Execute contract signatures',
      description: 'Coordinate digital signatures via DocuSign and archive executed copy.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

export const FacilitiesRequestWorkflow: WorkflowDefinition = {
  id: 'facilities_request',
  requestType: 'FACILITIES_REQUEST',
  name: 'Facilities Maintenance Workflow',
  description: 'Inspects facility issue, estimates repair costs, and coordinates maintenance execution.',
  targetDepartment: 'Facilities',
  initialTasks: [
    {
      id: 'inspect_facility',
      title: 'Inspect facility requirement',
      description: 'Conduct on-site physical inspection and estimate repair timeline.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: false,
    approverRole: UserRole.MANAGER,
    department: 'Facilities',
    title: 'Facilities Manager Signoff',
    description: 'Routine maintenance signoff.',
  },
  postApprovalTasks: [
    {
      id: 'complete_repairs',
      title: 'Execute facility repairs',
      description: 'Coordinate maintenance contractor and verify site restoration.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

export const GeneralOpsWorkflow: WorkflowDefinition = {
  id: 'general_ops',
  requestType: 'GENERAL_OPS',
  name: 'General Operations Workflow',
  description: 'Standard operations triage, operator assessment, and fulfillment.',
  targetDepartment: 'Operations',
  initialTasks: [
    {
      id: 'ops_triage',
      title: 'Operations triage and assessment',
      description: 'Review operational scope and establish fulfillment path.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'REVIEW',
    },
  ],
  approvalConfig: {
    required: false,
    approverRole: UserRole.MANAGER,
    department: 'Operations',
    title: 'Operations Approval',
    description: 'General operations signoff.',
  },
  postApprovalTasks: [
    {
      id: 'fulfill_request',
      title: 'Fulfill operational request',
      description: 'Complete requested operational actions and notify requester.',
      priority: Priority.MEDIUM,
      assigneeRole: UserRole.OPERATOR,
      stage: 'EXECUTION',
    },
  ],
};

const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  vendor_onboarding: VendorOnboardingWorkflow,
  vendoronboarding: VendorOnboardingWorkflow,
  purchase_request: PurchaseRequestWorkflow,
  purchase_order: PurchaseRequestWorkflow,
  purchaserequest: PurchaseRequestWorkflow,
  it_access: ItAccessWorkflow,
  itaccess: ItAccessWorkflow,
  contract_review: ContractReviewWorkflow,
  contractreview: ContractReviewWorkflow,
  facilities_request: FacilitiesRequestWorkflow,
  facilitiesrequest: FacilitiesRequestWorkflow,
  general_ops: GeneralOpsWorkflow,
  generalops: GeneralOpsWorkflow,
};

/**
 * Milestone 6: Workflow Resolver
 * Resolves requestType to its workflow definition.
 * Eliminates scattered if/else checks across the application.
 */
export function getWorkflow(requestType: string): WorkflowDefinition {
  if (!requestType) return GeneralOpsWorkflow;

  const key = requestType.toLowerCase().replace(/[\s-]+/g, '_');
  return WORKFLOW_REGISTRY[key] || GeneralOpsWorkflow;
}

export function listWorkflows(): WorkflowDefinition[] {
  return [
    VendorOnboardingWorkflow,
    PurchaseRequestWorkflow,
    ItAccessWorkflow,
    ContractReviewWorkflow,
    FacilitiesRequestWorkflow,
    GeneralOpsWorkflow,
  ];
}
