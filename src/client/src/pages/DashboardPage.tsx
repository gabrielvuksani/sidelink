import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSSE, SSEIndicator } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useInstallModal } from '../components/InstallModal';
import { StatusBadge, PageHeader, PageLoader, SectionHeading } from '../components/Shared';
import { HelperControlPanel } from '../components/HelperControlPanel';
import type { DashboardState } from '../../../shared/types';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { openInstall } = useInstallModal();
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => { document.title = 'Overview — Sidelink'; }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api.dashboard();
      setData(res.data ?? null);
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void reload();
    }, 220);
  }, [reload]);

  usePageRefresh(reload);

  const sseState = useSSE({
    'device-update': () => scheduleReload(),
    'job-update': () => scheduleReload(),
    'app-update': () => scheduleReload(),
    'scheduler-update': () => scheduleReload(),
  });

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  if (loading) return <PageLoader message="Loading overview..." />;
  if (!data) {
    return (
      <div className="sl-card space-y-3 p-6 text-center">
        <p className="text-sm font-semibold text-[var(--sl-text)]">Overview is unavailable right now</p>
        <p className="text-[13px] text-[var(--sl-muted)]">{loadError ?? 'Dashboard data could not be loaded.'}</p>
        <div>
          <button onClick={() => void reload()} className="sl-btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  const activeAccounts = data.accounts?.filter((account) => account.status === 'active') ?? [];
  const hasAccounts = activeAccounts.length > 0;
  const hasDevices = (data.devices?.length ?? 0) > 0;
  const hasIpas = (data.ipas?.length ?? 0) > 0;
  const sortedJobs = [...(data.jobs ?? [])].sort((left, right) => {
    const leftStamp = new Date(left.updatedAt ?? left.createdAt).getTime();
    const rightStamp = new Date(right.updatedAt ?? right.createdAt).getTime();
    return rightStamp - leftStamp;
  });
  const activeJobs = sortedJobs.filter(j => j.status === 'running' || j.status === 'waiting_2fa');
  const recentJobs = sortedJobs.slice(0, 5);
  const freeAccountUsages = Object.values(data.weeklyAppIdUsage ?? {});
  const maxFreeUsage = freeAccountUsages.length > 0
    ? Math.max(...freeAccountUsages.map((u) => (u.limit > 0 ? u.used / u.limit : 0)))
    : 0;
  const setupAlerts = [
    !hasAccounts ? {
      title: 'No active Apple ID available',
      detail: 'Add or re-authenticate an Apple ID to start signing and installing apps.',
      to: '/apple',
      action: 'Open Apple IDs',
    } : null,
    hasAccounts && !hasDevices ? {
      title: 'No device connected',
      detail: 'Connect an iPhone or iPad before using Quick Install or helper pairing.',
      to: '/devices',
      action: 'Open Devices',
    } : null,
    hasAccounts && hasDevices && !hasIpas ? {
      title: 'No IPA available',
      detail: 'Upload or import an IPA so installs can start from the overview page immediately.',
      to: '/apps',
      action: 'Open IPAs',
    } : null,
  ].filter(Boolean) as Array<{ title: string; detail: string; to: string; action: string }>;
  const stats = [
    {
      to: '/apple',
      count: data.accounts?.length ?? 0,
      label: 'Apple Accounts',
      tone: 'indigo',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />,
    },
    {
      to: '/devices',
      count: data.devices?.length ?? 0,
      label: 'Devices',
      tone: 'emerald',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />,
    },
    {
      to: '/apps',
      count: data.ipas?.length ?? 0,
      label: 'Library IPAs',
      tone: 'violet',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />,
    },
    {
      to: '/installed',
      count: data.installedApps?.length ?? 0,
      label: 'Installed Apps',
      tone: 'cyan',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    },
  ] as const;

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Mission Control"
        title="One desktop surface for every signing workflow"
        description={(
          <>
            Devices, installs, helper pairing, and signing readiness refresh from one stable dashboard snapshot, so production usage feels like a single system instead of a loose set of tools.
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-200">
              <span className="sl-chip"><SSEIndicator state={sseState} /> Live sync</span>
              <span className="sl-chip">{activeJobs.length > 0 ? `${activeJobs.length} active install${activeJobs.length > 1 ? 's' : ''}` : 'Ready for installs'}</span>
              <span className="sl-chip">Helper-aware dashboard</span>
            </div>
          </>
        )}
        actions={(
          <>
            <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Quick Install
            </button>
            <Link to="/apps" className="sl-btn-ghost">Import IPA</Link>
            <Link to="/devices" className="sl-btn-ghost">Open Devices</Link>
          </>
        )}
        stats={[
          { label: 'Ready Accounts', value: `${activeAccounts.length}`, tone: 'teal' },
          { label: 'Connected Devices', value: `${data.devices?.length ?? 0}`, tone: 'lime' },
          { label: 'Library Ready', value: `${data.ipas?.length ?? 0} IPAs`, tone: 'sky' },
          { label: 'Refresh Pressure', value: maxFreeUsage >= 0.8 ? 'Watch free limits' : 'Healthy', tone: maxFreeUsage >= 0.8 ? 'amber' : 'slate' },
        ]}
      />

      {setupAlerts.map((alert) => (
        <div key={alert.title} className="sl-card flex items-center gap-4 p-4 !border-amber-500/15 !bg-amber-500/[0.04]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <svg className="h-4.5 w-4.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-amber-300">{alert.title}</p>
            <p className="mt-0.5 text-[12px] text-amber-400/60">{alert.detail}</p>
          </div>
          <Link to={alert.to} className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500 shrink-0 text-[12px]">
            {alert.action}
          </Link>
        </div>
      ))}

      <SectionHeading
        eyebrow="Operations"
        title="Readiness, activity, and helper control"
        description="Overview cards stay compact, but the shell now makes install pressure, setup gaps, and helper status obvious at a glance."
      />

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {stats.map((stat) => (
              <OverviewStatCard key={stat.to} {...stat} />
            ))}
          </div>

          {activeJobs.length > 0 && (
            <div className="sl-card !border-indigo-500/15 !bg-indigo-500/[0.04] p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-indigo-300">
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                Active Installation{activeJobs.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-2">
                {activeJobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between rounded-xl bg-black/20 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--sl-text)]">{job.currentStep ?? 'Starting install'}</p>
                      <p className="mt-0.5 text-[11px] font-mono text-[var(--sl-muted)]">{job.id.slice(0, 8)}</p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="sl-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="sl-section-label">Recent Jobs</h3>
                <Link to="/install" className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">Open install history</Link>
              </div>
              {recentJobs.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[var(--sl-muted)]">No jobs yet. Quick Install will drop the first live job here.</p>
              ) : (
                <div className="space-y-2">
                  {recentJobs.map(job => (
                    <div key={job.id} className="flex items-center justify-between rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--sl-text)]">{job.currentStep ?? 'Pending job'}</p>
                        <p className="mt-0.5 text-[11px] font-mono text-[var(--sl-muted)]">{job.id.slice(0, 8)}</p>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="sl-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="sl-section-label">Auto-Refresh</h3>
                <Link to="/settings" className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">Configure</Link>
              </div>
              <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${data.scheduler?.enabled ? 'bg-emerald-400' : 'bg-[var(--sl-muted)] opacity-30'}`} />
                  <p className="text-[13px] text-[var(--sl-text)]">
                    {data.scheduler?.enabled
                      ? `Active every ${Math.round((data.scheduler.checkIntervalMs ?? 0) / 60000)} min`
                      : 'Disabled'}
                  </p>
                </div>
                <p className="mt-3 text-[12px] leading-5 text-[var(--sl-muted)]">
                  {data.scheduler?.enabled
                    ? `${data.scheduler.pendingRefreshCount ?? 0} app${(data.scheduler.pendingRefreshCount ?? 0) === 1 ? '' : 's'} currently queued for refresh checks.`
                    : 'Turn this on when you want expiring installs renewed automatically.'}
                </p>
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-4">
          <HelperControlPanel variant="overview" />
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

function QuickMetric({ label, value, tone }: { label: string; value: string; tone: 'sky' | 'emerald' | 'violet' }) {
  const toneClass = {
    sky: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
    emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
    violet: 'border-violet-400/20 bg-violet-400/10 text-violet-100',
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-3 backdrop-blur-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 text-[15px] font-semibold">{value}</p>
    </div>
  );
}

function OverviewStatCard({
  to,
  count,
  label,
  tone,
  icon,
}: {
  to: string;
  count: number;
  label: string;
  tone: 'indigo' | 'emerald' | 'violet' | 'cyan';
  icon: React.ReactNode;
}) {
  const toneClass = {
    indigo: 'bg-indigo-500/10 text-indigo-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
    violet: 'bg-violet-500/10 text-violet-300',
    cyan: 'bg-cyan-500/10 text-cyan-300',
  }[tone];

  return (
    <Link to={to} className="sl-card sl-card-interactive group p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>{icon}</svg>
        </div>
        <svg className="h-3.5 w-3.5 -translate-x-1 text-[var(--sl-muted)] opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
      </div>
      <p className="text-2xl font-bold text-[var(--sl-text)]">{count}</p>
      <p className="mt-0.5 text-[12px] text-[var(--sl-muted)]">{label}</p>
    </Link>
  );
}
