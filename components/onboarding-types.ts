export interface TeamMemberConfig {
  id?: string;
  name: string;
  email: string;
  role: 'MANAGER' | 'OPERATOR' | 'REQUESTER' | 'ADMIN';
  department: string;
}

export interface CompanyConfig {
  companyName: string;
  industry: string;
  currency: string;
  spendThreshold: number;
  customFlows: string[];
  samplePrompts: Array<{ label: string; text: string }>;
}

export const DEFAULT_COMPANY_CONFIG: CompanyConfig = {
  companyName: '',
  industry: '',
  currency: '₦',
  spendThreshold: 500000,
  customFlows: [],
  samplePrompts: [],
};
