import { prisma } from '../lib/prisma.ts';

async function setupCleanTeam() {
  console.log('Resetting and seeding team with standard valid UUIDs...');

  // Delete all users first
  await prisma.user.deleteMany({});

  const team = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Alice Smith',
      email: 'alice.smith@acme.corp',
      role: 'REQUESTER' as const,
      department: 'Engineering',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'John Doe',
      email: 'john.doe@acme.corp',
      role: 'OPERATOR' as const,
      department: 'Procurement',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Sarah Chen',
      email: 'sarah.chen@acme.corp',
      role: 'MANAGER' as const,
      department: 'Procurement',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Ellen Ripley',
      email: 'ellen.ripley@acme.corp',
      role: 'MANAGER' as const,
      department: 'Compliance',
    },
  ];

  await prisma.user.createMany({ data: team });

  const allUsers = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  console.log('Verified Team Directory (Valid UUIDs):');
  allUsers.forEach((u) => console.log(` - [${u.id}] ${u.name} (${u.role} • ${u.department})`));
  await prisma.$disconnect();
}

setupCleanTeam().catch(console.error);
