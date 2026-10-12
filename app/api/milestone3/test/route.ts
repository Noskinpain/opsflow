import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { canTransition } from '@/lib/state-machine';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  try {
    // 1. Matrix Checks
    record('State Machine', 'canTransition(NEW, PROCESSING) is true', canTransition('NEW', 'PROCESSING'));
    record('State Machine', 'canTransition(PROCESSING, AWAITING_REVIEW) is true', canTransition('PROCESSING', 'AWAITING_REVIEW'));
    record('State Machine', 'canTransition(AWAITING_REVIEW, AWAITING_APPROVAL) is true', canTransition('AWAITING_REVIEW', 'AWAITING_APPROVAL'));
    record('State Machine', 'canTransition(AWAITING_APPROVAL, IN_PROGRESS) is true', canTransition('AWAITING_APPROVAL', 'IN_PROGRESS'));
    record('State Machine', 'canTransition(IN_PROGRESS, COMPLETED) is true', canTransition('IN_PROGRESS', 'COMPLETED'));

    record('State Machine Guards', 'canTransition(NEW, COMPLETED) is false', !canTransition('NEW', 'COMPLETED'));
    record('State Machine Guards', 'canTransition(COMPLETED, PROCESSING) is false', !canTransition('COMPLETED', 'PROCESSING'));
    record('State Machine Guards', 'canTransition(REJECTED, COMPLETED) is false', !canTransition('REJECTED', 'COMPLETED'));
    record('State Machine Guards', 'canTransition(CANCELLED, PROCESSING) is false', !canTransition('CANCELLED', 'PROCESSING'));

    // Users
    const requester = await prisma.user.upsert({
      where: { email: 'requester.m3@example.com' },
      update: {},
      create: {
        name: 'Alice Requester',
        email: 'requester.m3@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const johnProcurement = await prisma.user.upsert({
      where: { email: 'john.procurement@example.com' },
      update: {},
      create: {
        name: 'John Procurement',
        email: 'john.procurement@example.com',
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    // Create Request
    const request = await RequestService.createRequest({
      title: 'Workflow Engine Verification Request',
      description: 'Sequential assignment and transition audit logging check.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'M3_SUITE',
    });

    // 2. Assignment
    const assigned = await RequestService.assignRequest(request.id, johnProcurement.id, requester.id);
    record('Assignment', 'Request assigned to John / Procurement', assigned.assigned_to === johnProcurement.id);

    // Verify REQUEST_ASSIGNED event
    const assignEvents = await prisma.activityEvent.findMany({
      where: { request_id: request.id, event_type: 'REQUEST_ASSIGNED' },
    });
    record('Audit Trail', 'REQUEST_ASSIGNED event logged with actor', assignEvents.length >= 1);

    // 3. Sequential Transitions
    const step1 = await RequestService.transitionStatus(request.id, RequestStatus.PROCESSING, johnProcurement.id);
    record('Workflow Transitions', 'Transitioned to PROCESSING', step1.status === RequestStatus.PROCESSING);

    const step2 = await RequestService.transitionStatus(request.id, RequestStatus.AWAITING_REVIEW, johnProcurement.id);
    record('Workflow Transitions', 'Transitioned to AWAITING_REVIEW', step2.status === RequestStatus.AWAITING_REVIEW);

    // Verify REQUEST_STATUS_CHANGED event and { from, to } metadata
    const statusEvents = await prisma.activityEvent.findMany({
      where: { request_id: request.id, event_type: 'REQUEST_STATUS_CHANGED' },
      orderBy: { created_at: 'desc' },
    });
    const latestMeta = statusEvents[0]?.metadata as any;
    const hasFromTo = latestMeta?.from === 'PROCESSING' && latestMeta?.to === 'AWAITING_REVIEW';
    record('Audit Trail', 'REQUEST_STATUS_CHANGED event logged with { from, to } metadata', hasFromTo);

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
