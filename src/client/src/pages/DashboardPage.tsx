import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSSE, SSEIndicator } from '../hooks/useSSE';
import { useInstallModal } from '../components/InstallModal';
import { StatusBadge, PageLoader } from '../components/Shared';
import type { DashboardState } from '../../../shared/types';
import { DEFAULTS } from '../../../shared/constants';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { openInstall } = useInstallModal();

  useEffect(() => { document.title = 'Overview — Sidelink'; }, []);

  const reload = useCallback(async () => {
    setLoadWarning(null);
    const results = await Promise.allSettled([
      api.listAppleAccounts(),
      api.listDevices(),
      api.listIpas(),
      api.listJobs(),
      api.listInstalledApps(),
      api.getScheduler(),
      api.dashboard(),
    ]);

    const merged: DashboardState = {
      accounts: results[0].status === 'fulfilled' ? (results[0].value.data ?? []) : [],
      devices: results[1].status === 'fulfilled' ? (results[1].value.data ?? []) : [],
      ipas: results[2].status === 'fulfilled' ? (results[2].value.data ?? []) : [],
      jobs: results[3].status === 'fulfilled' ? (results[3].value.data ?? []) : [],
      installedApps: results[4].status === 'fulfilled' ? (results[4].value.data ?? []) : [],
      scheduler: results[5].status === 'fulfilled' && results[5].value.data
        ? results[5].value.data
        : {
            enabled: false,
            running: false,
            checkIntervalMs: DEFAULTS.schedulerCheckIntervalMs,
            refreshThresholdMs: 24 * 60 * 60 * 1000,
            lastCheckAt: null,
            lastError: null,
            pendingRefreshCount: 0,
          },
      weeklyAppIdUsage: results[6].status === 'fulfilled' ? results[6].value.data?.weeklyAppIdUsage : undefined,
    };

    setData(merged);
    const failedCalls = results.filter((r) => r.status === 'rejected').length;
    if (failedCalls > 0) {
      setLoadWarning(`Loaded with partial data (${failedCalls} endpoint${failedCalls > 1 ? 's' : ''} failed).`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const sseState = useSSE({
    'device-update': (devices) => setData(prev => prev ? { ...prev, devices: devices as DashboardState['devices'] } : prev),
    'job-update': (job) => setData(prev => {
      if (!prev) return prev;
      const j = job as DashboardState['jobs'][number];
      const jobs = prev.jobs.map(x => x.id === j.id ? j : x);
      if (!jobs.find(x => x.id === j.id)) jobs.unshift(j);
      return { ...prev, jobs };
    }),
  });

  if (loading) return <PageLoader message="Loading..." />;
  if (!data) return <p className="text-red-400">Failed to load dashboard</p>;

  const hasAccounts = (data.accounts?.length ?? 0) > 0;
  const hasDevices = (data.devices?.length ?? 0) > 0;
  const hasIpas = (data.ipas?.length ?? 0) > 0;
  const activeJobs = data.jobs?.filter(j => j.status === 'running' || j.status === 'waiting_2fa') ?? [];
  const recentJobs = data.jobs?.slice(0, 5) ?? [];
  const freeAccountUsages = Object.values(data.weeklyAppIdUsage ?? {});
  const maxFreeUsage = freeAccountUsages.length > 0
    ? Math.max(...freeAccountUsages.map((u) => (u.limit > 0 ? u.used / u.limit : 0)))
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--sl-text)]">Overview</h2>
          <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Your sideloading dashboard</p>
        </div>
        <div className="flex items-center gap-3">
          <SSEIndicator state={sseState} />
          <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Quick Install
          </button>
        </div>
      </div>

      {/* Setup warnings */}
      {loadWarning && (
        <div className="sl-card flex items-center gap-3 p-3 !border-amber-500/15 !bg-amber-500/[0.04]">
          <span className="text-[12px] text-amber-300">{loadWarning}</span>
        </div>
      )}

      {!hasAccounts && (
        <div className="sl-card flex items-center gap-4 p-4 !border-amber-500/15 !bg-amber-500/[0.04]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <svg className="w-4.5 h-4.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-amber-300">No Apple ID configured</p>
            <p className="text-[12px] text-amber-400/60 mt-0.5">Add your Apple ID to start signing and installing apps.</p>
          </div>
          <Link to="/apple" className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500 shrink-0 text-[12px]">
            Add Apple ID
          </Link>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
        {[
          { to: '/apple', count: data.accounts?.length ?? 0, label: 'Apple Accounts', color: 'indigo', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /> },
          { to: '/devices', count: data.devices?.length ?? 0, label: 'Devices', color: 'emerald', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /> },
          { to: '/apps', count: data.ipas?.length ?? 0, label: 'IPAs', color: 'violet', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /> },
          { to: '/installed', count: data.installedApps?.length ?? 0, label: 'Installed', color: 'cyan', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> },
        ].map((stat) => (
          <Link key={stat.to} to={stat.to} className="sl-card sl-card-interactive group p-4 animate-fadeInUp">
            <div className="flex items-center justify-between mb-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-${stat.color}-500/10`}>
                <svg className={`w-4 h-4 text-${stat.color}-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>{stat.icon}</svg>
              </div>
              <svg className="w-3.5 h-3.5 text-[var(--sl-muted)] opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </div>
            <p className="text-2xl font-bold text-[var(--sl-text)]">{stat.count}</p>
            <p className="text-[12px] text-[var(--sl-muted)] mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <div className="sl-card !border-indigo-500/15 !bg-indigo-500/[0.04] p-5">
          <h3 className="text-[13px] font-semibold text-indigo-300 mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
            Active Installation{activeJobs.length > 1 ? 's' : ''}
          </h3>
          <div className="space-y-2">
            {activeJobs.map(job => (
              <div key={job.id} className="flex items-center justify-between rounded-lg bg-black/20 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-[var(--sl-muted)]">{job.id.slice(0, 8)}</span>
                  <span className="text-[13px] text-[var(--sl-text)]">{job.currentStep ?? 'starting'}</span>
                </div>
                <StatusBadge status={job.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Recent Jobs */}
        <div className="sl-card p-5">
          <h3 className="sl-section-label mb-3">Recent Jobs</h3>
          {recentJobs.length === 0 ? (
            <p className="text-[13px] text-[var(--sl-muted)] py-6 text-center">No jobs yet. Click Quick Install to get started.</p>
          ) : (
            <div className="space-y-0.5">
              {recentJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between py-2.5 border-b border-[var(--sl-border)] last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-mono text-[var(--sl-muted)]">{job.id.slice(0, 8)}</span>
                    <span className="text-[12px] text-[var(--sl-muted)]">{job.currentStep ?? '-'}</span>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scheduler */}
        <div className="sl-card p-5">
          <h3 className="sl-section-label mb-3">Auto-Refresh</h3>
          <div className="flex items-center gap-3">
            <div className={`h-2 w-2 rounded-full ${data.scheduler?.enabled ? 'bg-emerald-400' : 'bg-[var(--sl-muted)] opacity-30'}`} />
            <p className="text-[13px] text-[var(--sl-text)]">
              {data.scheduler?.enabled
                ? `Active — every ${Math.round((data.scheduler.checkIntervalMs ?? 0) / 60000)} min`
                : 'Disabled'}
            </p>
          </div>
          <Link to="/settings" className="inline-flex items-center gap-1 text-[12px] text-[var(--sl-muted)] hover:text-[var(--sl-accent-hover)] mt-3 transition-colors">
            Configure
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </Link>
        </div>
      </div>

      {freeAccountUsages.length > 0 && (
        <div className={`sl-card p-5 ${maxFreeUsage >= 0.8 ? '!border-amber-500/15 !bg-amber-500/[0.04]' : ''}`}>
          <h3 className="sl-section-label mb-3">Weekly App ID Usage (Free Accounts)</h3>
          <div className="space-y-2">
            {freeAccountUsages.map((usage) => {
              const ratio = usage.limit > 0 ? Math.min(usage.used / usage.limit, 1) : 0;
              return (
                <div key={usage.accountId} className="rounded-lg border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px]">
                    <span className="font-mono text-[var(--sl-muted)]">{usage.teamId}</span>
                    <span className="text-[var(--sl-text)]">{usage.used} / {usage.limit}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sl-bg)]">
                    <div
                      className={`h-full rounded-full ${ratio >= 0.8 ? 'bg-amber-400' : 'bg-[var(--sl-accent)]'}`}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
