import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { CreateRequestSchema } from '@/lib/validation/schemas';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  try {
    // Ensure test user exists
    const testUser = await prisma.user.upsert({
      where: { email: 'intake.tester@example.com' },
      update: {},
      create: {
        name: 'Intake Test Requester',
        email: 'intake.tester@example.com',
        role: UserRole.REQUESTER,
        department: 'Logistics',
      },
    });

    // 1. Validation Rules
    const missingTitle = CreateRequestSchema.safeParse({
      description: 'Valid description longer than 5 chars',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: testUser.id,
    });
    record('Validation', 'Title required (missing title rejected)', !missingTitle.success);

    const missingDesc = CreateRequestSchema.safeParse({
      title: 'Valid Request Title',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: testUser.id,
    });
    record('Validation', 'Description required (missing description rejected)', !missingDesc.success);

    const invalidType = CreateRequestSchema.safeParse({
      title: 'Valid Request Title',
      description: 'Valid description longer than 5 chars',
      request_type: 'UNKNOWN_RANDOM_TYPE',
      priority: 'HIGH',
      requester_id: testUser.id,
    });
    record('Validation', 'Valid request type enforced', !invalidType.success);

    const invalidPriority = CreateRequestSchema.safeParse({
      title: 'Valid Request Title',
      description: 'Valid description longer than 5 chars',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'EXTREME',
      requester_id: testUser.id,
    });
    record('Validation', 'Valid priority enforced', !invalidPriority.success);

    // 2. Requester Existence
    let nonExistentRequesterCaught = false;
    try {
      await RequestService.createRequest({
        title: 'Valid Title Here',
        description: 'Valid description here',
        request_type: 'VENDOR_ONBOARDING',
        priority: 'MEDIUM',
        requester_id: 'a0000000-0000-4000-8000-000000000000',
      });
    } catch (e: any) {
      nonExistentRequesterCaught = e.name === 'NotFoundError';
    }
    record('Domain Check', 'Requester must exist in database', nonExistentRequesterCaught);

    // 3. Request Intake in Supabase
    const created = await RequestService.createRequest({
      title: 'API Intake: Vendor Onboarding Request',
      description: 'Incoming supplier intake for Apex Industrial Supplies.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: testUser.id,
      source: 'API_VERIFICATION',
    });

    record('Persistence', 'Request stored in PostgreSQL with UUID', Boolean(created.id));
    record('State Machine', 'Initial status is strictly "NEW"', created.status === RequestStatus.NEW);
    record('Audit Trail', 'created_at generated server-side', Boolean(created.created_at));

    // 4. Activity Logging
    const events = await prisma.activityEvent.findMany({
      where: { request_id: created.id },
    });
    const hasCreatedEvent = events.some((e) => e.event_type === 'REQUEST_CREATED');
    record('Audit Trail', 'Atomic REQUEST_CREATED activity event logged', hasCreatedEvent);

    // 5. Six Columns Present
    const listed = await RequestService.listRequests();
    const item = listed.find((r) => r.id === created.id);
    const hasAllSix =
      Boolean(item?.title) &&
      Boolean(item?.request_type) &&
      Boolean(item?.priority) &&
      Boolean(item?.status) &&
      item !== undefined &&
      'assigned_to' in item &&
      Boolean(item?.created_at);

    record('Dashboard Retrieval', 'All 6 core fields (Request, Type, Priority, Status, Assigned To, Created) retrievable', hasAllSix);

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return NextResponse.json({
      success: true,
      total: results.length,
      passedCount,
      failedCount,
      allPassed: failedCount === 0,
      createdRequestId: created.id,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        results,
      },
      { status: 500 }
    );
  }
}
