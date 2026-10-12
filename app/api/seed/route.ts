import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { RequestStatus, Priority, UserRole } from '@prisma/client';

export async function POST() {
  try {
    // 1. Create or ensure sample users exist
    const requester = await prisma.user.upsert({
      where: { email: 'alice.chen@example.com' },
      update: {},
      create: {
        name: 'Alice Chen',
        email: 'alice.chen@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const operator = await prisma.user.upsert({
      where: { email: 'bob.martinez@example.com' },
      update: {},
      create: {
        name: 'Bob Martinez',
        email: 'bob.martinez@example.com',
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    const manager = await prisma.user.upsert({
      where: { email: 'clara.oswald@example.com' },
      update: {},
      create: {
        name: 'Clara Oswald',
        email: 'clara.oswald@example.com',
        role: UserRole.MANAGER,
        department: 'Finance',
      },
    });

    // 2. Create sample vendor onboarding request
    const existingSample = await prisma.request.findFirst({
      where: { title: 'Acme Corp Vendor Onboarding' },
    });

    let sampleRequest = existingSample;

    if (!sampleRequest) {
      sampleRequest = await prisma.$transaction(async (tx) => {
        const req = await tx.request.create({
          data: {
            title: 'Acme Corp Vendor Onboarding',
            description:
              'Please onboard Acme Corp as a supplier. I have attached the required tax forms and security compliance audit.',
            request_type: 'VENDOR_ONBOARDING',
            priority: Priority.HIGH,
            status: RequestStatus.NEW,
            requester_id: requester.id,
            source: 'EMAIL',
          },
        });

        await tx.activityEvent.create({
          data: {
            request_id: req.id,
            actor_id: requester.id,
            event_type: 'REQUEST_CREATED',
            description: 'Request created: "Acme Corp Vendor Onboarding" via EMAIL',
            metadata: {
              title: req.title,
              request_type: req.request_type,
              priority: req.priority,
            },
          },
        });

        return req;
      });
    }

    return jsonResponse({
      users: { requester, operator, manager },
      sampleRequest,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
