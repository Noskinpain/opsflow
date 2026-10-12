import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, jsonResponse } from '@/lib/api-response';
import { CreateUserSchema } from '@/lib/validation/schemas';

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
    return jsonResponse(users);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = CreateUserSchema.parse(body);

    const user = await prisma.user.create({
      data: validated,
    });

    return jsonResponse(user, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
