import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus, TaskStatus } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { TaskService } from '@/lib/services/task-service';
import { canTransitionTask } from '@/lib/task-lifecycle';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  try {
    // 1. Task Lifecycle State Machine Checks
    record('Task Lifecycle', 'canTransitionTask(PENDING, IN_PROGRESS) is true', canTransitionTask('PENDING', 'IN_PROGRESS'));
    record('Task Lifecycle', 'canTransitionTask(IN_PROGRESS, COMPLETED) is true', canTransitionTask('IN_PROGRESS', 'COMPLETED'));
    record('Task Lifecycle', 'canTransitionTask(PENDING, CANCELLED) is true', canTransitionTask('PENDING', 'CANCELLED'));
    record('Task Lifecycle Guards', 'canTransitionTask(COMPLETED, PENDING) is blocked', !canTransitionTask('COMPLETED', 'PENDING'));
    record('Task Lifecycle Guards', 'canTransitionTask(COMPLETED, IN_PROGRESS) is blocked', !canTransitionTask('COMPLETED', 'IN_PROGRESS'));
    record('Task Lifecycle Guards', 'canTransitionTask(CANCELLED, COMPLETED) is blocked', !canTransitionTask('CANCELLED', 'COMPLETED'));

    // 2. Setup Test Users
    const requester = await prisma.user.upsert({
      where: { email: 'requester.m4ui@example.com' },
      update: {},
      create: {
        name: 'Alice Requester',
        email: 'requester.m4ui@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const johnProcurement = await prisma.user.upsert({
      where: { email: 'john.m4ui@example.com' },
      update: {},
      create: {
        name: 'John Procurement',
        email: 'john.m4ui@example.com',
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    // 3. Create Request & Move to IN_PROGRESS
    const request = await RequestService.createRequest({
      title: 'Milestone 4 Verification: Onboard Acme Ltd',
      description: 'End-to-end task execution and completion invariant verification.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'M4_TEST_SUITE',
    });

    await RequestService.assignRequest(request.id, johnProcurement.id, requester.id);
    await RequestService.transitionStatus(request.id, RequestStatus.PROCESSING, johnProcurement.id);
    await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_REVIEW, johnProcurement.id);
    await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_APPROVAL, johnProcurement.id);
    const inProgressReq = await RequestService.transitionStatus(request.id, RequestStatus.IN_PROGRESS, johnProcurement.id);

    record('Request Setup', 'Request advanced to IN_PROGRESS', inProgressReq.status === RequestStatus.IN_PROGRESS);

    // 4. Task Creation
    const task1 = await TaskService.createTask(
      {
        requestId: request.id,
        title: 'Verify CAC documents',
        description: 'Verify corporate affairs commission certificate',
        priority: 'HIGH',
        assignedTo: johnProcurement.id,
        actorId: johnProcurement.id,
      }
    );

    record('Task Creation', 'Task 1 created with PENDING status', task1.status === TaskStatus.PENDING);
    record('Task Creation', 'Task 1 assigned to John', task1.assigned_to === johnProcurement.id);

    const task2 = await TaskService.createTask(
      {
        requestId: request.id,
        title: 'Create vendor record in ERP',
        description: 'Register financial and tax ID records',
        priority: 'MEDIUM',
        actorId: johnProcurement.id,
      }
    );
    record('Task Creation', 'Task 2 created without initial assignee', task2.assigned_to === null);

    // 5. Task Status Changes & Lifecycle
    await TaskService.updateTaskStatus(task1.id, TaskStatus.IN_PROGRESS, johnProcurement.id);
    const task1Done = await TaskService.updateTaskStatus(task1.id, TaskStatus.COMPLETED, johnProcurement.id);
    record('Task Execution', 'Task 1 moved to COMPLETED', task1Done.status === TaskStatus.COMPLETED);

    // 6. Test Invariant: Unfinished Tasks Block Request Completion
    let blockedErrorCaught = false;
    try {
      await RequestService.transitionStatus(request.id, RequestStatus.COMPLETED, johnProcurement.id);
    } catch (e: any) {
      if (e.code === 'INCOMPLETE_TASKS' || e.name === 'IncompleteTasksError') {
        blockedErrorCaught = true;
      }
    }
    record('Completion Invariant', 'Request cannot transition to COMPLETED while Task 2 is unfinished', blockedErrorCaught);

    // 7. Complete Task 2 and Finish Request
    await TaskService.updateTaskStatus(task2.id, TaskStatus.IN_PROGRESS, johnProcurement.id);
    await TaskService.updateTaskStatus(task2.id, TaskStatus.COMPLETED, johnProcurement.id);
    const completedReq = await RequestService.transitionStatus(request.id, RequestStatus.COMPLETED, johnProcurement.id);
    record('Workflow Completion', 'Request successfully COMPLETED after all tasks completed', completedReq.status === RequestStatus.COMPLETED);

    // 8. Verify Activity Trail Events
    const events = await prisma.activityEvent.findMany({
      where: { request_id: request.id },
      orderBy: { created_at: 'asc' },
    });
    const eventTypes = events.map((e) => e.event_type);

    record('Activity Audit Trail', 'Event TASK_CREATED logged', eventTypes.includes('TASK_CREATED'));
    record('Activity Audit Trail', 'Event TASK_ASSIGNED logged', eventTypes.includes('TASK_ASSIGNED'));
    record('Activity Audit Trail', 'Event TASK_STARTED logged', eventTypes.includes('TASK_STARTED'));
    record('Activity Audit Trail', 'Event TASK_COMPLETED logged', eventTypes.includes('TASK_COMPLETED'));

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
