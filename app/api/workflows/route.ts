import { NextRequest } from 'next/server';
import { listWorkflows, getWorkflow } from '@/lib/workflows/registry';
import { jsonResponse, handleApiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');

    if (type) {
      const workflow = getWorkflow(type);
      return jsonResponse(workflow);
    }

    const workflows = listWorkflows();
    return jsonResponse(workflows);
  } catch (error) {
    return handleApiError(error);
  }
}
