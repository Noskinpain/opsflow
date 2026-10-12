import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tables = [
  'users',
  'requests',
  'tasks',
  'approvals',
  'attachments',
  'activity_events',
  'request_ai_analysis',
  'notification_events',
  'processed_events',
  'workflow_executions',
];

async function main() {
  console.log('🔒 Enabling Row Level Security (RLS) on all public tables...');

  for (const table of tables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    console.log(`✓ Enabled RLS on table: "${table}"`);
  }

  console.log('\n✨ All tables are now secured with Row Level Security!');
  console.log('Public PostgREST / Data API access is now restricted by default.');
  console.log('Our Next.js backend (connecting as the "postgres" role via Prisma) retains full operational access.');
}

main()
  .catch((e) => {
    console.error('Error enabling RLS:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
