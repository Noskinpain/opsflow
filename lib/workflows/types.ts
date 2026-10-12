import { Priority, UserRole } from '@prisma/client';

export type WorkflowStage = 'INTAKE' | 'REVIEW' | 'APPROVAL' | 'EXECUTION' | 'COMPLETION';

export interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assigneeRole: UserRole;
  stage: WorkflowStage;
}

export interface ApprovalConfig {
  required: boolean;
  approverRole: UserRole;
  department?: string;
  title: string;
  description: string;
  minConfidence?: number;
  amountThreshold?: number;
  verificationItems?: string[];
  requiresSeparationOfDuties?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  requestType: string;
  name: string;
  description: string;
  targetDepartment: string;
  initialTasks: TaskTemplate[];
  approvalConfig: ApprovalConfig;
  postApprovalTasks: TaskTemplate[];
}
