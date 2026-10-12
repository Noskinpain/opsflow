import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { UserRole } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companyName, industry, currency, spendThreshold, teamMembers, customFlows } = body;

    if (!companyName || typeof companyName !== 'string') {
      return jsonResponse({ error: 'Company name is required' }, 400);
    }

    const createdUsers: any[] = [];

    if (Array.isArray(teamMembers) && teamMembers.length > 0) {
      for (const member of teamMembers) {
        if (!member.name || !member.department) continue;
        const email = member.email && member.email.includes('@')
          ? member.email.trim().toLowerCase()
          : `${member.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

        let validRole: UserRole = UserRole.REQUESTER;
        if (member.role === 'MANAGER' || member.role === 'ADMIN' || member.role === 'OPERATOR') {
          validRole = member.role as UserRole;
        }

        const user = await prisma.user.upsert({
          where: { email },
          update: {
            name: member.name.trim(),
            role: validRole,
            department: member.department.trim(),
          },
          create: {
            name: member.name.trim(),
            email,
            role: validRole,
            department: member.department.trim(),
          },
        });
        createdUsers.push(user);
      }
    }

    // Optional: Log to first request if one exists
    try {
      const firstRequest = await prisma.request.findFirst();
      const actorId = createdUsers[0]?.id;
      if (firstRequest && actorId) {
        await prisma.activityEvent.create({
          data: {
            request_id: firstRequest.id,
            event_type: 'SYSTEM_AUDIT',
            description: `Onboarding completed for ${companyName} (${industry || 'General Business'}) with ${createdUsers.length} team members.`,
            actor_id: actorId,
          },
        });
      }
    } catch {
      // Non-blocking log
    }

    return jsonResponse({
      companyName,
      industry: industry || 'Corporate Operations',
      currency: currency || '₦',
      spendThreshold: Number(spendThreshold) || 500000,
      customFlows: customFlows || [],
      users: createdUsers,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
