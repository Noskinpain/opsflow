import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus, TaskStatus } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { TaskService } from '@/lib/services/task-service';

export async function POST() {
  try {
    // 1. Ensure required demo users exist
    const requester = await prisma.user.upsert({
      where: { email: 'alice.operations@example.com' },
      update: {},
      create: {
        name: 'Alice Requester',
        email: 'alice.operations@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const john = await prisma.user.upsert({
      where: { email: 'john.procurement@example.com' },
      update: {},
      create: {
        name: 'John Procurement',
        email: 'john.procurement@example.com',
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    // 2. Create Request: "Onboard Acme Ltd"
    const req = await RequestService.createRequest({
      title: 'Onboard Acme Ltd',
      description: 'Vendor onboarding and compliance vetting for Acme Ltd.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'OPERATIONS_PORTAL',
    });

    // 3. Assign Request: John
    await RequestService.assignRequest(req.id, john.id, requester.id);

    // 4. Move through workflow to IN_PROGRESS
    await RequestService.transitionStatus(req.id, RequestStatus.PROCESSING, john.id);
    await RequestService.transitionStatus(req.id, RequestStatus.AWAITING_REVIEW, john.id);
    await RequestService.transitionStatus(req.id, RequestStatus.AWAITING_APPROVAL, john.id);
    await RequestService.transitionStatus(req.id, RequestStatus.IN_PROGRESS, john.id);

    // 5. Create Tasks:
    // Task 1: "Verify CAC documents" (completed)
    const task1 = await TaskService.createTask(
      {
        requestId: req.id,
        title: 'Verify CAC documents',
        description: 'Verify CAC incorporation certificate and registry status',
        priority: 'HIGH',
        assignedTo: john.id,
        actorId: john.id,
      }
    );
    await TaskService.updateTaskStatus(task1.id, TaskStatus.IN_PROGRESS, john.id);
    await TaskService.updateTaskStatus(task1.id, TaskStatus.COMPLETED, john.id);

    // Task 2: "Verify tax documents" (completed)
    const task2 = await TaskService.createTask(
      {
        requestId: req.id,
        title: 'Verify tax documents',
        description: 'Check tax clearance certificate and TIN compliance',
        priority: 'HIGH',
        assignedTo: john.id,
        actorId: john.id,
      }
    );
    await TaskService.updateTaskStatus(task2.id, TaskStatus.IN_PROGRESS, john.id);
    await TaskService.updateTaskStatus(task2.id, TaskStatus.COMPLETED, john.id);

    // Task 3: "Create vendor record" (still open / TODO)
    const task3 = await TaskService.createTask(
      {
        requestId: req.id,
        title: 'Create vendor record',
        description: 'Create supplier entry in ERP and set payment terms',
        priority: 'MEDIUM',
        assignedTo: john.id,
        actorId: john.id,
      }
    );

    // Fetch the updated request with full tasks and activity events
    const populated = await RequestService.getRequestById(req.id);

    return NextResponse.json({
      success: true,
      message: 'Milestone 4 scenario provisioned: Onboard Acme Ltd with 2 completed tasks and 1 pending task.',
      data: populated,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
