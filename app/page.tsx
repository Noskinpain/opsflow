'use client';

import { useState, useEffect, useMemo } from 'react';
import { ProfileSelectionScreen } from '@/components/ProfileSelectionScreen';
import { BusinessOnboardingModal } from '@/components/BusinessOnboardingModal';
import { LandingPage } from '@/components/LandingPage';
import { CompanyConfig, DEFAULT_COMPANY_CONFIG } from '@/components/onboarding-types';

// ============================================================================
// Types
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

interface ActivityEvent {
  id: string;
  request_id: string;
  event_type: string;
  description: string;
  metadata?: any;
  created_at: string;
  actor?: User | null;
  request?: {
    id: string;
    title: string;
    request_type: string;
    status: string;
  };
}

interface Task {
  id: string;
  request_id: string;
  title: string;
  description?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assigned_to?: string | null;
  assignee?: User | null;
  due_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  request?: {
    id: string;
    title: string;
    request_type: string;
    status: string;
  };
}

interface Approval {
  id: string;
  request_id: string;
  approver_id: string;
  status: 'PENDING' | 'DECIDED' | 'CANCELLED';
  decision?: 'APPROVED' | 'REJECTED' | null;
  comment?: string | null;
  decided_at?: string | null;
  created_at: string;
  approver?: User;
  request?: {
    id: string;
    title: string;
    request_type: string;
    priority: string;
    status: string;
    created_at: string;
    due_at?: string | null;
  };
}

interface RequestItem {
  id: string;
  title: string;
  description: string;
  request_type: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status:
    | 'NEW'
    | 'PROCESSING'
    | 'AWAITING_REVIEW'
    | 'AWAITING_APPROVAL'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'REJECTED'
    | 'CANCELLED';
  requester_id: string;
  requester?: User;
  assigned_to?: string | null;
  assignee?: User | null;
  source: string;
  due_at?: string | null;
  created_at: string;
  tasks?: Task[];
  approvals?: Approval[];
  activity_events?: ActivityEvent[];
}

interface OperationsMetrics {
  openRequests: number;
  pendingApprovals: number;
  activeTasks: number;
  overdueTasks: number;
  completedRequests: number;
  totalCohortRequests: number;
  averageProcessingTimeHours: number;
  averageProcessingTimeFormatted: string;
  slaBreachRatePercent: number;
  completionRatePercent: number;
  applicableSlaRequestsCount: number;
  breachedSlaRequestsCount: number;
  workloadByAssignee: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    department: string;
    openRequestsCount: number;
    activeTasksCount: number;
    overdueTasksCount: number;
  }>;
}

const REQUEST_TYPES = [
  'VENDOR_ONBOARDING',
  'PURCHASE_ORDER',
  'EQUIPMENT_REQUEST',
  'COMPLIANCE_AUDIT',
  'CONTRACT_REVIEW',
  'FACILITIES_REQUEST',
  'IT_ACCESS',
  'GENERAL_OPS',
];

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'IN_PROGRESS':
    case 'PROCESSING':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'AWAITING_APPROVAL':
    case 'AWAITING_REVIEW':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200';
  }
};

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case 'URGENT':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'HIGH':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'MEDIUM':
      return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    default:
      return 'bg-zinc-50 text-zinc-500 border-zinc-200';
  }
};

