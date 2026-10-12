import { prisma } from '../prisma.ts';
import { UserRole } from '@prisma/client';

export const ROUTING_RULES: Record<string, string> = {
  vendor_onboarding: 'Procurement',
  vendoronboarding: 'Procurement',
  purchase_request: 'Procurement',
  purchase_order: 'Procurement',
  purchaserequest: 'Procurement',
  it_access: 'IT',
  itaccess: 'IT',
  employee_request: 'HR',
  customer_request: 'Customer Support',
  contract_review: 'Legal',
  contractreview: 'Legal',
  compliance_audit: 'Compliance',
  complianceaudit: 'Compliance',
  facilities_request: 'Facilities',
  facilitiesrequest: 'Facilities',
  general_ops: 'Operations',
};

export class DepartmentRouter {
  /**
   * Deterministically resolves target department from requestType.
   * Milestone 6 Core Invariant: AI identifies requestType;
   * application deterministically decides department.
   */
  static getDepartment(requestType: string, suggestedDepartment?: string): string {
    const key = (requestType || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (ROUTING_RULES[key]) {
      return ROUTING_RULES[key];
    }

    if (suggestedDepartment) {
      const formatted =
        suggestedDepartment.charAt(0).toUpperCase() + suggestedDepartment.slice(1).toLowerCase();
      return formatted;
    }

    return 'Operations';
  }

  /**
   * Finds an eligible operator in the target department to assign work to.
   */
  static async findEligibleOperator(department: string) {
    // 1. Try to find an OPERATOR in this department
    const operator = await prisma.user.findFirst({
      where: {
        department: { equals: department, mode: 'insensitive' },
        role: UserRole.OPERATOR,
      },
    });

    if (operator) return operator;

    // 2. Try any user in this department
    const deptUser = await prisma.user.findFirst({
      where: {
        department: { equals: department, mode: 'insensitive' },
      },
    });

    if (deptUser) return deptUser;

    // 3. Fallback: find any operator in the system
    const anyOperator = await prisma.user.findFirst({
      where: { role: UserRole.OPERATOR },
    });

    if (anyOperator) return anyOperator;

    // 4. Fallback to any user
    return await prisma.user.findFirst();
  }

  /**
   * Finds an eligible manager for approvals.
   */
  static async findEligibleManager(department?: string) {
    if (department) {
      const deptManager = await prisma.user.findFirst({
        where: {
          department: { equals: department, mode: 'insensitive' },
          role: UserRole.MANAGER,
        },
      });
      if (deptManager) return deptManager;
    }

    // Fallback: any manager in system
    const anyManager = await prisma.user.findFirst({
      where: { role: UserRole.MANAGER },
    });
    if (anyManager) return anyManager;

    // Fallback to admin or first user
    const admin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
    });
    if (admin) return admin;

    return await prisma.user.findFirst();
  }
}
