import { prisma } from '../prisma.ts';
import { RequestStatus, Priority } from '@prisma/client';
import {
  assertValidRequestTransition,
  isTerminalStatus,
  IncompleteTasksError,
} from '../state-machine.ts';
import {
  NotFoundError,
  DuplicateAssignmentError,
  ClosedRequestModificationError,
} from '../errors.ts';
import type {
  CreateRequestInput,
  AssignRequestInput,
  TransitionRequestInput,
} from '../validation/schemas.ts';
import {
  CreateRequestSchema,
  AssignRequestSchema,
  TransitionRequestSchema,
} from '../validation/schemas.ts';
import { AiClassifierService } from './ai-classifier-service.ts';
import { SlaService } from './sla-service.ts';

export class RequestService {
  /**
   * Creates a new Request.
   * Invariant: Requester must be a valid existing user.
   * Invariant: Initial status is always 'NEW'.
   * Invariant: An ActivityEvent ('REQUEST_CREATED') is atomically created.
   */
  static async createRequest(input: CreateRequestInput, autoClassify: boolean = true) {
    const validated = CreateRequestSchema.parse(input);

    // Verify requester exists
    const requester = await prisma.user.findUnique({
      where: { id: validated.requester_id },
    });
    if (!requester) {
      throw new NotFoundError('User (requester)', validated.requester_id);
    }

    // Verify assigned user exists if provided
    if (validated.assigned_to) {
      const assignee = await prisma.user.findUnique({
        where: { id: validated.assigned_to },
      });
      if (!assignee) {
        throw new NotFoundError('User (assignee)', validated.assigned_to);
      }
    }

    const createdRequest = await prisma.$transaction(
      async (tx) => {
        const request = await tx.request.create({
          data: {
            title: validated.title,
            description: validated.description,
            request_type: validated.request_type,
            priority: validated.priority as Priority,
            status: RequestStatus.NEW,
            requester_id: validated.requester_id,
            assigned_to: validated.assigned_to,
            source: validated.source || 'MANUAL',
            due_at: validated.due_at
              ? new Date(validated.due_at)
              : SlaService.calculateDeadline(validated.priority as Priority),
          },
        });

        // Atomically create activity event
        await tx.activityEvent.create({
          data: {
            request_id: request.id,
            actor_id: validated.requester_id,
            event_type: 'REQUEST_CREATED',
            description: `Request created: "${request.title}" (${request.request_type}) with priority ${request.priority}`,
            metadata: {
              title: request.title,
              request_type: request.request_type,
              priority: request.priority,
              initial_status: request.status,
              requester_name: requester.name,
            },
          },
        });

        return request;
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Milestone 5: Automatic AI classification & structured extraction
    if (autoClassify) {
      try {
        await AiClassifierService.classifyAndStore(
          createdRequest.id,
          createdRequest.title,
          createdRequest.description,
          validated.requester_id
        );
      } catch (aiErr) {
        console.warn('Auto AI classification failed, skipping:', aiErr);
      }
    }

    return createdRequest;
  }

  /**
   * Transitions a request to a new status.
   * Invariants enforced:
   * 1. Request must exist.
   * 2. Cannot transition out of terminal state.
   * 3. Transition must be valid according to formal state machine.
   * 4. Cannot complete if there are active (uncompleted) tasks.
   * 5. Atomically records 'STATUS_CHANGED' activity event.
   */
  static async transitionStatus(
    requestId: string,
    newStatus: RequestStatus,
    actorId?: string | null,
    reason?: string
  ) {
    TransitionRequestSchema.parse({
      status: newStatus,
      actor_id: actorId,
      reason,
    });

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { tasks: true },
    });

    if (!request) {
      throw new NotFoundError('Request', requestId);
    }

    // Invariant: Check if current state is terminal
    if (isTerminalStatus(request.status)) {
      throw new ClosedRequestModificationError(
        requestId,
        request.status,
        `transition to '${newStatus}'`
      );
    }

    // Invariant: Verify state machine transition
    assertValidRequestTransition(request.status, newStatus);

    // Invariant: If moving to COMPLETED, check open tasks
    if (newStatus === RequestStatus.COMPLETED) {
      const openTasks = request.tasks.filter(
        (t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
      );
      if (openTasks.length > 0) {
        throw new IncompleteTasksError(requestId, openTasks.length);
      }
    }

    // Optional check: actor verification
    if (actorId) {
      const actor = await prisma.user.findUnique({ where: { id: actorId } });
      if (!actor) {
        throw new NotFoundError('User (actor)', actorId);
      }
    }

    return await prisma.$transaction(
      async (tx) => {
        const updated = await tx.request.update({
          where: { id: requestId },
          data: { status: newStatus },
        });

        await tx.activityEvent.create({
          data: {
            request_id: requestId,
            actor_id: actorId || null,
            event_type: 'REQUEST_STATUS_CHANGED',
            description: `Status transitioned from ${request.status} to ${newStatus}${
              reason ? `: ${reason}` : ''
            }`,
            metadata: {
              from: request.status,
              to: newStatus,
              from_status: request.status,
              to_status: newStatus,
              reason: reason || null,
            },
          },
        });

        return updated;
      },
      { maxWait: 10000, timeout: 20000 }
    );
  }

  /**
   * Assigns a request to a user.
   * Invariants enforced:
   * 1. Request must exist.
   * 2. Cannot assign closed/terminal request.
   * 3. Assignee must be a real user.
   * 4. Duplicate assignment prevention.
   * 5. Atomically records 'REQUEST_ASSIGNED' activity event.
   */
  static async assignRequest(
    requestId: string,
    assignedTo: string,
    actorId?: string | null
  ) {
    AssignRequestSchema.parse({
      assigned_to: assignedTo,
      actor_id: actorId,
    });

    const request = await prisma.request.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundError('Request', requestId);
    }

    if (isTerminalStatus(request.status)) {
      throw new ClosedRequestModificationError(
        requestId,
        request.status,
        'assign request'
      );
    }

    if (request.assigned_to === assignedTo) {
      throw new DuplicateAssignmentError(requestId, assignedTo);
    }

    const assignee = await prisma.user.findUnique({
      where: { id: assignedTo },
    });
    if (!assignee) {
      throw new NotFoundError('User (assignee)', assignedTo);
    }

    return await prisma.$transaction(
      async (tx) => {
        const updated = await tx.request.update({
          where: { id: requestId },
          data: { assigned_to: assignedTo },
        });

        await tx.activityEvent.create({
          data: {
            request_id: requestId,
            actor_id: actorId || null,
            event_type: 'REQUEST_ASSIGNED',
            description: `Request assigned to ${assignee.name} (${assignee.department})`,
            metadata: {
              previous_assignee: request.assigned_to,
              new_assignee: assignedTo,
              assignee_name: assignee.name,
              assignee_email: assignee.email,
            },
          },
        });

        return updated;
      },
      { maxWait: 10000, timeout: 20000 }
    );
  }

