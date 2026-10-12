import { prisma } from '../prisma.ts';

export type StepType =
  | 'INGEST'
  | 'AI_EXTRACTION'
  | 'BUSINESS_RULES'
  | 'HUMAN_APPROVAL'
  | 'TASK_DISPATCH'
  | 'WEBHOOK_OUTBOUND';

export type StepStatus = 'SUCCESS' | 'WAITING' | 'RUNNING' | 'FAILED' | 'SKIPPED';

export interface ExecutionStepTrace {
  stepId: string;
  name: string;
  type: StepType;
  status: StepStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  input?: any;
  output?: any;
  error?: string | null;
  retryCount?: number;
  details?: string;
  aiMetadata?: {
    modelName: string;
    promptSnippet?: string;
    schemaValid: boolean;
    confidence?: number;
    tokensEstimated?: number;
    costUsdEstimated?: number;
    latencyMs?: number;
  };
}

export interface StartExecutionInput {
  requestId: string;
  workflowType: string;
  context?: any;
  maxAttempts?: number;
  initialSteps?: ExecutionStepTrace[];
}

export class ExecutionService {
  /**
   * Sanitizes payload to redact sensitive tokens / API keys.
   */
  static sanitizePayload(data: any): any {
    if (!data || typeof data !== 'object') return data;
    const sanitized = Array.isArray(data) ? [...data] : { ...data };
    const SENSITIVE_KEYS = ['key', 'apiKey', 'password', 'token', 'authorization', 'secret'];
    for (const key of Object.keys(sanitized)) {
      if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizePayload(sanitized[key]);
      }
    }
    return sanitized;
  }

  /**
   * Starts or resumes a workflow technical execution log.
   */
  static async startExecution(input: StartExecutionInput) {
    const { requestId, workflowType, context = {}, maxAttempts = 3, initialSteps = [] } = input;

    const existing = await prisma.workflowExecution.findFirst({
      where: {
        request_id: requestId,
        workflow_type: workflowType,
      },
      orderBy: { started_at: 'desc' },
    });

    if (existing && existing.status === 'FAILED') {
      const existingContext = (existing.context as any) || {};
      const existingSteps: ExecutionStepTrace[] = existingContext.steps || [];

      // Preserve succeeded steps, reset failed steps to RUNNING
      const mergedSteps = existingSteps.map((s) =>
        s.status === 'FAILED' ? { ...s, status: 'RUNNING' as StepStatus, error: null } : s
      );

      return await prisma.workflowExecution.update({
        where: { id: existing.id },
        data: {
          status: 'RUNNING',
          attempt: existing.attempt + 1,
          error: null,
          context: {
            ...existingContext,
            ...context,
            steps: mergedSteps.length > 0 ? mergedSteps : initialSteps,
            last_retry_at: new Date().toISOString(),
          },
        },
      });
    }

    return await prisma.workflowExecution.create({
      data: {
        request_id: requestId,
        workflow_type: workflowType,
        status: 'RUNNING',
        attempt: 1,
        max_attempts: maxAttempts,
        context: {
          ...context,
          steps: initialSteps,
        },
        started_at: new Date(),
      },
    });
  }

  /**
   * Appends or updates a step in execution context.
   */
  static async recordStep(executionId: string, step: ExecutionStepTrace) {
    const exec = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    if (!exec) return null;

    const ctx = (exec.context as any) || {};
    const steps: ExecutionStepTrace[] = Array.isArray(ctx.steps) ? [...ctx.steps] : [];

    const existingIndex = steps.findIndex((s) => s.stepId === step.stepId);
    const sanitizedStep = {
      ...step,
      input: this.sanitizePayload(step.input),
      output: this.sanitizePayload(step.output),
    };

    if (existingIndex >= 0) {
      steps[existingIndex] = { ...steps[existingIndex], ...sanitizedStep };
    } else {
      steps.push(sanitizedStep);
    }

    return await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        context: {
          ...ctx,
          steps,
        },
      },
    });
  }

  /**
   * Updates an existing step by stepId.
   */
  static async updateStep(executionId: string, stepId: string, updates: Partial<ExecutionStepTrace>) {
    const exec = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    if (!exec) return null;

    const ctx = (exec.context as any) || {};
    const steps: ExecutionStepTrace[] = Array.isArray(ctx.steps) ? [...ctx.steps] : [];

    const idx = steps.findIndex((s) => s.stepId === stepId);
    if (idx >= 0) {
      const existing = steps[idx];
      const now = Date.now();
      const started = existing.startedAt ? new Date(existing.startedAt).getTime() : now;
      const durationMs = updates.completedAt ? new Date(updates.completedAt).getTime() - started : updates.durationMs;

      steps[idx] = {
        ...existing,
        ...updates,
        durationMs: durationMs ?? existing.durationMs,
        input: updates.input !== undefined ? this.sanitizePayload(updates.input) : existing.input,
        output: updates.output !== undefined ? this.sanitizePayload(updates.output) : existing.output,
      };

      return await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          context: {
            ...ctx,
            steps,
          },
        },
      });
    }
    return null;
  }

  /**
   * Marks a technical execution as SUCCESS.
   */
  static async completeExecution(executionId: string, resultContext?: any) {
    const exec = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    const ctx = (exec?.context as any) || {};

    return await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'SUCCESS',
        completed_at: new Date(),
        error: null,
        context: {
          ...ctx,
          ...(resultContext || {}),
        },
      },
    });
  }

  /**
   * Marks a technical execution as FAILED without corrupting business request status.
   */
  static async failExecution(executionId: string, error: string, failureContext?: any) {
    const exec = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    const ctx = (exec?.context as any) || {};

    return await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'FAILED',
        error,
        completed_at: new Date(),
        context: {
          ...ctx,
          ...(failureContext || {}),
        },
      },
    });
  }

  /**
   * Retrieves all executions for a request.
   */
  static async getExecutionsByRequest(requestId: string) {
    return await prisma.workflowExecution.findMany({
      where: { request_id: requestId },
      orderBy: { started_at: 'desc' },
      include: {
        request: {
          select: { id: true, title: true, status: true, priority: true, request_type: true },
        },
      },
    });
  }

  /**
   * Retrieves a single execution with full step details.
   */
  static async getExecutionById(executionId: string) {
    return await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: {
        request: {
          include: {
            requester: { select: { id: true, name: true, email: true, department: true } },
            assignee: { select: { id: true, name: true, email: true, department: true } },
            tasks: true,
            approvals: true,
            ai_analyses: true,
          },
        },
      },
    });
  }

  /**
   * Lists recent technical workflow executions across all requests.
   */
  static async listRecentExecutions(limit: number = 50) {
    return await prisma.workflowExecution.findMany({
      take: limit,
      orderBy: { started_at: 'desc' },
      include: {
        request: {
          select: { id: true, title: true, status: true, priority: true, request_type: true },
        },
      },
    });
  }
}
