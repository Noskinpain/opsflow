import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, RequestStatus, ApprovalStatus, ApprovalDecision } from '@prisma/client';
import { RequestService } from '@/lib/services/request-service';
import { WorkflowEngine } from '@/lib/workflows/engine';
import { getWorkflow, listWorkflows } from '@/lib/workflows/registry';
import { DepartmentRouter } from '@/lib/workflows/router';

export async function GET() {
  const results: Array<{ name: string; category: string; passed: boolean; note?: string }> = [];

  function record(category: string, name: string, condition: boolean, note?: string) {
    results.push({ category, name, passed: condition, note });
  }

  try {
    // 1. Workflow Definitions & Resolver
    const vendorWf = getWorkflow('vendor_onboarding');
    record('Workflow Resolver', 'Resolves vendor_onboarding workflow', vendorWf.id === 'vendor_onboarding');
    record('Workflow Resolver', 'Vendor workflow defines initial tasks', vendorWf.initialTasks.length >= 2);
    record('Workflow Resolver', 'Vendor workflow defines manager approval', vendorWf.approvalConfig.required === true);
    record('Workflow Resolver', 'Vendor workflow defines post-approval tasks', vendorWf.postApprovalTasks.length >= 1);

    const purchaseWf = getWorkflow('purchase_request');
    record('Workflow Resolver', 'Resolves purchase_request workflow targeting Procurement', purchaseWf.targetDepartment === 'Procurement');

    const itWf = getWorkflow('it_access');
    record('Workflow Resolver', 'Resolves it_access workflow targeting IT', itWf.targetDepartment === 'IT');

    record('Workflow Resolver', 'Exposes full registry of extensible workflows', listWorkflows().length >= 5);

    // 2. Deterministic Routing
    record('Routing Engine', 'Deterministic rule: vendor_onboarding -> Procurement', DepartmentRouter.getDepartment('vendor_onboarding') === 'Procurement');
    record('Routing Engine', 'Deterministic rule: it_access -> IT', DepartmentRouter.getDepartment('it_access') === 'IT');
    record('Routing Engine', 'Deterministic rule: contract_review -> Legal', DepartmentRouter.getDepartment('contract_review') === 'Legal');

    // 3. Test Actors
    const requester = await prisma.user.upsert({
      where: { email: 'alice.m6route@example.com' },
      update: {},
      create: {
        name: 'Alice Requester',
        email: 'alice.m6route@example.com',
        role: UserRole.REQUESTER,
        department: 'Operations',
      },
    });

    const operator = await prisma.user.upsert({
      where: { email: 'john.m6operator@example.com' },
      update: {},
      create: {
        name: 'John Procurement',
        email: 'john.m6operator@example.com',
        role: UserRole.OPERATOR,
        department: 'Procurement',
      },
    });

    const manager = await prisma.user.upsert({
      where: { email: 'ellen.m6manager@example.com' },
      update: {},
      create: {
        name: 'Ellen Ripley',
        email: 'ellen.m6manager@example.com',
        role: UserRole.MANAGER,
        department: 'Procurement',
      },
    });

    // 4. End-to-End Workflow Execution
    const req = await RequestService.createRequest({
      title: 'Onboard Acme Ltd Supplier',
      description: 'Please onboard Acme Ltd. CAC and tax documents are attached.',
      request_type: 'VENDOR_ONBOARDING',
      priority: 'HIGH',
      requester_id: requester.id,
      source: 'M6_API_VERIFY',
    });
    record('Workflow Engine', 'Request created in NEW status', req.status === RequestStatus.NEW);

    const init = await WorkflowEngine.initiateWorkflow(req.id, requester.id);
    record('Workflow Engine', 'DepartmentRouter routed request to Procurement', init.targetDepartment === 'Procurement');
    record('Workflow Engine', 'Operator assigned from Procurement department', init.operator !== null);
    record('Workflow Engine', 'Initial tasks automatically generated from workflow definition', (init as any).tasks?.length === 2);

    const initialTasks = (await RequestService.getRequestById(req.id)).tasks;
    await WorkflowEngine.completeTaskAndAdvance(initialTasks[0].id, operator.id);
    const step2Result = await WorkflowEngine.completeTaskAndAdvance(initialTasks[1].id, operator.id);
    record('Event-Driven Stage', 'Review tasks completed -> engine evaluated APPROVAL_REQUIRED', step2Result.stage === 'APPROVAL_REQUIRED');

    const reqApprovals = await RequestService.getRequestById(req.id);
    record('Event-Driven Stage', 'Request transitioned to AWAITING_APPROVAL', reqApprovals.status === RequestStatus.AWAITING_APPROVAL);

    const pendingApproval = reqApprovals.approvals.find((a) => a.status === ApprovalStatus.PENDING);
    record('Event-Driven Stage', 'Approval record generated for Manager', pendingApproval !== undefined);

    const approvalResult = await WorkflowEngine.decideApproval(
      pendingApproval!.id,
      ApprovalDecision.APPROVED,
      manager.id,
      'Approved'
    );
    record('Event-Driven Stage', 'Manager approval advances status to IN_PROGRESS', approvalResult.requestStatus === RequestStatus.IN_PROGRESS);
    record('Event-Driven Stage', 'Post-approval task (Create vendor record) automatically spawned', (approvalResult.spawnedTasks?.length ?? 0) === 1);

    const task3 = approvalResult.spawnedTasks![0];
    const finalResult = await WorkflowEngine.completeTaskAndAdvance(task3.id, operator.id);
    record('Workflow Completion', 'Final task completed -> engine transitioned request to COMPLETED', finalResult.stage === 'COMPLETED');

    const finalReq = await RequestService.getRequestById(req.id);
    record('Workflow Completion', 'Request final status is strictly COMPLETED', finalReq.status === RequestStatus.COMPLETED);

    // 5. Activity Event Sequence
    const events = await prisma.activityEvent.findMany({
      where: { request_id: req.id },
    });
    const types = events.map((e) => e.event_type);
    record('Audit Trail', 'Timeline includes WORKFLOW_CREATED', types.includes('WORKFLOW_CREATED'));
    record('Audit Trail', 'Timeline includes APPROVAL_REQUIRED', types.includes('APPROVAL_REQUIRED'));
    record('Audit Trail', 'Timeline includes APPROVAL_COMPLETED', types.includes('APPROVAL_COMPLETED'));
    record('Audit Trail', 'Timeline includes WORKFLOW_ADVANCED', types.includes('WORKFLOW_ADVANCED'));
    record('Audit Trail', 'Timeline includes WORKFLOW_COMPLETED', types.includes('WORKFLOW_COMPLETED'));

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return NextResponse.json({
      success: true,
      total: results.length,
      passedCount,
      failedCount,
      allPassed: failedCount === 0,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, results }, { status: 500 });
  }
}