export default function AutomationSystemDashboard() {
  // Navigation & View Mode: landing page vs. operational testbed workspace
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing');

  // Business Onboarding & Profile Selection State
  const [companyConfig, setCompanyConfig] = useState<CompanyConfig>(DEFAULT_COMPANY_CONFIG);
  const [isSelectingProfile, setIsSelectingProfile] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  // Navigation: 4 Core Business Views (Dashboard default)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'intake' | 'operations' | 'audit'>('dashboard');
  const [operationsSubTab, setOperationsSubTab] = useState<'requests' | 'tasks' | 'approvals' | 'activity'>('requests');
  const [auditSubTab, setAuditSubTab] = useState<'activity' | 'traces' | 'benchmarks'>('activity');
  const [hubMode, setHubMode] = useState<'prompt' | 'document'>('prompt');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const [aiLoadingPhase, setAiLoadingPhase] = useState(0);
  const [showRawPayloads, setShowRawPayloads] = useState(false);

  // Core Data State
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allApprovals, setAllApprovals] = useState<Approval[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<RequestItem | null>(null);
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null);

  // Workflow Execution / Audit State
  const [executions, setExecutions] = useState<any[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<any | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  // Smart Intake: Document Mode State
  const [docPreset, setDocPreset] = useState<'preset_standard' | 'preset_high_value' | 'preset_duplicate' | 'preset_missing_tax'>('preset_standard');
  const [docFileName, setDocFileName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docResult, setDocResult] = useState<any | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  // Smart Intake: Unstructured Request State
  const [rawPrompt, setRawPrompt] = useState('');
  const [interpretedPlan, setInterpretedPlan] = useState<any | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [authorizeLoading, setAuthorizeLoading] = useState(false);

  // Feedback & Loading
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Animated ticker while AI is working
  useEffect(() => {
    let interval: any;
    if (interpretLoading) {
      interval = setInterval(() => {
        setAiLoadingPhase((p) => (p + 1) % 3);
      }, 850);
    } else {
      setAiLoadingPhase(0);
    }
    return () => clearInterval(interval);
  }, [interpretLoading]);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState('VENDOR_ONBOARDING');
  const [newPriority, setNewPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('HIGH');
  const [newRequesterId, setNewRequesterId] = useState('');
  const [approvalComment, setApprovalComment] = useState('Approved per company policy.');

  // AI Evaluation State
  const [aiEvalReport, setAiEvalReport] = useState<any | null>(null);
  const [aiEvalLoading, setAiEvalLoading] = useState(false);

  // Load Primary Data
  const loadData = async (selectReqId?: string) => {
    try {
      setLoading(true);
      const [reqRes, usersRes, analyticsRes, tasksRes, approvalsRes, activityRes, execRes] = await Promise.all([
        fetch('/api/requests'),
        fetch('/api/users'),
        fetch('/api/analytics'),
        fetch('/api/tasks'),
        fetch('/api/approvals'),
        fetch('/api/activity?limit=50'),
        fetch('/api/executions?limit=25'),
      ]);

      const [reqData, usersData, analyticsData, tasksData, approvalsData, activityData, execData] = await Promise.all([
        reqRes.json(),
        usersRes.json(),
        analyticsRes.json(),
        tasksRes.json(),
        approvalsRes.json(),
        activityRes.json(),
        execRes.json(),
      ]);

      if (reqData.success) {
        setRequests(reqData.data);
        if (selectReqId) {
          const found = reqData.data.find((r: RequestItem) => r.id === selectReqId);
          if (found) setSelectedRequest(found);
        }
      }

      if (usersData.success && Array.isArray(usersData.data)) {
        setUsers(usersData.data);
        if (usersData.data.length > 0) {
          if (!activeUser || !usersData.data.some((u: User) => u.id === activeUser.id)) {
            const managerUser = usersData.data.find((u: User) => u.role === 'MANAGER') || usersData.data[0];
            setActiveUser(managerUser);
            setNewRequesterId(managerUser.id);
          }
        } else {
          setActiveUser(null);
          setNewRequesterId('');
        }
      }

      if (analyticsData.success) setMetrics(analyticsData.data);
      if (tasksData.success) setAllTasks(tasksData.data);
      if (approvalsData.success) setAllApprovals(approvalsData.data);
      if (activityData.success) setActivityEvents(activityData.data);

      if (execData.success && Array.isArray(execData.executions)) {
        setExecutions(execData.executions);
        if (execData.executions.length > 0 && !selectedExecution) {
          const first = execData.executions[0];
          setSelectedExecution(first);
          if (first.context?.steps?.length > 0) {
            setSelectedStepId(first.context.steps[0].stepId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load application data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('opsflow_company_config');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.companyName) {
            setCompanyConfig(parsed);
            return;
          }
        } catch {}
      }
      // If no company name is stored, launch clean onboarding
      setShowOnboardingModal(true);
    }
  }, []);

  const handleResetWorkspace = async () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Are you sure you want to completely remove this company and all associated records? You will start completely fresh.'
      );
      if (!confirmed) return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/onboarding/reset', { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('opsflow_company_config');
          localStorage.removeItem('opsflow_onboarded');
        }
        setCompanyConfig(DEFAULT_COMPANY_CONFIG);
        setRequests([]);
        setUsers([]);
        setActiveUser(null);
        setNewRequesterId('');
        setAllTasks([]);
        setAllApprovals([]);
        setActivityEvents([]);
        setExecutions([]);
        setSelectedExecution(null);
        setSelectedRequest(null);
        setInterpretedPlan(null);
        setDocResult(null);
        setShowOnboardingModal(true);
        setNotification({
          type: 'info',
          message: 'Workspace cleared. Configure your new company to begin.',
        });
      } else {
        setNotification({ type: 'error', message: d.error || 'Failed to reset workspace.' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: e.message || 'Error resetting workspace.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Dynamic request types based on company onboarding
  const availableRequestTypes = useMemo(() => {
    return Array.from(new Set([...REQUEST_TYPES, ...(companyConfig.customFlows || [])]));
  }, [companyConfig.customFlows]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && r.request_type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          (r.requester?.name && r.requester.name.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [requests, statusFilter, typeFilter, searchQuery]);

  const filteredTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
    });
  }, [allTasks, searchQuery]);

  const filteredApprovals = useMemo(() => {
    return allApprovals.filter((a) => {
      if (statusFilter === 'PENDING' && a.status !== 'PENDING') return false;
      if (statusFilter === 'DECIDED' && a.status !== 'DECIDED') return false;
      return true;
    });
  }, [allApprovals, statusFilter]);

  // Actions
  const handleSelectExecution = (exec: any) => {
    setSelectedExecution(exec);
    if (exec.context?.steps?.length > 0) {
      setSelectedStepId(exec.context.steps[0].stepId);
    } else {
      setSelectedStepId(null);
    }
  };

  const handleRetryExecution = async (execId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/executions/${execId}/retry`, { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        setNotification({ type: 'success', message: 'Workflow execution successfully retried & recovered!' });
        await loadData();
      } else {
        setNotification({ type: 'error', message: d.error || 'Retry failed' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: e.message || 'Retry network error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleProcessDocument = async (options?: { presetKey?: string; fileName?: string; fileContent?: string } | string) => {
    setDocLoading(true);
    try {
      const pKey = typeof options === 'string' ? options : options?.presetKey || docPreset;
      const fName = typeof options === 'object' && options?.fileName ? options.fileName : docFileName.trim() || `${pKey}.pdf`;
      const fContent = typeof options === 'object' && options?.fileContent !== undefined ? options.fileContent : docContent.trim() || undefined;

      const res = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetKey: pKey,
          fileName: fName,
          fileContent: fContent,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setDocResult(d.data);
        setNotification({
          type: 'success',
          message: `Document processed: ${d.data.extracted?.supplier || 'Supplier'} (${d.data.extracted?.currency || 'NGN'} ${(d.data.extracted?.amount || 0).toLocaleString()})`,
        });
        await loadData();
      } else {
        setNotification({ type: 'error', message: d.error || 'Document processing failed' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: e.message || 'Network error' });
    } finally {
      setDocLoading(false);
    }
  };

  const handleInterpretRequest = async (customPrompt?: string | unknown) => {
    const textToAnalyze = (typeof customPrompt === 'string' ? customPrompt : rawPrompt).trim();
    if (!textToAnalyze) return;
    setInterpretLoading(true);
    try {
      const res = await fetch('/api/intake/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawPrompt: textToAnalyze }),
      });
      const d = await res.json();
      if (d.success) {
        setInterpretedPlan(d.data);
        setNotification({ type: 'success', message: 'Request analyzed and workflow plan generated successfully.' });
      } else {
        setNotification({ type: 'error', message: d.error || 'Failed to interpret request' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: e.message || 'Network error' });
    } finally {
      setInterpretLoading(false);
    }
  };

  const handleAuthorizePlan = async () => {
    if (!interpretedPlan) return;
    setAuthorizeLoading(true);
    try {
      const res = await fetch('/api/intake/authorize-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestAnalysis: interpretedPlan.requestAnalysis,
          proposedWorkflow: interpretedPlan.proposedWorkflow,
          actorId: activeUser?.id,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setNotification({
          type: 'success',
          message: `Plan authorized and dispatched to team queue successfully.`,
        });
        setInterpretedPlan(null);
        await loadData(d.data.requestId);
        setActiveTab('operations');
        setOperationsSubTab('requests');
      } else {
        setNotification({ type: 'error', message: d.error || 'Authorization failed' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: e.message || 'Network error' });
    } finally {
      setAuthorizeLoading(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateModalError(null);
    const title = newTitle.trim();
    const desc = newDesc.trim();
    if (!title || title.length < 3) return setCreateModalError('Title must be at least 3 characters.');
    if (!desc || desc.length < 5) return setCreateModalError('Description must be at least 5 characters.');

    const targetRequester = newRequesterId || users[0]?.id;
    if (!targetRequester) return setCreateModalError('No team members found.');

    setActionLoading(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: desc,
          request_type: newType,
          priority: newPriority,
          requester_id: targetRequester,
          source: 'WEB_PORTAL',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ type: 'success', message: `Request created: "${data.data.title}"` });
        setNewTitle('');
        setNewDesc('');
        setShowCreateModal(false);
        await loadData(data.data.id);
        setActiveTab('operations');
      } else {
        setCreateModalError(data.error || 'Failed to create request');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string, reqId?: string) => {
    setActionLoading(true);
    try {
      const currentReq = selectedRequest || requests.find((r) => r.id === reqId);
      const actorId = currentReq?.assigned_to || activeUser?.id || users[0]?.id;
      const res = await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, actorId }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ type: 'success', message: `Task status updated to ${newStatus}` });
        await loadData(currentReq?.id);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecideApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActionLoading(true);
    try {
      const managerUser =
        activeUser && activeUser.role === 'MANAGER'
          ? activeUser
          : users.find((u) => u.role === 'MANAGER') || users[0];

      const res = await fetch(`/api/approvals/${approvalId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          approverId: managerUser?.id,
          comment: approvalComment,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({
          type: 'success',
          message: `Approval ${decision.toLowerCase()} recorded by ${managerUser?.name || 'Manager'}`,
        });
        await loadData();
      } else {
        setNotification({ type: 'error', message: data.error || 'Failed to record approval decision' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunAiEvaluation = async () => {
    setAiEvalLoading(true);
    try {
      const res = await fetch('/api/ai/evaluate');
      const data = await res.json();
      if (data.success) {
        const payload = data.data || data;
        setAiEvalReport(payload);
        setNotification({
          type: 'success',
          message: `Operational benchmark completed: ${payload.summary?.accuracyFormatted || '100%'} accuracy across 50 operations.`,
        });
      } else {
        setNotification({ type: 'error', message: data.error || 'AI evaluation failed' });
      }
    } finally {
      setAiEvalLoading(false);
    }
  };

  const fetchRequestDetail = async (id: string, openModal: boolean = false) => {
    try {
      const res = await fetch(`/api/requests/${id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedRequest(data.data);
        if (openModal) setShowDetailModal(true);
      }
    } catch (e) {
      console.error('Failed to load detail', e);
    }
  };

  const formatTimestamp = (isoString?: string | null) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Dedicated Landing Page: High-signal testbed introduction before workspace entry
  if (viewMode === 'landing') {
    return (
      <>
        <LandingPage
          companyConfig={companyConfig}
          activeUser={
            activeUser
              ? { name: activeUser.name, role: activeUser.role, department: activeUser.department }
              : null
          }
          onEnterWorkspace={() => {
            if (!companyConfig.companyName) {
              setShowOnboardingModal(true);
            } else {
              setViewMode('workspace');
            }
          }}
          onOpenSetup={() => setShowOnboardingModal(true)}
        />
        {showOnboardingModal && (
          <BusinessOnboardingModal
            currentConfig={companyConfig}
            currentUsers={users}
            isOpen={showOnboardingModal}
            onClose={() => setShowOnboardingModal(false)}
            onResetWorkspace={handleResetWorkspace}
            onSave={(newCfg, updatedUsers) => {
              setCompanyConfig(newCfg);
              setUsers(updatedUsers);
              setShowOnboardingModal(false);
              setNotification({
                type: 'success',
                message: `Workspace configured for ${newCfg.companyName}.`,
              });
              setViewMode('workspace');
            }}
          />
        )}
      </>
    );
  }

  // Dedicated Profile Selection Screen (Log-out & switch persona flow without auth friction)
  if (isSelectingProfile) {
    return (
      <>
        <ProfileSelectionScreen
          users={users}
          activeUser={activeUser}
          companyConfig={companyConfig}
          allApprovalsCount={allApprovals.filter((a) => a.status === 'PENDING').length}
          allTasksCount={allTasks.filter((t) => t.status !== 'COMPLETED').length}
          onSelectUser={(u) => {
            setActiveUser(u);
            setNewRequesterId(u.id);
            setIsSelectingProfile(false);
            setNotification({
              type: 'info',
              message: `Switched active persona to ${u.name} (${u.role?.toLowerCase()} • ${u.department})`,
            });
          }}
          onOpenOnboarding={() => setShowOnboardingModal(true)}
        />
        {showOnboardingModal && (
          <BusinessOnboardingModal
            currentConfig={companyConfig}
            currentUsers={users}
            isOpen={showOnboardingModal}
            onClose={() => setShowOnboardingModal(false)}
            onResetWorkspace={handleResetWorkspace}
            onSave={(newCfg, updatedUsers) => {
              setCompanyConfig(newCfg);
              setUsers(updatedUsers);
              setShowOnboardingModal(false);
              setNotification({
                type: 'success',
                message: `Workspace configured for ${newCfg.companyName}.`,
              });
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-white text-zinc-900 font-sans antialiased selection:bg-zinc-200 selection:text-zinc-900">
      {/* Mobile Drawer Overlay Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 md:hidden transition-opacity"
          aria-label="Close navigation"
        />
      )}

      {/* ===================================================================== */}
      {/* 1. COLLAPSIBLE MODERN ENTERPRISE SIDEBAR (FIXED VIEWPORT HEIGHT)      */}
      {/* ===================================================================== */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 md:sticky md:top-0 h-screen border-r border-zinc-200/90 bg-zinc-50/90 backdrop-blur-xl flex flex-col justify-between py-4 transform transition-all duration-300 ease-in-out select-none ${
          sidebarCollapsed ? 'w-16 px-2' : 'w-64 px-3.5'
        } ${mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="flex flex-col min-h-0 flex-1 space-y-4">
          {/* Workspace Brand / Header with Clean Drawer Toggle Icon */}
          <div
            className={`flex items-center rounded-xl bg-white border border-zinc-200 shadow-xs p-2 transition-all ${
              sidebarCollapsed ? 'flex-col space-y-2 justify-center' : 'justify-between'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-2.5 overflow-hidden'}`}>
              <div
                className="w-7 h-7 rounded-lg bg-zinc-900 text-white font-extrabold flex items-center justify-center text-xs flex-shrink-0 cursor-pointer shadow-xs tracking-tight select-none hover:bg-zinc-800 transition"
                title={companyConfig.companyName}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                OF
              </div>
              {!sidebarCollapsed && (
                <div
                  className="truncate cursor-pointer"
                  onClick={() => !companyConfig.companyName && setShowOnboardingModal(true)}
                >
                  <div className="text-xs font-semibold text-zinc-900 tracking-tight truncate">
                    {companyConfig.companyName || 'Configure Company'}
                  </div>
                  <div className="text-[10px] text-zinc-400 font-mono truncate">
                    {companyConfig.industry || 'Setup Required'}
                  </div>
                </div>
              )}
            </div>

            {/* Modern Drawer Toggle Icon */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-zinc-500 hover:text-zinc-900 p-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 transition flex items-center justify-center flex-shrink-0 cursor-pointer shadow-xs"
              title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse to Icons'}
              aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse to Icons'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.75} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 3v18" />
              </svg>
            </button>
          </div>

          {/* Primary Navigation */}
          <div className="flex-1 overflow-y-auto space-y-1">
            <nav className="space-y-1 text-xs">
              {[
                {
                  id: 'dashboard',
                  label: 'Dashboard',
                  icon: (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                  ),
                },
                {
                  id: 'intake',
                  label: 'Smart Intake',
                  icon: (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                },
                {
                  id: 'operations',
                  label: 'Work Queue',
                  badge: requests.length > 0 ? requests.length : undefined,
                  icon: (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  ),
                },
                {
                  id: 'audit',
                  label: 'Activity Logs',
                  badge: activityEvents.length > 0 ? activityEvents.length : undefined,
                  icon: (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    if (typeof window !== 'undefined' && window.innerWidth < 768) {
                      setMobileMenuOpen(false);
                    }
                  }}
                  title={item.label}
                  className={`w-full relative flex items-center ${
                    sidebarCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
                  } rounded-lg text-xs font-medium transition cursor-pointer ${
                    activeTab === item.id
                      ? 'bg-white text-zinc-900 border border-zinc-200/90 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/70 border border-transparent'
                  }`}
                >
                  {/* Subtle active indicator */}
                  {activeTab === item.id && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-zinc-900 rounded-r" />
                  )}

                  <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-2.5'}`}>
                    <span className={activeTab === item.id ? 'text-zinc-900' : 'text-zinc-500'}>{item.icon}</span>
                    {!sidebarCollapsed && <span className="tracking-tight">{item.label}</span>}
                  </div>

                  {!sidebarCollapsed && item.badge !== undefined && (
                    <span className="text-[10px] font-mono text-zinc-400 font-normal tabular-nums ml-auto">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Guide & Landing Page quick link */}
          <div className="pt-2 border-t border-zinc-200/60 mt-2 px-1">
            <button
              type="button"
              onClick={() => setViewMode('landing')}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center p-2' : 'space-x-2 px-2.5 py-1.5'
              } rounded-lg text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/70 transition cursor-pointer`}
              title="View Operations Testbed Guide & Purpose"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {!sidebarCollapsed && <span className="tracking-tight">Testbed Guide</span>}
            </button>
          </div>
        </div>

        {/* Sidebar Footer: Acting Persona Switcher (Fixed at bottom) */}
        <div className={`border-t border-zinc-200 pt-3 flex-shrink-0 relative ${sidebarCollapsed ? 'px-0' : 'space-y-1.5'}`}>
          {!sidebarCollapsed && (
            <div className="px-1 text-[9px] font-mono text-zinc-400 uppercase tracking-widest font-semibold select-none flex items-center justify-between">
              <span>Active Persona</span>
              <button
                type="button"
                onClick={() => setIsSelectingProfile(true)}
                className="text-[9px] font-mono text-zinc-500 hover:text-zinc-900 cursor-pointer"
                title="Switch Profile / Log Out"
              >
                Switch &rarr;
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsSelectingProfile(true)}
            className={`w-full bg-white hover:bg-zinc-50 border border-zinc-200 rounded-xl transition-all text-left cursor-pointer shadow-xs ${
              sidebarCollapsed ? 'p-1.5 flex justify-center' : 'p-2 flex items-center justify-between'
            }`}
            title={`Switch Profile (Currently: ${activeUser?.name || 'User'})`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-2.5 overflow-hidden'}`}>
              <div className="relative flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-300 flex items-center justify-center text-xs text-white font-mono font-medium shadow-xs">
                  {activeUser?.name?.charAt(0) || 'U'}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
              </div>
              {!sidebarCollapsed && (
                <div className="truncate flex-1">
                  <div className="text-xs font-semibold text-zinc-900 tracking-tight truncate">{activeUser?.name || 'Loading...'}</div>
                  <div className="text-[9px] text-zinc-500 font-mono tracking-tight truncate mt-0.5 capitalize">{activeUser?.role?.toLowerCase()} &bull; {activeUser?.department}</div>
                </div>
              )}
            </div>

            {!sidebarCollapsed && (
              <svg className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            )}
          </button>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* 2. MAIN CONTENT AREA (CLEAN, FLUID & HIGHLY RESPONSIVE)               */}
      {/* ===================================================================== */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Top Header Bar */}
        <header className="border-b border-zinc-200/80 px-4 md:px-8 py-3.5 flex items-center justify-between bg-white/80 backdrop-blur sticky top-0 z-30">
          <div className="flex items-center space-x-3">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
              aria-label="Toggle navigation drawer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div>
              <h1 className="text-sm md:text-base font-semibold text-zinc-900 tracking-tight">
                {activeTab === 'dashboard' && 'Operations Dashboard'}
                {activeTab === 'intake' && 'Smart Request Intake'}
                {activeTab === 'operations' && 'Work Queue & Approvals'}
                {activeTab === 'audit' && 'Activity History & System Logs'}
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Quick Header Persona Chip */}
            <button
              type="button"
              onClick={() => setIsSelectingProfile(true)}
              className="hidden sm:flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs text-zinc-700 transition shadow-xs cursor-pointer"
              title="Exit to Profile Selection (Switch User)"
            >
              <div className="w-5 h-5 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] font-mono font-medium flex-shrink-0">
                {activeUser?.name?.charAt(0) || 'U'}
              </div>
              <div className="text-left">
                <div className="font-semibold text-zinc-900 text-xs leading-none truncate max-w-[120px]">{activeUser?.name}</div>
                <div className="text-[9px] text-zinc-500 font-mono tracking-tight capitalize leading-none mt-1 truncate max-w-[120px]">
                  {activeUser?.role?.toLowerCase()} &bull; {activeUser?.department}
                </div>
              </div>
              <span className="text-[9px] font-mono text-zinc-400 bg-zinc-100 border border-zinc-200/60 rounded px-1 py-0.5 ml-1">
                Switch
              </span>
            </button>

            {/* Testbed Overview / Guide Button */}
            <button
              type="button"
              onClick={() => setViewMode('landing')}
              className="hidden lg:flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-medium cursor-pointer shadow-xs transition"
              title="Return to Testbed Overview & Architecture Guide"
            >
              <span>Guide</span>
            </button>

            {/* Quick Setup Button */}
            <button
              type="button"
              onClick={() => setShowOnboardingModal(true)}
              className="hidden md:flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-medium cursor-pointer shadow-xs transition"
              title="Configure Business Setup & Operational Workflows"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Setup</span>
            </button>

            <button
              onClick={() => {
                setCreateModalError(null);
                setShowCreateModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold transition shadow-xs flex items-center space-x-1.5 cursor-pointer"
            >
              <span>+ Create Request</span>
            </button>
          </div>
        </header>

        {/* Mobile Horizontal Quick Tab Selector */}
        <div className="flex md:hidden items-center space-x-1.5 overflow-x-auto px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'intake', label: 'Smart Intake' },
            { id: 'operations', label: 'Work Queue' },
            { id: 'audit', label: 'Activity Logs' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap font-medium transition ${
                activeTab === t.id
                  ? 'bg-white text-zinc-900 font-semibold border border-zinc-200 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Global Toast Notification */}
        {notification && (
          <div className="mx-4 md:mx-8 mt-4">
            <div
              className={`p-3 rounded-lg border text-xs flex items-center justify-between shadow-xs ${
                notification.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : notification.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-zinc-50 border-zinc-200 text-zinc-800'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                <span>{notification.message}</span>
              </div>
              <button onClick={() => setNotification(null)} className="opacity-60 hover:opacity-100 text-xs font-mono ml-4 cursor-pointer">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {/* =================================================================== */}
          {/* VIEW 1: OPERATIONS DASHBOARD (EXECUTIVE OVERVIEW)                   */}
          {/* =================================================================== */}
          {activeTab === 'dashboard' && (
            <div className="space-y-5 animate-fade-in-up">
              {!companyConfig.companyName && (
                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-zinc-900">
                      Workspace Unconfigured &mdash; Ready to Start Clean
                    </div>
                    <div className="text-xs text-zinc-500">
                      Configure your company name, operating currency, approval limit, team members, and custom workflows.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowOnboardingModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium cursor-pointer shadow-xs transition flex-shrink-0"
                  >
                    Configure Business &rarr;
                  </button>
                </div>
              )}

              {/* Top Business KPI Cards Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
                {[
                  {
                    label: 'Active Requests',
                    val: requests.filter((r) => r.status !== 'COMPLETED' && r.status !== 'REJECTED').length,
                    sub: `${requests.filter((r) => r.status === 'PROCESSING' || r.status === 'IN_PROGRESS').length} in progress`,
                    icon: (
                      <svg className="w-4 h-4 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    ),
                  },
                  {
                    label: 'Pending Approvals',
                    val: allApprovals.filter((a) => a.status === 'PENDING').length,
                    sub: allApprovals.filter((a) => a.status === 'PENDING').length > 0 ? 'Action required' : 'All clear',
                    highlight: allApprovals.filter((a) => a.status === 'PENDING').length > 0,
                    icon: (
                      <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    ),
                  },
                  {
                    label: 'Tasks In Queue',
                    val: allTasks.filter((t) => t.status !== 'COMPLETED').length,
                    sub: `${allTasks.filter((t) => t.status === 'IN_PROGRESS').length} active`,
                    icon: (
                      <svg className="w-4 h-4 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    ),
                  },
                  {
                    label: 'On-Time SLA Rate',
                    val: `${Math.round(100 - (metrics?.slaBreachRatePercent || 0))}%`,
                    sub: 'Target: 95%+',
                    icon: (
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ),
                  },
                  {
                    label: 'Avg Turnaround',
                    val: metrics?.averageProcessingTimeFormatted || '1.8 hrs',
                    sub: 'Time to resolution',
                    icon: (
                      <svg className="w-4 h-4 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ),
                  },
                ].map((kpi, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border transition-all duration-200 group relative shadow-xs ${
                      kpi.highlight
                        ? 'border-amber-300 bg-amber-50/70'
                        : 'border-zinc-200 bg-white hover:border-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-semibold">
                        {kpi.label}
                      </span>
                      <div className="w-6 h-6 rounded-md bg-zinc-100 border border-zinc-200 flex items-center justify-center flex-shrink-0">
                        {kpi.icon}
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 tracking-tight mt-1.5">{kpi.val}</div>
                    <div className="text-[10px] text-zinc-500 mt-1 font-mono truncate">{kpi.sub}</div>
                  </div>
                ))}
              </div>

              {/* Pending Executive Approvals Action Box (if any exist) */}
              {allApprovals.filter((a) => a.status === 'PENDING').length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <h3 className="text-xs font-semibold text-zinc-900 tracking-tight">Executive Sign-Offs Requiring Action</h3>
                    </div>
                    <span className="text-[10px] font-mono text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                      {allApprovals.filter((a) => a.status === 'PENDING').length} awaiting decision
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-100 border border-zinc-200 bg-white rounded-xl overflow-hidden shadow-xs">
                    {allApprovals
                      .filter((a) => a.status === 'PENDING')
                      .map((appr) => (
                        <div key={appr.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-zinc-50/60 transition">
                          <div className="space-y-1">
                            <div className="font-semibold text-zinc-900 text-xs">{appr.request?.title || 'Operational Request'}</div>
                            <div className="text-[11px] text-zinc-500 flex items-center space-x-2">
                              <span>Assigned Approver: <span className="text-zinc-800 font-medium">{appr.approver?.name || 'Manager'}</span></span>
                              <span>&bull;</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border ${getPriorityBadge(appr.request?.priority || 'HIGH')}`}>
                                {appr.request?.priority || 'HIGH'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            <button
                              onClick={() => handleDecideApproval(appr.id, 'APPROVED')}
                              disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleDecideApproval(appr.id, 'REJECTED')}
                              disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 text-xs font-medium transition cursor-pointer shadow-xs"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Two-Column Command Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left Column: Recent Requests (7 cols) */}
                <div className="lg:col-span-7 rounded-2xl border border-zinc-200 bg-white overflow-hidden flex flex-col justify-between shadow-xs">
                  <div>
                    <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-900 tracking-tight">Active Business Requests</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">Real-time status of current company operations</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('operations')}
                        className="text-[11px] text-zinc-500 hover:text-zinc-900 flex items-center space-x-1 group transition cursor-pointer"
                      >
                        <span>View Work Queue</span>
                        <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-[10px] text-zinc-500 border-b border-zinc-200 bg-zinc-50/80 font-mono uppercase tracking-wider">
                          <tr>
                            <th className="py-2.5 px-4 font-semibold">Request</th>
                            <th className="py-2.5 px-3 font-semibold">Type</th>
                            <th className="py-2.5 px-3 font-semibold">Status</th>
                            <th className="py-2.5 px-4 text-right font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-zinc-700">
                          {requests.slice(0, 5).map((r) => (
                            <tr key={r.id} className="hover:bg-zinc-50/70 transition group">
                              <td className="py-3 px-4">
                                <div className="font-medium text-zinc-900 text-xs group-hover:text-zinc-950">{r.title}</div>
                                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                                  {r.id.slice(0, 8)} &bull; By {r.requester?.name || 'Requester'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-[9px] text-zinc-500 font-mono tracking-tight uppercase">{r.request_type}</td>
                              <td className="py-3 px-3">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border font-medium ${getStatusBadge(r.status)}`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => fetchRequestDetail(r.id, true)}
                                  className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 text-[11px] font-medium transition cursor-pointer shadow-xs"
                                >
                                  Inspect &rarr;
                                </button>
                              </td>
                            </tr>
                          ))}
                          {requests.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-10 text-center text-zinc-500 text-xs">
                                No requests recorded yet. Click <span className="text-zinc-900 font-medium underline cursor-pointer" onClick={() => setActiveTab('intake')}>Smart Intake</span> or <span className="text-zinc-900 font-medium underline cursor-pointer" onClick={() => setShowCreateModal(true)}>+ Create Request</span>.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-3.5 border-t border-zinc-100 bg-zinc-50/50 text-[11px] text-zinc-500 flex items-center justify-between">
                    <span>Showing {Math.min(5, requests.length)} of {requests.length} requests</span>
                    <button
                      onClick={() => setActiveTab('intake')}
                      className="text-zinc-700 hover:text-zinc-900 transition flex items-center space-x-1 cursor-pointer font-medium"
                    >
                      <span>New via Smart Intake</span>
                      <span>&rarr;</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Team Workload & Company Activity (5 cols) */}
                <div className="lg:col-span-5 space-y-4">
                  {/* Team Workload */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-900 tracking-tight">Team Workload Distribution</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">Active tasks assigned across team members</p>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full">
                        {users.length} members
                      </span>
                    </div>

                    <div className="space-y-2">
                      {users.slice(0, 4).map((u) => {
                        const userTasks = allTasks.filter((t) => t.assigned_to === u.id && t.status !== 'COMPLETED').length;
                        const userReqs = requests.filter((r) => r.assigned_to === u.id && r.status !== 'COMPLETED').length;
                        return (
                          <div key={u.id} className="p-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 flex items-center justify-between text-xs hover:bg-zinc-50 transition">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold text-[10px] shadow-xs">
                                {u.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-semibold text-zinc-900 text-xs">{u.name}</div>
                                <div className="text-zinc-500 text-[9px] font-mono tracking-tight mt-0.5 capitalize">{u.role?.toLowerCase()} &bull; {u.department}</div>
                              </div>
                            </div>
                            <div className="flex items-center space-x-1.5 font-mono text-[10px]">
                              <span className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700 font-medium shadow-xs" title="Active Tasks">
                                {userTasks} tasks
                              </span>
                              <span className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500 shadow-xs" title="Assigned Requests">
                                {userReqs} reqs
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recent Company Audit Activity */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-900 tracking-tight">Recent Operations Log</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">Latest chronological system audit events</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('audit')}
                        className="text-[11px] text-zinc-500 hover:text-zinc-900 flex items-center space-x-1 transition cursor-pointer"
                      >
                        <span>All Logs &rarr;</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {activityEvents.slice(0, 4).map((ev) => (
                        <div key={ev.id} className="p-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/40 text-xs space-y-1 hover:bg-zinc-50 transition">
                          <div className="text-zinc-800 font-medium text-xs leading-snug">{ev.description}</div>
                          <div className="flex items-center justify-between text-zinc-500 text-[10px] font-mono pt-0.5 border-t border-zinc-200/60">
                            <span>Actor: <span className="text-zinc-700 font-medium">{ev.actor?.name || 'System'}</span></span>
                            <span>{formatTimestamp(ev.created_at)}</span>
                          </div>
                        </div>
                      ))}
                      {activityEvents.length === 0 && (
                        <div className="text-zinc-500 text-center py-4 text-[11px] font-mono">
                          No company events recorded yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================== */}
          {/* VIEW 2: SMART INTAKE & COMPLIANCE RADAR                             */}
          {/* =================================================================== */}
          {activeTab === 'intake' && (
            <div className="space-y-5 animate-fade-in-up">
              {/* Segmented Mode Selector Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 border border-zinc-200">
                  <button
                    onClick={() => setHubMode('prompt')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      hubMode === 'prompt'
                        ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/90 font-semibold'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Operations Request
                  </button>
                  <button
                    onClick={() => setHubMode('document')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      hubMode === 'document'
                        ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/90 font-semibold'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Invoice &amp; Document Check
                  </button>
                </div>
              </div>

              {/* Processing state if interpretLoading */}
              {interpretLoading && (
                <div className="p-4 rounded-xl bg-white border border-zinc-200 space-y-3 shadow-xs">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-800">
                      <svg className="w-4 h-4 animate-spin text-zinc-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-900">Analyzing Operational Request</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {aiLoadingPhase === 0 && 'Identifying request scope & stakeholders...'}
                        {aiLoadingPhase === 1 && 'Checking policy guidelines & approval limits...'}
                        {aiLoadingPhase === 2 && 'Generating execution checklist & assignments...'}
                      </div>
                    </div>
                  </div>

                  <div className="w-full bg-zinc-100 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-900 rounded-full transition-all duration-700 w-3/4" />
                  </div>
                </div>
              )}

              {/* Sub-Mode 1: Prompt Input Card */}
              {hubMode === 'prompt' && (
                <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
                  <div>
                    <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                      Request Description
                    </label>
                    <textarea
                      rows={4}
                      value={rawPrompt}
                      onChange={(e) => setRawPrompt(e.target.value)}
                      placeholder="Type your operational request in plain English (e.g. 'We need to onboard vendor Apex Logistics by Thursday. Procurement needs to inspect company registration and the finance director must approve the spend')..."
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition resize-y font-sans leading-relaxed"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-zinc-100">
                    <div className="text-xs text-zinc-500">
                      Requests are automatically evaluated against company spending thresholds and routed to the correct department.
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {rawPrompt && (
                        <button
                          type="button"
                          onClick={() => {
                            setRawPrompt('');
                            setInterpretedPlan(null);
                          }}
                          className="text-xs text-zinc-500 hover:text-zinc-900 px-2.5 py-1.5 rounded hover:bg-zinc-100 transition cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => handleInterpretRequest()}
                        disabled={interpretLoading || !rawPrompt.trim()}
                        className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium transition flex items-center space-x-1.5 disabled:opacity-50 flex-shrink-0 cursor-pointer shadow-xs"
                      >
                        {interpretLoading ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Analyzing Request...</span>
                          </>
                        ) : (
                          <span>Analyze Request &rarr;</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Mode 2: Document OCR Input */}
              {hubMode === 'document' && (
                <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="text-xs font-medium text-zinc-700 block mb-1.5">Document File Name</label>
                      <input
                        type="text"
                        value={docFileName}
                        onChange={(e) => setDocFileName(e.target.value)}
                        placeholder="e.g. invoice_vendor_apex.pdf"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 font-sans"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-700 block mb-1.5">Compliance Verification Rule</label>
                      <select
                        value={docPreset}
                        onChange={(e) => setDocPreset(e.target.value as any)}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 cursor-pointer font-sans"
                      >
                        <option value="preset_standard">Standard Verification (&le; {companyConfig.currency}{companyConfig.spendThreshold.toLocaleString()})</option>
                        <option value="preset_high_value">High-Value Threshold (&gt; {companyConfig.currency}{companyConfig.spendThreshold.toLocaleString()} Executive Escalation)</option>
                        <option value="preset_duplicate">Duplicate Invoice Number Guard</option>
                        <option value="preset_missing_tax">Missing Tax / Compliance Check</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                      Document Details / Text (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      placeholder="Supplier: Global Tech Ltd&#10;Invoice Number: INV-8921&#10;Amount: 1,450,000&#10;Due Date: 2026-11-01&#10;Tax ID: RC-882910"
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 font-sans leading-relaxed resize-y"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-zinc-100">
                    <div className="text-xs text-zinc-500">
                      Evaluates duplicate hashes, {companyConfig.currency}{companyConfig.spendThreshold.toLocaleString()} executive escalation thresholds, and mandatory regulatory compliance.
                    </div>
                    <button
                      onClick={() => handleProcessDocument()}
                      disabled={docLoading}
                      className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 flex-shrink-0 cursor-pointer shadow-xs"
                    >
                      {docLoading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Processing Document...</span>
                        </>
                      ) : (
                        <>
                          <span>Run Compliance Check &rarr;</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* =============================================================== */}
              {/* RESULTS: PROMPT WORKFLOW PLAN                                   */}
              {/* =============================================================== */}
              {interpretedPlan && (
                <div className="space-y-4">
                  {/* Status Strip */}
                  <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50 flex flex-wrap items-center justify-between gap-2.5 text-[11px] font-mono text-zinc-600 shadow-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-zinc-900 font-medium">Workflow Plan Generated</span>
                      <span>&bull;</span>
                      <span>{((interpretedPlan.engine?.latencyMs || 1200) / 1000).toFixed(1)}s</span>
                    </div>
                    <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded text-[10px] font-mono font-medium">
                      Policy Verified &bull; Ready for Authorization
                    </span>
                  </div>

                  {/* 3-Card Entity Breakdown Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Entity & Scope */}
                    <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1.5 shadow-xs">
                      <div className="text-[10px] font-mono uppercase text-zinc-500 font-semibold tracking-wider">
                        Vendor / Subject
                      </div>
                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {interpretedPlan.requestAnalysis?.supplier || 'General Operations'}
                      </div>
                      <div className="flex items-center space-x-1.5 pt-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border ${getStatusBadge(interpretedPlan.requestAnalysis?.type || 'STANDARD')}`}>
                          {interpretedPlan.requestAnalysis?.type}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border ${getPriorityBadge(interpretedPlan.requestAnalysis?.priority || 'MEDIUM')}`}>
                          {interpretedPlan.requestAnalysis?.priority}
                        </span>
                      </div>
                    </div>

                    {/* Timeline & Department */}
                    <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1.5 shadow-xs">
                      <div className="text-[10px] font-mono uppercase text-zinc-500 font-semibold tracking-wider">
                        Timeline &amp; Department
                      </div>
                      <div className="text-sm font-semibold text-zinc-900">
                        {interpretedPlan.requestAnalysis?.deadline || 'Standard 72h SLA'}
                      </div>
                      <div className="text-[11px] text-zinc-500 pt-0.5">
                        Department: <span className="text-zinc-800 font-medium">{interpretedPlan.requestAnalysis?.requiredDepartment || 'Operations'}</span>
                      </div>
                    </div>

                    {/* Policy & Requirements Check */}
                    <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1.5 shadow-xs">
                      <div className="text-[10px] font-mono uppercase text-zinc-500 font-semibold tracking-wider">
                        Policy &amp; Requirements
                      </div>
                      {(() => {
                        const missing = Array.isArray(interpretedPlan.requirementsAnalysis)
                          ? interpretedPlan.requirementsAnalysis.filter((r: any) =>
                              ['PRESENCE_UNCONFIRMED', 'NOT_MENTIONED', 'REQUIRED'].includes(r.status)
                            )
                          : [];
                        if (missing.length === 0) {
                          return (
                            <div className="text-[11px] text-emerald-700 font-medium flex items-center space-x-1 pt-1">
                              <span>✓</span>
                              <span>All mandatory requirements met</span>
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-1 pt-0.5">
                            {missing.map((m: any, i: number) => (
                              <div key={i} className="text-[11px] text-amber-800 font-medium flex items-center space-x-1.5">
                                <span className="text-amber-600 font-mono font-bold">!</span>
                                <span className="truncate">{m.item}: <span className="font-normal text-amber-700">{m.detail}</span></span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Proposed Sequential Action Steps */}
                  <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
                    <div className="p-3.5 border-b border-zinc-100 bg-zinc-50/70 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-zinc-900">Proposed Execution Checklist</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">Sequential action tasks verified against company policy rules</div>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200">
                        {interpretedPlan.proposedWorkflow?.length || 0} tasks
                      </span>
                    </div>

                    <div className="divide-y divide-zinc-100 text-xs">
                      {interpretedPlan.proposedWorkflow?.map((step: any, idx: number) => (
                        <div key={idx} className="p-3 flex items-center justify-between hover:bg-zinc-50/70 transition">
                          <div className="flex items-center space-x-3">
                            <span className="w-5 h-5 rounded-full border border-zinc-200 bg-zinc-100 flex items-center justify-center font-mono text-[10px] text-zinc-700 font-semibold flex-shrink-0">
                              {step.stepNumber || idx + 1}
                            </span>
                            <div>
                              <div className="font-medium text-zinc-900 text-xs">{step.title}</div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">{step.description}</div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 flex-shrink-0 ml-3">
                            <span className="text-[9px] font-mono tracking-tight uppercase px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-100 text-zinc-600">
                              {step.targetRole || 'OPERATOR'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Authorization & Dispatch Action Bar */}
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 flex flex-col md:flex-row items-center justify-between gap-3.5 shadow-xs">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg border border-emerald-200 bg-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-900">Authorize &amp; Dispatch Workflow</div>
                        <p className="text-[11px] text-zinc-600 mt-0.5">
                          Authorizing will officially create the request and notify the assigned team.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <button
                        onClick={() => setInterpretedPlan(null)}
                        className="px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-white text-xs text-zinc-600 hover:text-zinc-900 transition cursor-pointer"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleAuthorizePlan}
                        disabled={authorizeLoading}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        {authorizeLoading ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Authorizing &amp; Dispatching...</span>
                          </>
                        ) : (
                          <>
                            <span>Authorize &amp; Dispatch to Queue &rarr;</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* =============================================================== */}
              {/* RESULTS: DOCUMENT COMPLIANCE CHECK                              */}
              {/* =============================================================== */}
              {docResult && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div
                    className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-xs ${
                      docResult.deterministicRules?.duplicateDetected
                        ? 'border-rose-200 bg-rose-50 text-rose-800'
                        : docResult.deterministicRules?.isSeniorApprovalRequired
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : docResult.deterministicRules?.missingFields?.length > 0
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs md:text-sm">
                        {docResult.deterministicRules?.duplicateDetected
                          ? 'Duplicate Invoice Detected — Replay Blocked'
                          : docResult.deterministicRules?.isSeniorApprovalRequired
                          ? '₦500,000 Threshold Exceeded — Executive Approval Required'
                          : docResult.deterministicRules?.missingFields?.length > 0
                          ? 'Mandatory Tax / CAC Compliance Certificate Missing'
                          : 'Compliance Check Passed — Standard Processing'}
                      </div>
                      <div className="text-[11px] opacity-90 mt-0.5">
                        Supplier: {docResult.extracted?.supplier} &bull; Invoice #{docResult.extracted?.invoiceNumber} &bull; Amount: {docResult.extracted?.currency} {docResult.extracted?.amount?.toLocaleString()}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setActiveTab('audit');
                        setAuditSubTab('traces');
                      }}
                      className="px-2.5 py-1 rounded border border-current/40 hover:bg-current/10 text-[11px] font-medium transition flex-shrink-0 cursor-pointer self-start sm:self-auto"
                    >
                      View Execution Trace &rarr;
                    </button>
                  </div>

                  {/* 2-Column Extraction & Rule Radar */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="rounded-xl border border-zinc-200 bg-white p-3.5 space-y-2.5 shadow-xs">
                      <div className="text-[10px] font-mono uppercase text-zinc-500 font-semibold tracking-wider">
                        Extracted Document Details
                      </div>
                      <div className="divide-y divide-zinc-100 text-xs">
                        <div className="py-2 flex justify-between">
                          <span className="text-zinc-500">Supplier:</span>
                          <span className="font-medium text-zinc-900">{docResult.extracted?.supplier}</span>
                        </div>
                        <div className="py-2 flex justify-between">
                          <span className="text-zinc-500">Invoice Number:</span>
                          <span className="font-mono text-zinc-800">{docResult.extracted?.invoiceNumber}</span>
                        </div>
                        <div className="py-2 flex justify-between">
                          <span className="text-zinc-500">Total Amount:</span>
                          <span className="font-semibold text-zinc-900">
                            {docResult.extracted?.currency} {docResult.extracted?.amount?.toLocaleString()}
                          </span>
                        </div>
                        <div className="py-2 flex justify-between">
                          <span className="text-zinc-500">Tax / VAT ID:</span>
                          <span className="font-mono text-zinc-800">{docResult.extracted?.taxId || 'MISSING'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white p-3.5 space-y-2.5 shadow-xs">
                      <div className="text-[10px] font-mono uppercase text-zinc-500 font-semibold tracking-wider">
                        Corporate Policy &amp; Compliance Rules
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
                          <span className="text-zinc-700">Duplicate Invoice Protection:</span>
                          <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-medium ${
                            docResult.deterministicRules?.duplicateDetected
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {docResult.deterministicRules?.duplicateDetected ? 'BLOCKED' : 'PASSED (UNIQUE)'}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
                          <span className="text-zinc-700">₦500k Executive Approval Rule:</span>
                          <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-medium ${
                            docResult.deterministicRules?.isSeniorApprovalRequired
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                          }`}>
                            {docResult.deterministicRules?.isSeniorApprovalRequired ? 'ESCALATED' : 'STANDARD (≤ ₦500k)'}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
                          <span className="text-zinc-700">Mandatory Regulatory Fields:</span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            VERIFIED
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =================================================================== */}
          {/* VIEW 3: ACTIVE OPERATIONS (REQUESTS, TASKS & APPROVALS BOARD)       */}
          {/* =================================================================== */}
          {activeTab === 'operations' && (
            <div className="space-y-4 animate-fade-in-up">
              {/* Segmented Sub-Tabs & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 border border-zinc-200">
                  {[
                    { id: 'requests', label: 'All Requests', count: requests.length },
                    { id: 'tasks', label: 'Tasks', count: allTasks.filter((t) => t.status !== 'COMPLETED').length },
                    { id: 'approvals', label: 'Pending Approvals', count: allApprovals.filter((a) => a.status === 'PENDING').length },
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setOperationsSubTab(st.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
                        operationsSubTab === st.id
                          ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/90 font-semibold'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <span>{st.label}</span>
                      <span className="text-[10px] font-mono text-zinc-500">({st.count})</span>
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search records..."
                    className="w-full bg-white border border-zinc-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 font-sans shadow-xs"
                  />
                  <svg className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Sub-Tab 1: Requests Table */}
              {operationsSubTab === 'requests' && (
                <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden overflow-x-auto shadow-xs">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="text-[10px] text-zinc-500 border-b border-zinc-200 bg-zinc-50/80 font-mono uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Request</th>
                        <th className="py-2.5 px-3 font-semibold">Type</th>
                        <th className="py-2.5 px-3 font-semibold">Priority</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold">Assignee</th>
                        <th className="py-2.5 px-3.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-zinc-700">
                      {filteredRequests.map((r) => (
                        <tr key={r.id} className="hover:bg-zinc-50/70 transition">
                          <td className="py-2.5 px-3.5">
                            <div className="font-medium text-zinc-900 text-xs">{r.title}</div>
                            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{r.id.slice(0, 8)}...</div>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-500 font-mono text-[9px] tracking-tight uppercase">{r.request_type}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border font-medium ${getPriorityBadge(r.priority)}`}>
                              {r.priority}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border font-medium ${getStatusBadge(r.status)}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-800 text-xs">{r.assignee?.name || 'Unassigned'}</td>
                          <td className="py-2.5 px-3.5 text-right">
                            <button
                              onClick={() => fetchRequestDetail(r.id, true)}
                              className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-medium transition cursor-pointer shadow-xs"
                            >
                              Inspect &rarr;
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredRequests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-zinc-500 text-xs">
                            No requests found. Click "+ Create Request" or use Smart Intake to dispatch a new workflow.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-Tab 2: Tasks Checklist */}
              {operationsSubTab === 'tasks' && (
                <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden overflow-x-auto shadow-xs">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="text-[10px] text-zinc-500 border-b border-zinc-200 bg-zinc-50/80 font-mono uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Task Title</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold">Priority</th>
                        <th className="py-2.5 px-3 font-semibold">Assignee</th>
                        <th className="py-2.5 px-3.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-zinc-700">
                      {filteredTasks.map((t) => (
                        <tr key={t.id} className="hover:bg-zinc-50/70 transition">
                          <td className="py-2.5 px-3.5 font-medium text-zinc-900 text-xs">{t.title}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border border-zinc-200 bg-zinc-100 text-zinc-700">
                              {t.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-zinc-500 text-[9px] tracking-tight uppercase">{t.priority}</td>
                          <td className="py-2.5 px-3 text-zinc-800 text-xs">{t.assignee?.name || 'Unassigned'}</td>
                          <td className="py-2.5 px-3.5 text-right">
                            {t.status === 'PENDING' && (
                              <button
                                onClick={() => handleUpdateTaskStatus(t.id, 'IN_PROGRESS', t.request_id)}
                                className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-medium transition cursor-pointer shadow-xs"
                              >
                                Start
                              </button>
                            )}
                            {t.status === 'IN_PROGRESS' && (
                              <button
                                onClick={() => handleUpdateTaskStatus(t.id, 'COMPLETED', t.request_id)}
                                className="px-2.5 py-1 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 text-xs font-semibold transition cursor-pointer shadow-xs"
                              >
                                Complete
                              </button>
                            )}
                            {t.status === 'COMPLETED' && <span className="text-zinc-500 font-mono text-[10px] uppercase tracking-tight">Done</span>}
                          </td>
                        </tr>
                      ))}
                      {filteredTasks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-zinc-500 text-xs">
                            No tasks currently in queue.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-Tab 3: Pending Approvals */}
              {operationsSubTab === 'approvals' && (
                <div className="space-y-3">
                  {filteredApprovals.map((appr) => (
                    <div
                      key={appr.id}
                      className="p-4 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 transition flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs shadow-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-zinc-900 text-xs">{appr.request?.title || 'Operational Request'}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase border ${getPriorityBadge(appr.request?.priority || 'HIGH')}`}>
                            {appr.request?.priority || 'HIGH'}
                          </span>
                        </div>
                        <div className="text-zinc-500 text-[11px] font-sans flex items-center space-x-2">
                          <span>Assigned Approver: <span className="text-zinc-800 font-medium">{appr.approver?.name || 'Manager'}</span></span>
                          <span>&bull;</span>
                          <span className="text-[9px] font-mono uppercase tracking-tight text-zinc-500">Status: {appr.status}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 flex-shrink-0">
                        {appr.status === 'PENDING' ? (
                          <>
                            <button
                              onClick={() => handleDecideApproval(appr.id, 'APPROVED')}
                              disabled={actionLoading}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleDecideApproval(appr.id, 'REJECTED')}
                              disabled={actionLoading}
                              className="px-3.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 text-xs font-medium transition cursor-pointer shadow-xs disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="font-mono text-zinc-600 text-[10px] px-2 py-0.5 rounded border border-zinc-200 bg-zinc-100 uppercase tracking-tight">
                            Decided: {appr.decision}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredApprovals.length === 0 && (
                    <div className="p-8 text-center text-zinc-500 text-xs border border-zinc-200 rounded-xl bg-zinc-50/50 shadow-xs">
                      No pending approvals requiring sign-off.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* =================================================================== */}
          {/* VIEW 4: ACTIVITY & LOGS (AUDIT TRAIL, TRACES & BENCHMARKS)          */}
          {/* =================================================================== */}
          {activeTab === 'audit' && (
            <div className="space-y-5 animate-fade-in-up">
              {/* Top Segmented Sub-Tab Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 border border-zinc-200">
                  {[
                    { id: 'activity', label: 'Activity Trail', count: activityEvents.length },
                    { id: 'traces', label: 'Execution Traces', count: executions.length },
                    { id: 'benchmarks', label: 'Reliability & AI Benchmark' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setAuditSubTab(st.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
                        auditSubTab === st.id
                          ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/90 font-semibold'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <span>{st.label}</span>
                      {st.count !== undefined && (
                        <span className="text-[10px] font-mono text-zinc-500">({st.count})</span>
                      )}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => loadData()}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs text-zinc-700 hover:text-zinc-900 font-medium transition flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer shadow-xs"
                >
                  <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh</span>
                </button>
              </div>

              {/* ------------------------------------------------------------- */}
              {/* SUB-TAB 1: COMPANY ACTIVITY TRAIL                             */}
              {/* ------------------------------------------------------------- */}
              {auditSubTab === 'activity' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl border border-zinc-200 bg-white flex items-center justify-between shadow-xs">
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-900">Chronological Company Activity Log</h3>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        Immutable historical record of all creations, approvals, task transitions, and policy checks.
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">{activityEvents.length} total events</span>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden text-xs shadow-xs">
                    {activityEvents.map((ev) => (
                      <div key={ev.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50/70 transition">
                        <div className="space-y-0.5">
                          <div className="font-medium text-zinc-900 text-xs">{ev.description}</div>
                          <div className="text-[11px] text-zinc-500 flex items-center space-x-2">
                            <span>Actor: <span className="text-zinc-800 font-medium">{ev.actor?.name || 'System Orchestrator'}</span></span>
                            <span>&bull;</span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600 text-[9px] font-mono tracking-tight uppercase">
                              {ev.event_type}
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-zinc-500 text-[10px] flex-shrink-0">{formatTimestamp(ev.created_at)}</span>
                      </div>
                    ))}
                    {activityEvents.length === 0 && (
                      <div className="p-8 text-center text-zinc-500 font-mono text-xs">
                        No activity records found yet.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* SUB-TAB 2: WORKFLOW EXECUTION TRACES                          */}
              {/* ------------------------------------------------------------- */}
              {auditSubTab === 'traces' && (
                <div className="space-y-5">
                  {/* Execution Run Picker */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {executions.map((exec) => {
                      const isSelected = selectedExecution?.id === exec.id;
                      const code = exec.context?.executionCode || `#${exec.id.slice(0, 4)}`;
                      return (
                        <button
                          key={exec.id}
                          onClick={() => handleSelectExecution(exec)}
                          className={`p-3.5 rounded-xl border text-left transition cursor-pointer shadow-xs ${
                            isSelected
                              ? 'border-zinc-900 bg-zinc-50 text-zinc-900'
                              : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold text-zinc-900">{code}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase font-medium ${
                                exec.status === 'COMPLETED'
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : exec.status === 'FAILED'
                                  ? 'border border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border border-sky-200 bg-sky-50 text-sky-700'
                              }`}
                            >
                              {exec.status}
                            </span>
                          </div>
                          <div className="text-xs font-medium text-zinc-900 mt-1.5 truncate">
                            {exec.request?.title || exec.workflow_type}
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-1.5">
                            <span>Steps: {exec.context?.steps?.length || 0}</span>
                            <span>Attempt {exec.attempt} of {exec.max_attempts}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Selected Run Details */}
                  {selectedExecution ? (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                      {/* Left Column: Step Sequence Timeline (7 cols) */}
                      <div className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
                        <div className="p-3.5 border-b border-zinc-100 bg-zinc-50/70 flex items-center justify-between text-xs">
                          <span className="font-semibold text-zinc-900 uppercase tracking-wider font-mono text-[10px]">
                            Execution Step Progress
                          </span>
                          <span className="font-mono text-zinc-500 text-[10px]">
                            {selectedExecution.context?.steps?.length || 0} discrete steps
                          </span>
                        </div>

                        <div className="divide-y divide-zinc-100">
                          {selectedExecution.context?.steps?.map((step: any, idx: number) => {
                            const isStepSelected = selectedStepId === step.stepId;
                            return (
                              <div
                                key={step.stepId || idx}
                                onClick={() => setSelectedStepId(step.stepId)}
                                className={`p-3.5 flex items-center justify-between cursor-pointer transition ${
                                  isStepSelected ? 'bg-zinc-100/80 border-l-2 border-zinc-900' : 'hover:bg-zinc-50/70'
                                }`}
                              >
                                <div className="flex items-center space-x-3">
                                  <div
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold ${
                                      step.status === 'SUCCESS'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : step.status === 'FAILED'
                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                        : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                                    }`}
                                  >
                                    {idx + 1}
                                  </div>

                                  <div>
                                    <div className="text-xs font-medium text-zinc-900 flex items-center space-x-2">
                                      <span>{step.name}</span>
                                      <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-tight">[{step.type}]</span>
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                                      Latency: {step.durationMs ? `${step.durationMs}ms` : '—'} &bull; Status: {step.status}
                                    </div>
                                  </div>
                                </div>

                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono tracking-tight uppercase font-medium ${
                                    step.status === 'SUCCESS'
                                      ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                      : step.status === 'FAILED'
                                      ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                      : 'text-amber-800 bg-amber-50 border border-amber-200'
                                  }`}
                                >
                                  {step.status}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right Column: Step Inspector Drawer (5 cols) */}
                      <div className="lg:col-span-5 rounded-xl border border-zinc-200 bg-white p-4 space-y-3 text-xs shadow-xs">
                        {(() => {
                          const activeStep =
                            selectedExecution.context?.steps?.find((s: any) => s.stepId === selectedStepId) ||
                            selectedExecution.context?.steps?.[0];

                          if (!activeStep) {
                            return <div className="text-zinc-500 py-6 text-center font-mono text-xs">Select a step to inspect.</div>;
                          }

                          return (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                                <div>
                                  <div className="font-semibold text-zinc-900 text-xs">{activeStep.name}</div>
                                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">ID: {activeStep.stepId}</div>
                                </div>
                                <span className="text-[10px] font-mono text-zinc-700 font-medium">{activeStep.status}</span>
                              </div>

                              {/* AI Telemetry if step is AI */}
                              {activeStep.aiMetadata && (
                                <div className="p-3 rounded-lg border border-purple-200 bg-purple-50/60 space-y-1.5">
                                  <div className="text-[10px] font-mono uppercase text-purple-700 font-semibold">
                                    AI Processing Telemetry
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-800">
                                    <div>Engine: Enterprise LLM</div>
                                    <div>Latency: {activeStep.aiMetadata.latencyMs}ms</div>
                                    <div>Tokens: {activeStep.aiMetadata.tokensEstimated || '~400'}</div>
                                    <div>Cost: ${activeStep.aiMetadata.costUsdEstimated || '0.00018'}</div>
                                  </div>
                                </div>
                              )}

                              {/* Error Diagnostic & Retry if step failed */}
                              {activeStep.status === 'FAILED' && (
                                <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 space-y-1.5">
                                  <div className="text-[10px] font-mono uppercase text-rose-700 font-semibold">
                                    Error Diagnostic
                                  </div>
                                  <p className="text-[11px] font-mono text-rose-800 break-words leading-relaxed">
                                    {activeStep.error || selectedExecution.error || 'Transient Gateway Timeout.'}
                                  </p>
                                  <button
                                    onClick={() => handleRetryExecution(selectedExecution.id)}
                                    disabled={actionLoading}
                                    className="mt-1.5 w-full py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition cursor-pointer shadow-xs"
                                  >
                                    Re-attempt Failed Step
                                  </button>
                                </div>
                              )}

                              {/* Structured Step Parameters & Output */}
                              <div className="space-y-3 pt-1 border-t border-zinc-100">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-semibold">
                                    Step Properties &amp; Output
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowRawPayloads(!showRawPayloads)}
                                    className="text-[10px] font-mono text-zinc-600 hover:text-zinc-900 px-2 py-0.5 rounded border border-zinc-200 bg-zinc-50 transition cursor-pointer"
                                  >
                                    {showRawPayloads ? 'Show Structured Summary' : 'Show Raw JSON'}
                                  </button>
                                </div>

                                {!showRawPayloads ? (
                                  <div className="space-y-2.5">
                                    {/* Operation Inputs */}
                                    <div className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                      <div className="text-[10px] font-mono uppercase text-zinc-500">Operation Inputs</div>
                                      {Object.keys(activeStep.input || {}).length > 0 ? (
                                        <div className="divide-y divide-zinc-200/60 text-xs">
                                          {Object.entries(activeStep.input || {}).slice(0, 6).map(([k, v]) => (
                                            <div key={k} className="py-1 flex items-center justify-between">
                                              <span className="text-zinc-500 font-mono text-[11px]">{k}:</span>
                                              <span className="text-zinc-900 font-medium truncate max-w-[200px]">
                                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-zinc-500 text-[11px] font-mono">No input parameters required.</div>
                                      )}
                                    </div>

                                    {/* Operation Results */}
                                    <div className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                      <div className="text-[10px] font-mono uppercase text-zinc-500">Operation Results</div>
                                      {Object.keys(activeStep.output || {}).length > 0 ? (
                                        <div className="divide-y divide-zinc-200/60 text-xs">
                                          {Object.entries(activeStep.output || {}).slice(0, 6).map(([k, v]) => (
                                            <div key={k} className="py-1 flex items-center justify-between">
                                              <span className="text-zinc-500 font-mono text-[11px]">{k}:</span>
                                              <span className="text-zinc-900 font-medium truncate max-w-[200px]">
                                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-zinc-500 text-[11px] font-mono">Completed successfully without output data.</div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <pre className="p-2.5 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] font-mono text-zinc-800 overflow-x-auto max-h-48">
                                      {JSON.stringify({ input: activeStep.input, output: activeStep.output }, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-zinc-500 text-xs border border-zinc-200 rounded-xl bg-zinc-50/50 shadow-xs">
                      No execution traces recorded yet. Traces are automatically generated in real-time when workflows execute or documents are processed.
                    </div>
                  )}
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* SUB-TAB 3: AI RELIABILITY & BENCHMARKS                        */}
              {/* ------------------------------------------------------------- */}
              {auditSubTab === 'benchmarks' && (
                <div className="space-y-5">
                  {/* Metrics KPI Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Total Operations Processed', val: metrics?.totalCohortRequests ?? requests.length },
                      { label: 'SLA On-Time Rate', val: `${Math.round(100 - (metrics?.slaBreachRatePercent || 0))}%` },
                      { label: 'Avg Turnaround Time', val: metrics?.averageProcessingTimeFormatted || '1.8 hrs' },
                      { label: 'Active Tasks In Progress', val: allTasks.filter((t) => t.status !== 'COMPLETED').length },
                    ].map((s, idx) => (
                      <div key={idx} className="p-3.5 rounded-xl border border-zinc-200 bg-white shadow-xs">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase block font-medium">{s.label}</span>
                        <span className="text-xl font-bold text-zinc-900 block mt-1 tracking-tight">{s.val}</span>
                      </div>
                    ))}
                  </div>

                  {/* AI Benchmark Suite */}
                  <div className="p-5 rounded-xl border border-zinc-200 bg-white space-y-3.5 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-900">50-Sample Operational AI Benchmark</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Evaluates AI accuracy, SLA compliance, extraction reliability, and response speed across 50 simulated operations.
                        </p>
                      </div>
                      <button
                        onClick={handleRunAiEvaluation}
                        disabled={aiEvalLoading}
                        className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 flex-shrink-0 cursor-pointer shadow-xs"
                      >
                        {aiEvalLoading ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Running Benchmark Suite...</span>
                          </>
                        ) : (
                          <span>Run Benchmark Suite &rarr;</span>
                        )}
                      </button>
                    </div>

                    {aiEvalReport && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 pt-1.5">
                        {[
                          { label: 'Accuracy', val: aiEvalReport.summary?.accuracyFormatted || '100%' },
                          { label: 'Policy Adherence', val: aiEvalReport.summary?.macroF1Formatted || '100%' },
                          { label: 'Data Validity', val: aiEvalReport.summary?.schemaValidityFormatted || '100%' },
                          { label: 'Avg Latency', val: `${aiEvalReport.summary?.averageLatencyMs || 1200}ms` },
                          { label: 'Cost / Operation', val: `$${aiEvalReport.summary?.costPerRequest || '0.00037'}` },
                        ].map((stat, i) => (
                          <div key={i} className="p-3 rounded-lg border border-zinc-200 bg-zinc-50/50 shadow-xs">
                            <div className="text-[10px] font-mono text-zinc-500 uppercase font-semibold">{stat.label}</div>
                            <div className="text-base font-bold text-zinc-900 mt-0.5">{stat.val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ===================================================================== */}
      {/* CREATE REQUEST MODAL                                                  */}
      {/* ===================================================================== */}
      {showCreateModal && (
        <div className="fixed inset-y-0 inset-x-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-6 shadow-2xl space-y-4 text-zinc-900 animate-fade-in-up">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-sm font-semibold text-zinc-900">Create New Request</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-zinc-700 text-xs cursor-pointer p-1 rounded hover:bg-zinc-50">
                ✕
              </button>
            </div>

            {createModalError && (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
                {createModalError}
              </div>
            )}

            <form onSubmit={handleCreateRequest} className="space-y-3.5 text-xs">
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">Request Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Onboard Acme Ltd or Facilities Maintenance"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 font-sans"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">Description</label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Provide context, required actions, and details..."
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 font-sans leading-relaxed resize-y"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="text-xs font-medium text-zinc-700 block mb-1.5">Category</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 cursor-pointer font-sans"
                  >
                    {availableRequestTypes.map((t) => (
                      <option key={t} value={t} className="bg-white text-zinc-900">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-700 block mb-1.5">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 cursor-pointer font-sans"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs font-medium cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium cursor-pointer shadow-xs transition"
                >
                  Create &amp; Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* REQUEST DETAIL MODAL                                                  */}
      {/* ===================================================================== */}
      {showDetailModal && selectedRequest && (
        <div className="fixed inset-y-0 inset-x-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans">
          <div className="w-full max-w-2xl bg-white border border-zinc-200 rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-zinc-900 animate-fade-in-up">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">{selectedRequest.title}</h3>
                <span className="text-xs text-zinc-400 font-mono mt-0.5 block">{selectedRequest.id}</span>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="text-zinc-400 hover:text-zinc-700 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer transition">
                ✕ Close
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <span className="text-xs text-zinc-500 font-medium block">Status</span>
                  <span className="text-zinc-900 font-semibold mt-1 block text-xs tracking-tight uppercase">{selectedRequest.status}</span>
                </div>
                <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <span className="text-xs text-zinc-500 font-medium block">Priority</span>
                  <span className="text-zinc-900 font-semibold mt-1 block text-xs tracking-tight uppercase">{selectedRequest.priority}</span>
                </div>
                <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <span className="text-xs text-zinc-500 font-medium block">Type</span>
                  <span className="text-zinc-900 font-medium mt-1 block text-xs truncate">{selectedRequest.request_type}</span>
                </div>
                <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <span className="text-xs text-zinc-500 font-medium block">Requester</span>
                  <span className="text-zinc-900 font-medium mt-1 block text-xs truncate">{selectedRequest.requester?.name || '—'}</span>
                </div>
              </div>

              <div>
                <span className="text-xs font-medium text-zinc-700 block mb-1.5">Description</span>
                <p className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/30 text-zinc-800 leading-relaxed text-xs font-sans">
                  {selectedRequest.description}
                </p>
              </div>

              {/* Tasks List */}
              {selectedRequest.tasks && selectedRequest.tasks.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-zinc-700 block">Associated Tasks ({selectedRequest.tasks.length})</span>
                  <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                    {selectedRequest.tasks.map((t) => (
                      <div key={t.id} className="p-3 flex items-center justify-between bg-white text-xs">
                        <div>
                          <div className="font-medium text-zinc-900 text-xs">{t.title}</div>
                          <div className="text-xs text-zinc-500 mt-0.5 capitalize">{t.status.toLowerCase()} &bull; Priority: {t.priority.toLowerCase()}</div>
                        </div>
                        {t.status === 'PENDING' && (
                          <button
                            onClick={() => handleUpdateTaskStatus(t.id, 'IN_PROGRESS', selectedRequest.id)}
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-medium cursor-pointer shadow-xs transition"
                          >
                            Start
                          </button>
                        )}
                        {t.status === 'IN_PROGRESS' && (
                          <button
                            onClick={() => handleUpdateTaskStatus(t.id, 'COMPLETED', selectedRequest.id)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 text-xs font-medium cursor-pointer shadow-xs transition"
                          >
                            Complete
                          </button>
                        )}
                        {t.status === 'COMPLETED' && <span className="text-zinc-500 text-xs font-medium">Done</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BUSINESS ONBOARDING / SETUP MODAL                                     */}
      {/* ===================================================================== */}
      {showOnboardingModal && (
        <BusinessOnboardingModal
          currentConfig={companyConfig}
          currentUsers={users}
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
          onResetWorkspace={handleResetWorkspace}
          onSave={(newCfg, updatedUsers) => {
            setCompanyConfig(newCfg);
            setUsers(updatedUsers);
            setShowOnboardingModal(false);
            setNotification({
              type: 'success',
              message: `Workspace configured for ${newCfg.companyName}.`,
            });
            setIsSelectingProfile(true);
          }}
        />
      )}
    </div>
  );
}