  /**
   * Retrieves a single request with all child relations.
   */
  static async getRequestById(id: string) {
    const request = await prisma.request.findUnique({
      where: { id },
      include: {
        requester: true,
        assignee: true,
        tasks: {
          include: { assignee: true },
          orderBy: { created_at: 'asc' },
        },
        approvals: {
          include: { approver: true },
          orderBy: { created_at: 'asc' },
        },
        attachments: {
          orderBy: { uploaded_at: 'asc' },
        },
        activity_events: {
          include: { actor: true },
          orderBy: { created_at: 'desc' },
        },
        ai_analyses: {
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!request) {
      throw new NotFoundError('Request', id);
    }
    return request;
  }

  /**
   * Lists requests with optional filtering.
   */
  static async listRequests(filters?: {
    status?: RequestStatus;
    priority?: Priority;
    request_type?: string;
    assigned_to?: string;
    requester_id?: string;
  }) {
    return await prisma.request.findMany({
      where: {
        status: filters?.status,
        priority: filters?.priority,
        request_type: filters?.request_type,
        assigned_to: filters?.assigned_to,
        requester_id: filters?.requester_id,
      },
      include: {
        requester: true,
        assignee: true,
        tasks: true,
        approvals: true,
        _count: {
          select: {
            tasks: true,
            attachments: true,
            activity_events: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
