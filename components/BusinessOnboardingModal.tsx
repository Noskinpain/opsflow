'use client';

import React, { useState } from 'react';
import {
  CompanyConfig,
  TeamMemberConfig,
} from './onboarding-types';

interface BusinessOnboardingModalProps {
  currentConfig: CompanyConfig;
  currentUsers?: any[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: CompanyConfig, users: any[]) => void;
  onResetWorkspace?: () => void;
}

export function BusinessOnboardingModal({
  currentConfig,
  currentUsers = [],
  isOpen,
  onClose,
  onSave,
  onResetWorkspace,
}: BusinessOnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [companyName, setCompanyName] = useState(currentConfig.companyName || '');
  const [industry, setIndustry] = useState(currentConfig.industry || '');
  const [currency, setCurrency] = useState(currentConfig.currency || '₦');
  const [spendThreshold, setSpendThreshold] = useState<number>(currentConfig.spendThreshold || 500000);

  // Team Members
  const [teamMembers, setTeamMembers] = useState<TeamMemberConfig[]>(() => {
    if (currentUsers && currentUsers.length > 0) {
      return currentUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department,
      }));
    }
    return [
      { name: '', email: '', role: 'MANAGER', department: '' },
      { name: '', email: '', role: 'OPERATOR', department: '' },
    ];
  });

  // Custom Flows
  const [customFlows, setCustomFlows] = useState<string[]>(
    currentConfig.customFlows || []
  );
  const [newFlowInput, setNewFlowInput] = useState('');

  if (!isOpen) return null;

  // Add / Remove Member
  const handleAddMember = () => {
    setTeamMembers([
      ...teamMembers,
      {
        name: '',
        email: '',
        role: 'OPERATOR',
        department: 'Operations',
      },
    ]);
  };

  const handleUpdateMember = (index: number, field: keyof TeamMemberConfig, val: string) => {
    const updated = [...teamMembers];
    updated[index] = { ...updated[index], [field]: val };
    setTeamMembers(updated);
  };

  const handleRemoveMember = (index: number) => {
    if (teamMembers.length <= 1) return;
    setTeamMembers(teamMembers.filter((_, i) => i !== index));
  };

  // Add Custom Flow
  const handleAddFlow = () => {
    const val = newFlowInput.trim().toUpperCase().replace(/\s+/g, '_');
    if (!val || customFlows.includes(val)) return;
    setCustomFlows([...customFlows, val]);
    setNewFlowInput('');
  };

  const handleRemoveFlow = (flow: string) => {
    setCustomFlows(customFlows.filter((f) => f !== flow));
  };

  // Submit to API
  const handleFinalSubmit = async () => {
    if (!companyName.trim()) {
      setError('Company name is required.');
      setStep(1);
      return;
    }

    const validMembers = teamMembers.filter((m) => m.name.trim().length > 0);
    if (validMembers.length === 0) {
      setError('Please add at least one team member with a valid name.');
      setStep(2);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          industry: industry.trim() || 'Business Operations',
          currency,
          spendThreshold: Number(spendThreshold) || 500000,
          teamMembers: validMembers,
          customFlows,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const savedConfig: CompanyConfig = {
          companyName: data.data.companyName,
          industry: data.data.industry,
          currency: data.data.currency,
          spendThreshold: data.data.spendThreshold,
          customFlows: data.data.customFlows,
          samplePrompts: [],
        };

        if (typeof window !== 'undefined') {
          localStorage.setItem('opsflow_company_config', JSON.stringify(savedConfig));
          localStorage.setItem('opsflow_onboarded', 'true');
        }

        onSave(savedConfig, data.data.users);
      } else {
        setError(data.error || 'Failed to save business setup.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error while saving setup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white border border-zinc-200 rounded-2xl p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto animate-fade-in-up font-sans">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-zinc-100 pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 tracking-tight">
              Business Setup
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Configure your company profile, team positions, and workflow categories.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-xs p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer transition"
          >
            ✕
          </button>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { num: 1, label: 'Company Profile' },
            { num: 2, label: 'Team & Positions' },
            { num: 3, label: 'Workflows' },
            { num: 4, label: 'Review' },
          ].map((st) => (
            <button
              key={st.num}
              type="button"
              onClick={() => setStep(st.num as any)}
              className={`p-2.5 rounded-xl border text-left transition text-xs cursor-pointer ${
                step === st.num
                  ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs'
                  : step > st.num
                  ? 'bg-zinc-50 text-zinc-800 border-zinc-200'
                  : 'bg-white text-zinc-400 border-zinc-200'
              }`}
            >
              <div className="text-[10px] text-zinc-400">Step {st.num}</div>
              <div className="font-medium text-xs truncate mt-0.5">{st.label}</div>
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* STEP 1: COMPANY PROFILE */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                  Industry / Sector
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Technology, Retail, Manufacturing"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                  Operating Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 cursor-pointer"
                >
                  <option value="₦">₦ Naira (NGN)</option>
                  <option value="$">$ Dollar (USD)</option>
                  <option value="£">£ Pound (GBP)</option>
                  <option value="€">€ Euro (EUR)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                  Manager Approval Limit ({currency})
                </label>
                <input
                  type="number"
                  value={spendThreshold}
                  onChange={(e) => setSpendThreshold(Number(e.target.value))}
                  placeholder="500000"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Requests above this amount require executive sign-off.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: TEAM MEMBERS & POSITIONS */}
        {step === 2 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-zinc-900">Team Members &amp; Positions</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Add the employees in your business and their authorization roles.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddMember}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-medium transition cursor-pointer shadow-xs"
              >
                + Add Member
              </button>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {teamMembers.map((member, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/40 space-y-2 text-xs"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-xs font-medium text-zinc-600 block mb-1">Full Name</label>
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => handleUpdateMember(idx, 'name', e.target.value)}
                        placeholder="e.g. Amina Bello"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-600 block mb-1">Role / Authority</label>
                      <select
                        value={member.role}
                        onChange={(e) => handleUpdateMember(idx, 'role', e.target.value as any)}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 cursor-pointer"
                      >
                        <option value="MANAGER">MANAGER (Approver)</option>
                        <option value="OPERATOR">OPERATOR (Task Executor)</option>
                        <option value="REQUESTER">REQUESTER (Initiator)</option>
                        <option value="ADMIN">ADMIN (Full Access)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-600 block mb-1">Department</label>
                      <div className="flex items-center space-x-1.5">
                        <input
                          type="text"
                          value={member.department}
                          onChange={(e) => handleUpdateMember(idx, 'department', e.target.value)}
                          placeholder="e.g. Finance"
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400"
                        />
                        {teamMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(idx)}
                            className="text-zinc-400 hover:text-rose-600 p-1.5 rounded text-xs cursor-pointer transition"
                            title="Remove Member"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: WORKFLOWS */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-zinc-900">Operational Workflows</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Categories of requests and tasks relevant to your business operations.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/40 min-h-[72px]">
              {customFlows.map((flow) => (
                <span
                  key={flow}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-zinc-800 text-xs"
                >
                  <span>{flow}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFlow(flow)}
                    className="text-zinc-400 hover:text-rose-600 text-xs cursor-pointer ml-1"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={newFlowInput}
                onChange={(e) => setNewFlowInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddFlow();
                  }
                }}
                placeholder="Type new workflow name (e.g. WAYBILL_DISPATCH)..."
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
              />
              <button
                type="button"
                onClick={handleAddFlow}
                className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium cursor-pointer transition"
              >
                + Add Flow
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: REVIEW & LAUNCH */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3.5 text-xs">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2.5">
                <div>
                  <span className="text-[11px] text-zinc-500 block">Workspace</span>
                  <span className="text-sm font-semibold text-zinc-900">{companyName}</span>
                </div>
                <span className="text-xs text-zinc-700 bg-white px-2.5 py-1 rounded-md border border-zinc-200">
                  {industry || 'Operations'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] text-zinc-500 block">Team Positions</span>
                  <span className="text-zinc-900 font-medium text-xs mt-0.5 block">{teamMembers.length} members configured</span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-500 block">Manager Limit</span>
                  <span className="text-zinc-900 font-medium text-xs mt-0.5 block">{currency}{spendThreshold.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] text-zinc-500 block mb-1.5">Active Workflows</span>
                <div className="flex flex-wrap gap-1.5">
                  {customFlows.map((f) => (
                    <span key={f} className="text-xs px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed">
              Saving will update your active team members, approval thresholds, and operational queue routing.
            </p>
          </div>
        )}

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between pt-3.5 border-t border-zinc-100">
          <div className="flex items-center space-x-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((step - 1) as any)}
                className="px-3.5 py-2 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs font-medium cursor-pointer transition"
              >
                &larr; Back
              </button>
            ) : onResetWorkspace ? (
              <button
                type="button"
                onClick={onResetWorkspace}
                className="text-xs text-rose-600 hover:text-rose-700 hover:underline cursor-pointer flex items-center space-x-1"
                title="Wipe out all database entries and start clean"
              >
                <span>Clear Data &amp; Start Fresh</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center space-x-2">
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((step + 1) as any)}
                className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium cursor-pointer shadow-xs transition"
              >
                Continue &rarr;
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium transition cursor-pointer shadow-xs flex items-center space-x-1.5 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving Setup...</span>
                  </>
                ) : (
                  <span>Save &amp; Enter Workspace &rarr;</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
