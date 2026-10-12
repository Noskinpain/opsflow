import { PrismaClient, RequestStatus, Priority, UserRole } from '@prisma/client';
import { RequestService } from '../lib/services/request-service.ts';
import { CreateRequestSchema } from '../lib/validation/schemas.ts';

const prisma = new PrismaClient();

async function runIntakeVerification() {
  console.log('\n========================================================');
  console.log('  MILESTONE 2: REQUEST INTAKE & VALIDATION VERIFICATION ');
  console.log('========================================================\n');

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

  // Ensure test requester exists
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

  console.log(`--- 1. Testing Validation Rules (Zod Schemas) ---`);

  // 1a. Missing Title
  const missingTitle = CreateRequestSchema.safeParse({
    description: 'Valid description with sufficient length',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: testUser.id,
  });
  assert(!missingTitle.success, 'Reject request when title is missing');

  // 1b. Missing Description
  const missingDesc = CreateRequestSchema.safeParse({
    title: 'Valid Request Title',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: testUser.id,
  });
  assert(!missingDesc.success, 'Reject request when description is missing');

  // 1c. Invalid Request Type
  const invalidType = CreateRequestSchema.safeParse({
    title: 'Valid Request Title',
    description: 'Valid description with sufficient length',
    request_type: 'RANDOM_UNKNOWN_TYPE',
    priority: 'HIGH',
    requester_id: testUser.id,
  });
  assert(!invalidType.success, 'Reject request with invalid request_type');

  // 1d. Invalid Priority
  const invalidPriority = CreateRequestSchema.safeParse({
    title: 'Valid Request Title',
    description: 'Valid description with sufficient length',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'SUPER_URGENT',
    requester_id: testUser.id,
  });
  assert(!invalidPriority.success, 'Reject request with invalid priority');

  // 1e. Non-existent Requester (Domain check)
  console.log(`\n--- 2. Testing Non-Existent Requester Check ---`);
  try {
    await RequestService.createRequest({
      title: 'Valid Request Title',
      description: 'Valid description with sufficient length',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: 'a0000000-0000-4000-8000-000000000000', // Non-existent UUID
    });
    assert(false, 'Should throw error when requester does not exist');
  } catch (e: any) {
    assert(e.name === 'NotFoundError', 'Throws NotFoundError when requester does not exist in database');
  }

  // 3. Happy Path: POST / Request Intake
  console.log(`\n--- 3. Testing Request Intake & Storage in PostgreSQL ---`);
  const created = await RequestService.createRequest({
    title: 'Intake Test: Acme Logistics Onboarding',
    description: 'Automated intake test request for supplier verification and ERP ledger setup.',
    request_type: 'VENDOR_ONBOARDING',
    priority: 'HIGH',
    requester_id: testUser.id,
    source: 'WEB_INTAKE',
  }, false);

  assert(Boolean(created.id), 'Request successfully stored with server-generated UUID');
  assert(created.status === RequestStatus.NEW, 'Initial status is strictly enforced as "NEW"');
  assert(Boolean(created.created_at), 'Timestamp "created_at" generated server-side');

  // 4. Activity Logging Verification
  console.log(`\n--- 4. Testing Audit Trail (REQUEST_CREATED Event) ---`);
  const events = await prisma.activityEvent.findMany({
    where: { request_id: created.id },
  });

  assert(events.length === 1, 'Exactly one activity event created atomically with the request');
  assert(events[0].event_type === 'REQUEST_CREATED', 'Event type is "REQUEST_CREATED"');
  assert(events[0].actor_id === testUser.id, 'Activity event actor matches the requester');
  assert(
    events[0].description.includes(created.title),
    'Activity event description contains request title'
  );

  // 5. Dashboard List Retrieval Verification
  console.log(`\n--- 5. Testing Dashboard Retrieval (Required 6 Fields) ---`);
  const listed = await RequestService.listRequests();
  const fetched = listed.find((r) => r.id === created.id);

  assert(Boolean(fetched), 'Created request retrieved by list query');
  assert(Boolean(fetched?.title), 'Field 1: Request (Title) present');
  assert(Boolean(fetched?.request_type), 'Field 2: Type present');
  assert(Boolean(fetched?.priority), 'Field 3: Priority present');
  assert(fetched?.status === 'NEW', 'Field 4: Status present (NEW)');
  assert(fetched !== undefined && 'assigned_to' in fetched, 'Field 5: Assigned To present');
  assert(Boolean(fetched?.created_at), 'Field 6: Created timestamp present');

  console.log('\n========================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('========================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 MILESTONE 2: REQUEST INTAKE & VALIDATION FULLY VERIFIED!\n');
  }
}

runIntakeVerification().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
