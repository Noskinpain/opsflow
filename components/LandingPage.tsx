'use client';

import React from 'react';
import { CompanyConfig } from './onboarding-types';

interface LandingPageProps {
  companyConfig: CompanyConfig;
  activeUser: { name: string; role: string; department: string } | null;
  onEnterWorkspace: () => void;
  onOpenSetup: () => void;
}

export function LandingPage({
  companyConfig,
  activeUser,
  onEnterWorkspace,
  onOpenSetup,
}: LandingPageProps) {
  const isConfigured = Boolean(companyConfig.companyName && companyConfig.companyName.trim().length > 0);

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans antialiased selection:bg-zinc-200 selection:text-zinc-900 flex flex-col justify-between">
      {/* Top Minimalist Header */}
      <header className="border-b border-zinc-200/80 px-6 sm:px-12 py-4 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-md z-40">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white font-extrabold flex items-center justify-center text-xs shadow-xs tracking-tight">
            OF
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold text-zinc-900 tracking-tight">OpsFlow</span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">
              Operations Testbed
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {isConfigured ? (
            <div className="hidden sm:flex items-center space-x-2 text-xs text-zinc-500 mr-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Workspace: <strong className="text-zinc-900 font-medium">{companyConfig.companyName}</strong></span>
            </div>
          ) : (
            <span className="hidden sm:inline-block text-xs text-zinc-400">
              Unconfigured Sandbox
            </span>
          )}

          <button
            type="button"
            onClick={onOpenSetup}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-medium text-zinc-700 transition cursor-pointer shadow-xs"
          >
            {isConfigured ? 'Edit Configuration' : 'Setup Organization'}
          </button>

          <button
            type="button"
            onClick={onEnterWorkspace}
            className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-white transition cursor-pointer shadow-xs flex items-center space-x-1.5"
          >
            <span>Launch Testbed</span>
            <span>&rarr;</span>
          </button>
        </div>
      </header>

      {/* Main Hero & Testbed Positioning */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 sm:px-12 py-12 sm:py-20 space-y-16">
        {/* Hero Narrative */}
        <div className="space-y-6 max-w-3xl">
          <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-700 text-[11px] font-medium tracking-tight">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-900" />
            <span>OPERATIONAL WORKFLOW SIMULATION &amp; VALIDATION</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-zinc-950 leading-[1.15]">
            Test your business operations in practice before they become real problems.
          </h1>

          <div className="space-y-3.5 text-zinc-600 text-sm sm:text-base leading-relaxed">
            <p>
              In a real company, every role has its own responsibilities, permissions, and spending limits.
              OpsFlow lets you test how those operational rules hold up before they turn into costly bottlenecks.
            </p>
            <p>
              Configure your organization&apos;s roles, define approval thresholds, and simulate the entire workflow from one place:
              submit requests as a <strong className="text-zinc-900 font-medium">Requester</strong>, enforce spending limits as a <strong className="text-zinc-900 font-medium">Manager</strong>, and execute assigned tasks as an <strong className="text-zinc-900 font-medium">Operator</strong>.
            </p>
          </div>

          {/* Action Row */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={onEnterWorkspace}
              className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs sm:text-sm font-semibold transition cursor-pointer shadow-xs flex items-center justify-center space-x-2"
            >
              <span>{isConfigured ? 'Enter Simulation Environment' : 'Start With Clean Testbed'}</span>
              <span>&rarr;</span>
            </button>

            <button
              type="button"
              onClick={onOpenSetup}
              className="px-5 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-800 text-xs sm:text-sm font-medium transition cursor-pointer shadow-xs flex items-center justify-center space-x-2"
            >
              <span>Configure Roles &amp; Limits</span>
            </button>
          </div>

          {/* Active Testing Persona Chip */}
          {activeUser && (
            <div className="pt-1 flex items-center space-x-2 text-xs text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Current Testing Persona:</span>
              <span className="font-semibold text-zinc-900">{activeUser.name}</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">
                {activeUser.role} &bull; {activeUser.department}
              </span>
            </div>
          )}
        </div>

        {/* 3 Core Sandbox Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card 1 */}
          <div className="p-6 rounded-2xl border border-zinc-200 bg-white shadow-xs space-y-3.5 flex flex-col justify-between hover:border-zinc-300 transition">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider font-semibold text-zinc-500 uppercase">
                  Pillar 01
                </span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-700">
                  Role Simulation
                </span>
              </div>
              <h2 className="text-base font-semibold text-zinc-900 tracking-tight">
                Simulate Each Desk in the Workflow
              </h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Switch personas inside a controlled testing environment to experience operations from every seat.
                Submit intake tickets as a Requester, review gated queues as a Manager, and dispatch fulfillment as an Operator.
              </p>
            </div>
            <div className="pt-3 border-t border-zinc-100 text-[11px] font-mono text-zinc-500">
              REQUESTER &rarr; MANAGER &rarr; OPERATOR
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-2xl border border-zinc-200 bg-white shadow-xs space-y-3.5 flex flex-col justify-between hover:border-zinc-300 transition">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider font-semibold text-zinc-500 uppercase">
                  Pillar 02
                </span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-700">
                  Guardrails &amp; Limits
                </span>
              </div>
              <h2 className="text-base font-semibold text-zinc-900 tracking-tight">
                Spending Limits &amp; Policy Gating
              </h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Enforce concrete authorization thresholds (e.g. {companyConfig.currency || '₦'}{(companyConfig.spendThreshold || 500000).toLocaleString()}).
                Low-value tickets bypass review straight to execution, while high-value requisitions require explicit Manager sign-off before progression.
              </p>
            </div>
            <div className="pt-3 border-t border-zinc-100 text-[11px] font-mono text-zinc-500">
              THRESHOLD: {companyConfig.currency || '₦'}{(companyConfig.spendThreshold || 500000).toLocaleString()}
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-2xl border border-zinc-200 bg-white shadow-xs space-y-3.5 flex flex-col justify-between hover:border-zinc-300 transition">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider font-semibold text-zinc-500 uppercase">
                  Pillar 03
                </span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-700">
                  Audit Ledger
                </span>
              </div>
              <h2 className="text-base font-semibold text-zinc-900 tracking-tight">
                Trace States &amp; Validate Edge Cases
              </h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Observe deterministic state changes (NEW &rarr; AWAITING_APPROVAL &rarr; IN_PROGRESS &rarr; COMPLETED).
                Inspect live SLA breach countdowns, idempotent event logs, and verify that closed tickets reject unauthorized tampering.
              </p>
            </div>
            <div className="pt-3 border-t border-zinc-100 text-[11px] font-mono text-zinc-500">
              IMMUTABLE AUDIT TRAIL
            </div>
          </div>
        </div>

        {/* What You Can Validate Here: Practical Checklist */}
        <div className="p-7 rounded-2xl border border-zinc-200 bg-zinc-50/60 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 tracking-tight">
                What you can validate in this testbed
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Observe how business logic, permissions, and routing behave in real scenarios.
              </p>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">
              4 Core Scenarios Ready
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="flex items-start space-x-2.5">
              <span className="w-4 h-4 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                ✓
              </span>
              <div>
                <strong className="text-zinc-900 block font-medium">Approval Triggering</strong>
                <span className="text-zinc-500">Verify that requests crossing your spend threshold freeze in &lsquo;AWAITING_APPROVAL&rsquo; until signed off.</span>
              </div>
            </div>

            <div className="flex items-start space-x-2.5">
              <span className="w-4 h-4 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                ✓
              </span>
              <div>
                <strong className="text-zinc-900 block font-medium">Task Dispatch &amp; Work Queue</strong>
                <span className="text-zinc-500">Confirm that approved tickets automatically spawn concrete fulfillment tasks for operators.</span>
              </div>
            </div>

            <div className="flex items-start space-x-2.5">
              <span className="w-4 h-4 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                ✓
              </span>
              <div>
                <strong className="text-zinc-900 block font-medium">SLA Countdown &amp; Breach Tracking</strong>
                <span className="text-zinc-500">Monitor deadlines and observe automated escalation alerts when operations risk breaching targets.</span>
              </div>
            </div>

            <div className="flex items-start space-x-2.5">
              <span className="w-4 h-4 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                ✓
              </span>
              <div>
                <strong className="text-zinc-900 block font-medium">Backend Invariant Enforcement</strong>
                <span className="text-zinc-500">Ensure closed requests cannot be modified and unauthorized approvals are rejected by the API.</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Clean Minimalist Footer */}
      <footer className="border-t border-zinc-200 px-6 sm:px-12 py-5 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white">
        <div className="flex items-center space-x-2">
          <span>OpsFlow &bull; Business Operations Testbed</span>
          <span>&bull;</span>
          <span className="text-zinc-400">Simulation Environment</span>
        </div>

        <div className="flex items-center space-x-4">
          <button
            type="button"
            onClick={onOpenSetup}
            className="text-zinc-600 hover:text-zinc-900 cursor-pointer underline underline-offset-4 transition"
          >
            Configure Roles
          </button>
          <button
            type="button"
            onClick={onEnterWorkspace}
            className="font-medium text-zinc-900 hover:text-black cursor-pointer transition"
          >
            Enter Testbed &rarr;
          </button>
        </div>
      </footer>
    </div>
  );
}
