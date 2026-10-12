'use client';

import React from 'react';
import { CompanyConfig } from './onboarding-types';

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

interface ProfileSelectionScreenProps {
  users: UserItem[];
  activeUser: UserItem | null;
  companyConfig: CompanyConfig;
  allApprovalsCount: number;
  allTasksCount: number;
  onSelectUser: (user: UserItem) => void;
  onOpenOnboarding: () => void;
}

export function ProfileSelectionScreen({
  users,
  activeUser,
  companyConfig,
  allApprovalsCount,
  allTasksCount,
  onSelectUser,
  onOpenOnboarding,
}: ProfileSelectionScreenProps) {
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-between p-4 sm:p-8 md:p-12 animate-fade-in select-none font-sans">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white font-bold flex items-center justify-center text-xs shadow-xs tracking-tight">
            OF
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-900 tracking-tight flex items-center space-x-1.5">
              <span>{companyConfig.companyName || 'Business Workspace'}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/70 text-zinc-700 font-medium">
                Active
              </span>
            </div>
            <div className="text-xs text-zinc-500 tracking-tight">{companyConfig.industry || 'Operations'}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenOnboarding}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 hover:text-zinc-900 text-xs font-medium transition cursor-pointer shadow-xs flex items-center space-x-1.5"
        >
          <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Business Setup &amp; Roles</span>
        </button>
      </div>

      {/* Main Profile Grid Section */}
      <div className="max-w-4xl mx-auto w-full py-8 md:py-14 text-center space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-900 tracking-tight">
            Who is working right now?
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 max-w-md mx-auto">
            Select your profile to enter your tailored operational workspace. No passwords or authentication required.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-left">
          {users.map((u) => {
            const isCurrent = u.id === activeUser?.id;

            return (
              <div
                key={u.id}
                onClick={() => onSelectUser(u)}
                className={`p-5 rounded-2xl border transition-all duration-200 cursor-pointer bg-white group hover:shadow-md hover:-translate-y-0.5 relative flex flex-col justify-between ${
                  isCurrent
                    ? 'border-zinc-900 ring-1 ring-zinc-900 shadow-xs'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-xl bg-zinc-900 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0 shadow-xs">
                      {u.name.charAt(0)}
                    </div>
                    <div className="flex items-center space-x-1.5">
                      {isCurrent && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active Now
                        </span>
                      )}
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-zinc-50 text-zinc-700 border-zinc-200">
                        {u.role}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="font-semibold text-zinc-900 text-sm group-hover:text-black transition">
                      {u.name}
                    </div>
                    <div className="text-xs text-zinc-500 font-normal capitalize mt-0.5">
                      {u.department}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 truncate">
                      {u.email}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    {u.role === 'MANAGER' && (
                      allApprovalsCount > 0 ? `${allApprovalsCount} pending approvals` : 'All approvals cleared'
                    )}
                    {u.role === 'OPERATOR' && (
                      allTasksCount > 0 ? `${allTasksCount} queue tasks` : 'Queue up to date'
                    )}
                    {u.role === 'REQUESTER' && 'Submit business requests'}
                    {u.role === 'ADMIN' && 'System administration'}
                  </span>
                  <span className="font-semibold text-zinc-900 group-hover:translate-x-0.5 transition-transform text-xs">
                    Enter &rarr;
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {users.length === 0 && (
          <div className="p-8 rounded-2xl border border-zinc-200 bg-white text-center space-y-3">
            <p className="text-xs text-zinc-600">No company profiles found yet.</p>
            <button
              onClick={onOpenOnboarding}
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-xs font-semibold"
            >
              Set Up Team Members
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-5xl mx-auto w-full text-center text-xs text-zinc-400 flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-zinc-200 gap-2">
        <span>OpsFlow Enterprise &bull; {companyConfig.companyName || 'Business Automation'}</span>
        <button
          onClick={onOpenOnboarding}
          className="text-zinc-600 hover:text-zinc-900 underline underline-offset-4 cursor-pointer text-xs transition"
        >
          Add team members or edit workflows &rarr;
        </button>
      </div>
    </div>
  );
}
