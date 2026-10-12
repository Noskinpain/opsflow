import { RequestStatus, Priority, UserRole, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.ts';
import { RequestService } from '../lib/services/request-service.ts';
import { TaskService } from '../lib/services/task-service.ts';
import { canTransitionTask } from '../lib/task-lifecycle.ts';

async function runMilestoneFourTests() {
  await prisma.$connect();
  console.log('\n=============================================================');
  console.log('  MILESTONE 4: TASKS & WORKFLOW EXECUTION TEST SUITE          ');
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

  // Setup test users
  const requester = await prisma.user.upsert({
    where: { email: 'requester.m4@example.com' },
    update: {},
    create: {
      name: 'Alice Requester',
      email: 'requester.m4@example.com',
      role: UserRole.REQUESTER,
      department: 'Operations',
    },
  });

  const johnProcurement = await prisma.user.upsert({
    where: { email: 'john.m4@example.com' },
    update: {},
    create: {
      name: 'John Procurement',
      email: 'john.m4@example.com',
      role: UserRole.OPERATOR,
      department: 'Procurement',
    },
  });

  // -------------------------------------------------------------
  // 1. CREATE REQUEST & MOVE TO IN_PROGRESS
  // -------------------------------------------------------------
  console.log('--- 1. Setting Up Request Workflow ---');

  const request = await RequestService.createRequest({
    title: 'Onboard Acme Ltd',
    description: 'Vendor Onboarding workflow with CAC and tax document verification.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: requester.id,
    source: 'WEB_PORTAL',
  });
  assert(request.status === RequestStatus.NEW, 'Request created in NEW status');

  await RequestService.assignRequest(request.id, johnProcurement.id, requester.id);
  await RequestService.transitionStatus(request.id, RequestStatus.PROCESSING, johnProcurement.id);
  await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_REVIEW, johnProcurement.id);
  await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_APPROVAL, johnProcurement.id);
  await RequestService.transitionStatus(request.id, RequestStatus.IN_PROGRESS, johnProcurement.id);
  assert(true, 'Request advanced sequentially: NEW -> PROCESSING -> REVIEW -> APPROVAL -> IN_PROGRESS');

  // -------------------------------------------------------------
  // 2. TASK CREATION (POST /api/tasks)
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Task Creation & Validation (POST /api/tasks) ---');

  // 2a. Task 1 with assignment & due date
  const task1 = await TaskService.createTask({
    requestId: request.id,
    title: 'Verify CAC documents',
    description: 'Check CAC corporate registration documents',
    assignedTo: johnProcurement.id,
    priority: 'HIGH',
    dueAt: '2026-10-10T12:00:00.000Z',
    actorId: johnProcurement.id,
  });

  assert(Boolean(task1.id), 'Task 1 created with server UUID');
  assert(task1.status === TaskStatus.PENDING, 'Initial task status is PENDING (TODO)');
  assert(task1.assigned_to === johnProcurement.id, 'Task 1 assigned to John');

  // 2b. Task 2 without initial assignee
  const task2 = await TaskService.createTask({
    requestId: request.id,
    title: 'Create vendor record',
    description: 'Set up vendor account in ERP ledger',
    priority: 'MEDIUM',
    actorId: johnProcurement.id,
  });

  assert(Boolean(task2.id), 'Task 2 created successfully');
  assert(task2.assigned_to === null, 'Task 2 initially unassigned');

  // 2c. Validation: Task for nonexistent request
  try {
    await TaskService.createTask({
      requestId: 'a0000000-0000-4000-8000-000000000000',
      title: 'Invalid Task',
    });
    assert(false, 'Should block task creation for nonexistent request');
  } catch (e: any) {
    assert(e.name === 'NotFoundError', 'Throws NotFoundError for nonexistent request');
  }

  // 2d. Validation: Task with nonexistent assignee
  try {
    await TaskService.createTask({
      requestId: request.id,
      title: 'Invalid Assignee Task',
      assignedTo: 'a0000000-0000-4000-8000-000000000000',
    });
    assert(false, 'Should block task creation with nonexistent assignee');
  } catch (e: any) {
    assert(e.name === 'NotFoundError', 'Throws NotFoundError for nonexistent assignee');
  }

  // 2e. Validation: Duplicate active task title
  try {
    await TaskService.createTask({
      requestId: request.id,
      title: 'Verify CAC documents', // Identical active task title
    });
    assert(false, 'Should block duplicate active task on same request');
  } catch (e: any) {
    assert(e.name === 'DuplicateTaskError', 'Throws DuplicateTaskError for duplicate active task');
  }

  // -------------------------------------------------------------
  // 3. TASK LIFECYCLE & STATE MACHINE (TODO -> IN_PROGRESS -> COMPLETED)
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Task Lifecycle & Events ---');

  // Assign Task 2 to John
  await TaskService.assignTask(task2.id, johnProcurement.id, requester.id);
  const updatedTask2 = await TaskService.getTaskById(task2.id);
  assert(updatedTask2.assigned_to === johnProcurement.id, 'Task 2 assigned to John');

  // Start Task 1: PENDING -> IN_PROGRESS
  const startedTask1 = await TaskService.updateTaskStatus(
    task1.id,
    TaskStatus.IN_PROGRESS,
    johnProcurement.id
  );
  assert(startedTask1.status === TaskStatus.IN_PROGRESS, 'Task 1 moved to IN_PROGRESS');

  // Complete Task 1: IN_PROGRESS -> COMPLETED
  const completedTask1 = await TaskService.updateTaskStatus(
    task1.id,
    TaskStatus.COMPLETED,
    johnProcurement.id
  );
  assert(completedTask1.status === TaskStatus.COMPLETED, 'Task 1 moved to COMPLETED');
  assert(Boolean(completedTask1.completed_at), 'Task 1 completed_at timestamp recorded');

  // Block invalid transition: COMPLETED -> PENDING
  try {
    await TaskService.updateTaskStatus(task1.id, TaskStatus.PENDING, johnProcurement.id);
    assert(false, 'Should block transition from COMPLETED back to PENDING/TODO');
  } catch (e: any) {
    assert(
      e.name === 'TaskAlreadyCompletedError' || e.name === 'InvalidTaskTransitionError',
      'Blocks reopening/transitioning an already completed task'
    );
  }

  // -------------------------------------------------------------
  // 4. INVARIANT: CONNECT TASKS TO REQUEST COMPLETION
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Business Invariant: Unfinished Tasks Block Completion ---');

  // Task 1 is COMPLETED, but Task 2 is still PENDING!
  try {
    await RequestService.transitionStatus(
      request.id,
      RequestStatus.COMPLETED,
      johnProcurement.id,
      'Attempting completion before finishing Task 2'
    );
    assert(false, 'Should block request completion when tasks remain unfinished');
  } catch (e: any) {
    assert(
      e.name === 'IncompleteTasksError',
      'Throws IncompleteTasksError blocking request completion with unfinished tasks'
    );
  }

  // Now complete Task 2
  await TaskService.updateTaskStatus(task2.id, TaskStatus.IN_PROGRESS, johnProcurement.id);
  await TaskService.updateTaskStatus(task2.id, TaskStatus.COMPLETED, johnProcurement.id);
  assert(true, 'Task 2 finished: now all tasks on request are COMPLETED');

  // Now request completion is allowed!
  const completedRequest = await RequestService.transitionStatus(
    request.id,
    RequestStatus.COMPLETED,
    johnProcurement.id,
    'All required tasks completed successfully'
  );
  assert(completedRequest.status === RequestStatus.COMPLETED, 'Request successfully moved to COMPLETED once all tasks done');

  // -------------------------------------------------------------
  // 5. ACTIVITY TIMELINE AUDIT VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 5. Verifying Unified Activity Audit Trail ---');

  const events = await prisma.activityEvent.findMany({
    where: { request_id: request.id },
    orderBy: { created_at: 'asc' },
  });

  const eventTypes = events.map((e) => e.event_type);
  assert(eventTypes.includes('REQUEST_CREATED'), 'Timeline includes REQUEST_CREATED');
  assert(eventTypes.includes('REQUEST_ASSIGNED'), 'Timeline includes REQUEST_ASSIGNED');
  assert(eventTypes.includes('TASK_CREATED'), 'Timeline includes TASK_CREATED');
  assert(eventTypes.includes('TASK_ASSIGNED'), 'Timeline includes TASK_ASSIGNED');
  assert(eventTypes.includes('TASK_STARTED'), 'Timeline includes TASK_STARTED');
  assert(eventTypes.includes('TASK_COMPLETED'), 'Timeline includes TASK_COMPLETED');
  assert(eventTypes.includes('REQUEST_STATUS_CHANGED'), 'Timeline includes REQUEST_STATUS_CHANGED');

  console.log('\n=============================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 MILESTONE 4: TASKS & WORKFLOW EXECUTION FULLY VERIFIED!\n');
  }
}

runMilestoneFourTests().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
