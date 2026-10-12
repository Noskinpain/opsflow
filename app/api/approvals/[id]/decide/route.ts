import { NextRequest } from 'next/server';
import { POST as decisionHandler } from '../decision/route';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Backward compatibility alias for POST /api/approvals/:id/decide -> delegates to /decision
 */
export async function POST(req: NextRequest, context: RouteContext) {
  return decisionHandler(req, context);
}
