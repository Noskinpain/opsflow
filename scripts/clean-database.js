const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  console.log('Cleaning database...');
  await prisma.notificationEvent.deleteMany({});
  await prisma.workflowExecution.deleteMany({});
  await prisma.activityEvent.deleteMany({});
  await prisma.attachment.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.approval.deleteMany({});
  await prisma.requestAiAnalysis.deleteMany({});
  await prisma.request.deleteMany({});
  await prisma.processedEvent.deleteMany({});
  const u = await prisma.user.count();
  console.log('Database successfully cleaned! Base team users intact:', u);
  await prisma.$disconnect();
}

clean().catch((err) => {
  console.error('Failed to clean database:', err);
  process.exit(1);
});
