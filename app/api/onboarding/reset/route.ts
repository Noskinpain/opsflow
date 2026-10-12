import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, jsonResponse } from '@/lib/api-response';

export async function POST() {
  try {
    // Clean out all transactional and dummy user data in cascade order
    await prisma.activityEvent.deleteMany();
    await prisma.notificationEvent.deleteMany();
    await prisma.requestAiAnalysis.deleteMany();
    await prisma.workflowExecution.deleteMany();
    await prisma.processedEvent.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.task.deleteMany();
    await prisma.request.deleteMany();
    await prisma.user.deleteMany();

    return jsonResponse({
      message: 'Workspace and all associated records have been cleared successfully.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
