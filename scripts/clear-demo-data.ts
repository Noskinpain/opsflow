import { prisma } from '../lib/prisma.ts';

async function clearDemoData() {
  console.log('Clearing all demo and test records from database...');

  // Delete all dependent records in reverse order
  const delNotifs = await prisma.notificationEvent.deleteMany({});
  console.log(`Deleted ${delNotifs.count} notification events`);

  const delExecs = await prisma.workflowExecution.deleteMany({});
  console.log(`Deleted ${delExecs.count} workflow executions`);

  const delEvents = await prisma.activityEvent.deleteMany({});
  console.log(`Deleted ${delEvents.count} activity events`);

  const delAttach = await prisma.attachment.deleteMany({});
  console.log(`Deleted ${delAttach.count} attachments`);

  const delTasks = await prisma.task.deleteMany({});
  console.log(`Deleted ${delTasks.count} tasks`);

  const delApprs = await prisma.approval.deleteMany({});
  console.log(`Deleted ${delApprs.count} approvals`);

  const delAi = await prisma.requestAiAnalysis.deleteMany({});
  console.log(`Deleted ${delAi.count} AI analyses`);

  const delReqs = await prisma.request.deleteMany({});
  console.log(`Deleted ${delReqs.count} requests`);

  const delIdem = await prisma.processedEvent.deleteMany({});
  console.log(`Deleted ${delIdem.count} processed events`);

  // Ensure base users exist
  const userCount = await prisma.user.count();
  console.log(`Users remaining in database: ${userCount}`);

  if (userCount === 0) {
    console.log('Seeding baseline team users...');
    await prisma.user.createMany({
      data: [
        {
          id: 'usr_sarah_mgr',
          name: 'Sarah Chen',
          email: 'sarah.manager@acme.corp',
          role: 'MANAGER',
          department: 'Procurement',
        },
        {
          id: 'usr_john_ops',
          name: 'John Doe',
          email: 'john.operator@acme.corp',
          role: 'OPERATOR',
          department: 'Procurement',
        },
        {
          id: 'usr_alice_req',
          name: 'Alice Smith',
          email: 'alice.requester@acme.corp',
          role: 'REQUESTER',
          department: 'Engineering',
        },
      ],
    });
  }

  console.log('✅ All demo records cleared. Database is ready for live walkthrough!');
  await prisma.$disconnect();
}

clearDemoData().catch((err) => {
  console.error('Failed to clear demo data:', err);
  process.exit(1);
});
