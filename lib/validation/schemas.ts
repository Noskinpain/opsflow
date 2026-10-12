import { z } from 'zod';

export const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const RequestTypeEnum = z.enum([
  'VENDOR_ONBOARDING',
  'PURCHASE_ORDER',
  'EQUIPMENT_REQUEST',
  'COMPLIANCE_AUDIT',
  'CONTRACT_REVIEW',
  'FACILITIES_REQUEST',
  'IT_ACCESS',
  'GENERAL_OPS',
]);
export const RequestStatusEnum = z.enum([
  'NEW',
  'PROCESSING',
  'AWAITING_REVIEW',
  'AWAITING_APPROVAL',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);
export const TaskStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const UserRoleEnum = z.enum(['REQUESTER', 'OPERATOR', 'MANAGER', 'ADMIN']);
export const ApprovalStatusEnum = z.enum(['PENDING', 'DECIDED', 'CANCELLED']);
export const ApprovalDecisionEnum = z.enum(['APPROVED', 'REJECTED']);

/**
 * Schema for creating a new user
 */
export const CreateUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  role: UserRoleEnum.default('REQUESTER'),
  department: z.string().min(1, 'Department is required').max(100),
});

/**
 * Schema for creating a new Request
 */
export const CreateRequestSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  request_type: RequestTypeEnum,
  priority: PriorityEnum.default('MEDIUM'),
  requester_id: z.string().uuid('Requester ID must be a valid UUID'),
  assigned_to: z.string().uuid('Assignee ID must be a valid UUID').optional().nullable(),
  source: z.string().optional().default('MANUAL'),
  due_at: z.string().datetime().optional().nullable(),
});

/**
 * Schema for updating Request status (state transition)
 */
export const TransitionRequestSchema = z.object({
  status: RequestStatusEnum,
  actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  reason: z.string().optional(),
});

export const AssignRequestSchema = z
  .object({
    assignedTo: z.string().uuid('Assigned user ID must be a valid UUID').optional(),
    assigned_to: z.string().uuid('Assigned user ID must be a valid UUID').optional(),
    actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
    actorId: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  })
  .refine((data) => Boolean(data.assignedTo || data.assigned_to), {
    message: 'assignedTo or assigned_to must be provided as a valid UUID',
    path: ['assignedTo'],
  });

export const TaskStatusInputEnum = z
  .enum(['TODO', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  .transform((val) => (val === 'TODO' ? ('PENDING' as const) : val));

/**
 * Schema for creating a Task (supports camelCase & snake_case)
 */
export const CreateTaskSchema = z
  .object({
    requestId: z.string().uuid('Request ID must be a valid UUID').optional(),
    request_id: z.string().uuid('Request ID must be a valid UUID').optional(),
    title: z.string().min(2, 'Title must be at least 2 characters').max(200),
    description: z.string().max(1000).optional().nullable(),
    assignedTo: z.string().uuid('Assignee ID must be a valid UUID').optional().nullable(),
    assigned_to: z.string().uuid('Assignee ID must be a valid UUID').optional().nullable(),
    priority: PriorityEnum.optional().default('MEDIUM'),
    dueAt: z.string().datetime().optional().nullable(),
    due_at: z.string().datetime().optional().nullable(),
    actorId: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
    actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  })
  .refine((data) => Boolean(data.requestId || data.request_id), {
    message: 'requestId or request_id must be provided as a valid UUID',
    path: ['requestId'],
  });

/**
 * Schema for updating general Task properties (PATCH /api/tasks/:id)
 */
export const UpdateTaskSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  priority: PriorityEnum.optional(),
  dueAt: z.string().datetime().optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
  status: TaskStatusInputEnum.optional(),
  actorId: z.string().uuid().optional().nullable(),
  actor_id: z.string().uuid().optional().nullable(),
});

/**
 * Schema for updating Task status (PATCH /api/tasks/:id/status)
 */
export const UpdateTaskStatusSchema = z.object({
  status: TaskStatusInputEnum,
  actorId: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
});

/**
 * Schema for creating an Approval
 */
export const CreateApprovalSchema = z.object({
  request_id: z.string().uuid('Request ID must be a valid UUID'),
  approver_id: z.string().uuid('Approver ID must be a valid UUID'),
  actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
});

/**
 * Schema for deciding an Approval (Milestone 7)
 */
export const DecideApprovalSchema = z.object({
  decision: ApprovalDecisionEnum,
  comment: z.string().max(500).optional().nullable(),
  approverId: z.string().uuid('Approver ID must be a valid UUID').optional().nullable(),
  approver_id: z.string().uuid('Approver ID must be a valid UUID').optional().nullable(),
  actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
});

/**
 * Milestone 7: Human-in-the-loop schema for confirming or correcting uncertain AI classification
 */
export const ConfirmClassificationSchema = z.object({
  confirmedRequestType: z.string().min(1).optional().nullable(),
  confirmedDepartment: z.string().optional().nullable(),
  actorId: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  actor_id: z.string().uuid('Actor ID must be a valid UUID').optional().nullable(),
  comment: z.string().max(500).optional().nullable(),
});

/**
 * Milestone 5: AI Classification & Structured Extraction Schema
 * Validates structured LLM outputs before they are processed by the workflow engine.
 */
export const AiClassificationOutputSchema = z.object({
  requestType: z.string().min(1, 'requestType is required').transform((val) => {
    // Standardize to UPPER_SNAKE_CASE (e.g. vendor_onboarding -> VENDOR_ONBOARDING)
    return val.trim().toUpperCase().replace(/[\s-]+/g, '_');
  }),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  summary: z.string().min(3, 'Summary must be at least 3 characters'),
  entities: z.record(z.string(), z.any()).default({}),
  documentsMentioned: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  suggestedDepartment: z.string().min(1, 'suggestedDepartment is required').transform((val) => val.trim().toLowerCase()),
  confidence: z.number().min(0).max(1).default(1.0),
  isActionable: z.boolean().default(true),
  reasoning: z.string().optional().default(''),
});

export const ClassifyRequestInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  requestId: z.string().uuid('Request ID must be a valid UUID').optional(),
  request_id: z.string().uuid('Request ID must be a valid UUID').optional(),
});

export type CreateUserInput = z.input<typeof CreateUserSchema>;
export type CreateRequestInput = z.input<typeof CreateRequestSchema>;
export type TransitionRequestInput = z.input<typeof TransitionRequestSchema>;
export type AssignRequestInput = z.input<typeof AssignRequestSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskSchema>;
export type UpdateTaskStatusInput = z.input<typeof UpdateTaskStatusSchema>;
export type CreateApprovalInput = z.input<typeof CreateApprovalSchema>;
export type DecideApprovalInput = z.input<typeof DecideApprovalSchema>;
export type ConfirmClassificationInput = z.input<typeof ConfirmClassificationSchema>;
export type AiClassificationOutput = z.infer<typeof AiClassificationOutputSchema>;
export type ClassifyRequestInput = z.infer<typeof ClassifyRequestInputSchema>;
