import { PrismaClient, RequestStatus, Priority, UserRole, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create Users
  const requester = await prisma.user.upsert({
    where: { email: 'sarah.connor@cyberdyne.org' },
    update: {},
    create: {
      name: 'Sarah Connor',
      email: 'sarah.connor@cyberdyne.org',
      role: UserRole.REQUESTER,
      department: 'Logistics',
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: 'alex.murphy@omnicorp.com' },
    update: {},
    create: {
      name: 'Alex Murphy',
      email: 'alex.murphy@omnicorp.com',
      role: UserRole.OPERATOR,
      department: 'Procurement',
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'ellen.ripley@weyland.com' },
    update: {},
    create: {
      name: 'Ellen Ripley',
      email: 'ellen.ripley@weyland.com',
      role: UserRole.MANAGER,
      department: 'Compliance',
    },
  });

  console.log(`✓ Created 3 users: ${requester.name}, ${operator.name}, ${manager.name}`);

  // 2. Create Sample Request
  const sampleRequest = await prisma.$transaction(async (tx) => {
    const req = await tx.request.create({
      data: {
        title: 'Supplier Onboarding: Apex Industrial Supplies',
        description:
          'Please onboard Apex Industrial Supplies as a qualified tier-1 equipment supplier. Certificates and bank authorization attached.',
        request_type: 'VENDOR_ONBOARDING',
        priority: Priority.HIGH,
        status: RequestStatus.IN_PROGRESS,
        requester_id: requester.id,
        assigned_to: operator.id,
        source: 'EMAIL',
      },
    });

    // 3. Activity Events: Audit trail
    await tx.activityEvent.createMany({
      data: [
        {
          request_id: req.id,
          actor_id: requester.id,
          event_type: 'REQUEST_CREATED',
          description: 'Request received from inbound email and created in system',
          metadata: { source: 'EMAIL', priority: 'HIGH' },
        },
        {
          request_id: req.id,
          actor_id: null,
          event_type: 'STATUS_CHANGED',
          description: 'System transitioned request from NEW to PROCESSING',
          metadata: { from: 'NEW', to: 'PROCESSING' },
        },
        {
          request_id: req.id,
          actor_id: operator.id,
          event_type: 'REQUEST_ASSIGNED',
          description: `Assigned to ${operator.name} (Procurement)`,
          metadata: { assignee_id: operator.id },
        },
        {
          request_id: req.id,
          actor_id: operator.id,
          event_type: 'STATUS_CHANGED',
          description: 'Transitioned request from PROCESSING to AWAITING_REVIEW',
          metadata: { from: 'PROCESSING', to: 'AWAITING_REVIEW' },
        },
        {
          request_id: req.id,
          actor_id: operator.id,
          event_type: 'STATUS_CHANGED',
          description: 'Transitioned request from AWAITING_REVIEW to AWAITING_APPROVAL',
          metadata: { from: 'AWAITING_REVIEW', to: 'AWAITING_APPROVAL' },
        },
        {
          request_id: req.id,
          actor_id: manager.id,
          event_type: 'APPROVAL_DECIDED',
          description: 'Manager Ellen Ripley approved vendor credential package',
          metadata: { decision: 'APPROVED' },
        },
        {
          request_id: req.id,
          actor_id: manager.id,
          event_type: 'STATUS_CHANGED',
          description: 'Transitioned request from AWAITING_APPROVAL to IN_PROGRESS',
          metadata: { from: 'AWAITING_APPROVAL', to: 'IN_PROGRESS' },
        },
      ],
    });

    // 4. Create Tasks
    await tx.task.create({
      data: {
        request_id: req.id,
        title: 'Verify Tax Identification & W-9 Form',
        description: 'Cross-check IRS database and compliance blacklist.',
        assigned_to: operator.id,
        status: TaskStatus.COMPLETED,
        priority: Priority.HIGH,
        completed_at: new Date(),
      },
    });

    await tx.task.create({
      data: {
        request_id: req.id,
        title: 'Configure ERP Vendor Ledger & Payment Terms',
        description: 'Set payment terms to Net-30 in financial ledger.',
        assigned_to: operator.id,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
      },
    });

    // 5. Create Approval record
    await tx.approval.create({
      data: {
        request_id: req.id,
        approver_id: manager.id,
        status: 'DECIDED',
        decision: 'APPROVED',
        comment: 'All tax and ISO compliance documents verified. Approved for onboarding.',
        decided_at: new Date(),
      },
    });

    // 6. Create Attachment record
    await tx.attachment.create({
      data: {
        request_id: req.id,
        file_name: 'Apex_Supplies_W9_Signed.pdf',
        file_url: 'https://storage.internal.corp/attachments/w9_apex.pdf',
        file_type: 'application/pdf',
        file_size: 1048576,
        status: 'VERIFIED',
      },
    });

    return req;
  });

  console.log(`✓ Seeded sample request: "${sampleRequest.title}" (${sampleRequest.id})`);
  console.log('✨ Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
