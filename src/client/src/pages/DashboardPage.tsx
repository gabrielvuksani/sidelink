import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSSE, SSEIndicator } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useInstallModal } from '../components/InstallModal';
import { StatusBadge, PageHeader, EmptyState } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import { HelperControlPanel } from '../components/HelperControlPanel';
import { DesktopReadinessPanel } from '../components/DesktopReadinessPanel';
import type { DashboardState } from '../../../shared/types';

type DashboardWidgetId =
  | 'accounts'
  | 'devices'
  | 'ipas'
  | 'installed'
  | 'helper'
  | 'readiness'
  | 'active-jobs'
  | 'recent-jobs'
  | 'analytics'
  | 'auto-refresh'
  | 'quota';

type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  title: string;
  description: string;
  tone?: 'default' | 'feature' | 'warning';
  headerMode?: 'hidden' | 'compact' | 'standard';
  render: () => ReactNode;
};

const DEFAULT_WIDGET_LAYOUT: { id: DashboardWidgetId }[] = [
  { id: 'accounts' },
  { id: 'devices' },
  { id: 'ipas' },
  { id: 'installed' },
  { id: 'helper' },
  { id: 'readiness' },
  { id: 'active-jobs' },
  { id: 'recent-jobs' },
  { id: 'analytics' },
  { id: 'auto-refresh' },
  { id: 'quota' },
];

export default function DashboardPage() {
  const warmSnapshot = getUiSnapshot<DashboardState>('page:dashboard');
  const [data, setData] = useState<DashboardState | null>(warmSnapshot?.data ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const { openInstall } = useInstallModal();
  const refreshTimerRef = useRef<number | null>(null);
  const dataRef = useRef<DashboardState | null>(warmSnapshot?.data ?? null);
  const reloadInFlightRef = useRef(false);
  const queuedForceReloadRef = useRef(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  useEffect(() => { document.title = 'Overview — SideLink'; }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const reload = useCallback(async (force = false) => {
    if (reloadInFlightRef.current) {
      queuedForceReloadRef.current = queuedForceReloadRef.current || force;
      return;
    }

    reloadInFlightRef.current = true;

    if (!dataRef.current) {
      setLoading(true);
    }

    try {
      const res = await api.dashboard({ bypassCache: force });
      const nextData = res.data ?? null;
      startTransition(() => {
        setData(nextData);
        setLoadError(null);
      });
      if (nextData) {
        setUiSnapshot('page:dashboard', nextData);
        setLastUpdatedAt(Date.now());
      }
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      reloadInFlightRef.current = false;
      setLoading(false);

      if (queuedForceReloadRef.current) {
        const queuedForce = queuedForceReloadRef.current;
        queuedForceReloadRef.current = false;
        void reload(queuedForce);
      }
    }
  }, []);

  const scheduleReload = useCallback((force = true) => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void reload(force);
    }, 360);
  }, [reload]);

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 12_000 });

  const sseState = useSSE({
    'device-update': () => scheduleReload(true),
    'job-update': () => scheduleReload(true),
    'app-update': () => scheduleReload(true),
    'scheduler-update': () => scheduleReload(true),
  });

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const activeAccounts = data?.accounts?.filter((account) => account.status === 'active') ?? [];
  const hasAccounts = activeAccounts.length > 0;
  const hasDevices = (data?.devices?.length ?? 0) > 0;
  const hasIpas = (data?.ipas?.length ?? 0) > 0;
  const sortedJobs = [...(data?.jobs ?? [])].sort((left, right) => {
    const leftStamp = new Date(left.updatedAt ?? left.createdAt).getTime();
    const rightStamp = new Date(right.updatedAt ?? right.createdAt).getTime();
    return rightStamp - leftStamp;
  });
  const activeJobs = sortedJobs.filter((job) => job.status === 'running' || job.status === 'waiting_2fa');
  const recentJobs = sortedJobs.slice(0, 5);
  const freeAccountUsages = Object.values(data?.weeklyAppIdUsage ?? {});
  const maxFreeUsage = freeAccountUsages.length > 0
    ? Math.max(...freeAccountUsages.map((usage) => (usage.limit > 0 ? usage.used / usage.limit : 0)))
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
      detail: 'Connect an iPhone or iPad before using Install App or helper pairing.',
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

  const widgetDefinitions = useMemo<DashboardWidgetDefinition[]>(() => {
    const statCards = [
      {
        id: 'accounts' as const,
        to: '/apple',
        count: data?.accounts?.length ?? 0,
        label: 'Apple Accounts',
        tone: 'indigo' as const,
        icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />,
      },
      {
        id: 'devices' as const,
        to: '/devices',
        count: data?.devices?.length ?? 0,
        label: 'Devices',
        tone: 'emerald' as const,
        icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />,
      },
      {
        id: 'ipas' as const,
        to: '/apps',
        count: data?.ipas?.length ?? 0,
        label: 'Library IPAs',
        tone: 'violet' as const,
        icon: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />,
      },
      {
        id: 'installed' as const,
        to: '/installed',
        count: data?.installedApps?.length ?? 0,
        label: 'Installed Apps',
        tone: 'cyan' as const,
        icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
      },
    ];

    return [
      ...statCards.map((stat) => ({
        id: stat.id,
        title: stat.label,
        description: stat.id === 'accounts' ? 'Your Apple signing accounts and their status.'
          : stat.id === 'devices' ? 'Connected iOS devices ready for installation.'
          : stat.id === 'ipas' ? 'IPA files in your library.'
          : 'Apps installed on your devices.',
        headerMode: 'hidden' as const,
        render: () => (
          <OverviewStatCard
            to={stat.to}
            count={stat.count}
            label={stat.label}
            tone={stat.tone}
            icon={stat.icon}
          />
        ),
      })),
      {
        id: 'helper',
        title: 'iPhone helper',
        description: 'iPhone companion app pairing and provisioning.',
        tone: 'feature',
        headerMode: 'standard',
        render: () => <HelperControlPanel variant="overview" embedded />,
      },
      {
        id: 'readiness',
        title: 'Desktop readiness',
        description: 'System health and component status.',
        headerMode: 'standard',
        render: () => <DesktopReadinessPanel embedded />,
      },
      {
        id: 'active-jobs',
        title: 'Active installs',
        description: 'Installations currently in progress.',
        headerMode: 'compact',
        render: () => (
          <WidgetListStack
            emptyTitle="No active installations"
            emptyDetail="Active installations will appear here once you start signing or installing an app."
            items={activeJobs.map((job) => ({
              key: job.id,
              title: job.currentStep ?? 'Starting install',
              detail: job.id.slice(0, 8),
              status: job.status,
              tone: 'dark' as const,
            }))}
          />
        ),
      },
      {
        id: 'recent-jobs',
        title: 'Recent jobs',
        description: 'Recently completed installations.',
        headerMode: 'compact',
        render: () => (
          <>
            <div className="mb-3 flex justify-end">
              <Link to="/install" className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">Open install history</Link>
            </div>
            <WidgetListStack
              emptyTitle="No jobs yet"
              emptyDetail="Your recent installations will appear here."
              items={recentJobs.map((job) => ({
                key: job.id,
                title: job.currentStep ?? 'Pending job',
                detail: job.id.slice(0, 8),
                status: job.status,
                tone: 'soft' as const,
              }))}
            />
          </>
        ),
      },
      {
        id: 'analytics',
        title: 'Install Analytics',
        description: 'Success rate and activity summary.',
        headerMode: 'compact',
        render: () => {
          const total = (data?.jobs ?? []).length;
          const completed = (data?.jobs ?? []).filter(j => j.status === 'completed').length;
          const failed = (data?.jobs ?? []).filter(j => j.status === 'failed').length;
          const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[var(--sl-text)]">{successRate}%</span>
                <span className="text-[12px] text-[var(--sl-muted)]">success rate</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                {completed > 0 && <div className="h-full bg-[var(--sl-success)]" style={{ width: `${(completed/total)*100}%` }} />}
                {failed > 0 && <div className="h-full bg-[var(--sl-danger)]" style={{ width: `${(failed/total)*100}%` }} />}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-semibold text-[var(--sl-text)]">{total}</p><p className="text-[11px] text-[var(--sl-muted)]">Total</p></div>
                <div><p className="text-lg font-semibold text-[var(--sl-success)]">{completed}</p><p className="text-[11px] text-[var(--sl-muted)]">Passed</p></div>
                <div><p className="text-lg font-semibold text-[var(--sl-danger)]">{failed}</p><p className="text-[11px] text-[var(--sl-muted)]">Failed</p></div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'auto-refresh',
        title: 'Auto-refresh',
        description: 'Automatic certificate refresh schedule.',
        headerMode: 'compact',
        render: () => (
          <SchedulerWidget
            enabled={!!data?.scheduler?.enabled}
            intervalMinutes={Math.round((data?.scheduler?.checkIntervalMs ?? 0) / 60_000)}
            pendingRefreshCount={data?.scheduler?.pendingRefreshCount ?? 0}
          />
        ),
      },
      {
        id: 'quota',
        title: 'Weekly app ID usage',
        description: 'Free account App ID usage and limits.',
        tone: maxFreeUsage >= 0.8 ? 'warning' : 'default',
        headerMode: 'compact',
        render: () => (
          <QuotaWidget
            usages={freeAccountUsages}
            maxFreeUsage={maxFreeUsage}
          />
        ),
      },
    ];
  }, [activeAccounts.length, activeJobs, data?.accounts, data?.devices, data?.installedApps, data?.ipas, data?.jobs, data?.scheduler, freeAccountUsages, maxFreeUsage, recentJobs]);

  const widgetDefinitionMap = useMemo(
    () => Object.fromEntries(widgetDefinitions.map((definition) => [definition.id, definition])) as Record<DashboardWidgetId, DashboardWidgetDefinition>,
    [widgetDefinitions],
  );

  const statusSummary = useMemo(() => {
    if (setupAlerts.length > 0) return `${setupAlerts.length} setup step${setupAlerts.length > 1 ? 's' : ''} remaining`;
    if (activeJobs.length > 0) return `${activeJobs.length} install${activeJobs.length > 1 ? 's' : ''} in progress`;
    const expiringCount = data?.installedApps?.filter((app) => {
      if (!app.expiresAt) return false;
      const daysLeft = (new Date(app.expiresAt).getTime() - Date.now()) / 86_400_000;
      return daysLeft <= 3 && daysLeft > 0;
    })?.length ?? 0;
    if (expiringCount > 0) return `${expiringCount} app${expiringCount > 1 ? 's' : ''} expiring soon`;
    if (maxFreeUsage >= 0.8) return 'Weekly quota pressure — watch free limits';
    return 'All systems ready';
  }, [setupAlerts.length, activeJobs.length, data?.installedApps, maxFreeUsage]);

  if (loading && !data) {
    return (
      <div className="sl-page animate-fadeIn">
        <div className="sl-page-hero">
          <div className="sl-page-hero-inner sl-hero-single-col">
            <div>
              <div className="sl-skeleton h-4 w-24 mb-3" />
              <div className="sl-skeleton h-10 w-64 mb-3" />
              <div className="sl-skeleton h-5 w-96" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="dashboard-widget sl-card p-5 dashboard-widget-stat">
              <div className="sl-skeleton h-3 w-16 mb-4" />
              <div className="sl-skeleton h-8 w-12 mb-2" />
              <div className="sl-skeleton h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="dashboard-widget sl-card p-5 min-h-[180px]">
              <div className="sl-skeleton h-4 w-32 mb-6" />
              <div className="space-y-3">
                <div className="sl-skeleton h-3 w-full" />
                <div className="sl-skeleton h-3 w-3/4" />
                <div className="sl-skeleton h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Mission Control"
        title={statusSummary}
        description={(
          <>
            Your apps, devices, and signing status at a glance.
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-[var(--sl-text)]">
              <span className="sl-chip"><SSEIndicator state={sseState} /> Live sync</span>
              <span className="sl-chip">{activeJobs.length > 0 ? `${activeJobs.length} active install${activeJobs.length > 1 ? 's' : ''}` : 'Ready for installs'}</span>
              <span className="sl-chip text-[var(--sl-muted)]">
                <svg className="inline h-3 w-3 mr-1 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Updated <TimeAgo timestamp={lastUpdatedAt} />
              </span>
            </div>
          </>
        )}
        actions={(
          <>
            <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Install App
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

      {setupAlerts.length > 0 && (
        <div className="sl-card sl-card-amber-strong rounded-[24px] p-5 sm:p-6 shadow-[0_0_30px_rgba(245,158,11,0.06)]">
          <div className="flex items-center gap-2 mb-4">
            <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <p className="text-[14px] font-bold text-amber-300 tracking-tight">Setup Required</p>
            <span className="ml-auto text-[11px] font-semibold text-amber-400/60 uppercase tracking-wider">{setupAlerts.length} step{setupAlerts.length > 1 ? 's' : ''} remaining</span>
          </div>
          <div className="space-y-3">
            {setupAlerts.map((alert, idx) => (
              <div key={alert.title} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 rounded-2xl bg-amber-500/[0.06] p-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 font-bold text-[14px]">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-amber-200">{alert.title}</p>
                  <p className="mt-0.5 text-[12px] text-amber-400/60">{alert.detail}</p>
                </div>
                <Link to={alert.to} className="sl-btn-secondary w-full shrink-0 text-center text-[13px] font-semibold sm:w-auto flex items-center justify-center gap-1.5">
                  {alert.action}
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Dashboard statistics">
        {DEFAULT_WIDGET_LAYOUT.filter((w) => ['accounts', 'devices', 'ipas', 'installed'].includes(w.id)).map((widget) => {
          const definition = widgetDefinitionMap[widget.id];
          return (
            <section key={widget.id} className="sl-card dashboard-widget flex min-h-[180px] flex-col overflow-hidden" aria-label={`${definition.title} widget`}>
              <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
                {definition.render()}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {DEFAULT_WIDGET_LAYOUT.filter((w) => !['accounts', 'devices', 'ipas', 'installed'].includes(w.id)).map((widget) => {
          const definition = widgetDefinitionMap[widget.id];
          return (
            <OverviewWidgetShell
              key={widget.id}
              title={definition.title}
              description={definition.description}
              tone={definition.tone ?? 'default'}
              headerMode={definition.headerMode ?? 'standard'}
            >
              {definition.render()}
            </OverviewWidgetShell>
          );
        })}
      </div>
    </div>
  );
}

function OverviewWidgetShell({
  title,
  description,
  tone,
  headerMode,
  children,
}: {
  title: string;
  description: string;
  tone: 'default' | 'feature' | 'warning';
  headerMode: 'hidden' | 'compact' | 'standard';
  children: ReactNode;
}) {
  const toneClass = {
    default: '',
    feature: 'sl-card-sky',
    warning: 'sl-card-amber',
  }[tone];

  return (
    <section className={`sl-card dashboard-widget flex min-h-[210px] flex-col overflow-hidden ${toneClass}`}>
      {headerMode !== 'hidden' && (
        <div className={`border-b border-[var(--sl-border)] ${headerMode === 'standard' ? 'px-4 py-4 sm:px-5' : 'px-4 py-3 sm:px-5'} bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]`}>
          <div className="min-w-0">
            <h3 className={`${headerMode === 'compact' ? 'text-[14px]' : 'text-[15px]'} font-semibold tracking-tight text-[var(--sl-text)]`}>{title}</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--sl-muted)]">{description}</p>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
        {children}
      </div>
    </section>
  );
}

function TimeAgo({ timestamp }: { timestamp: number }) {
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    setSecondsAgo(Math.floor((Date.now() - timestamp) / 1000));
    const interval = window.setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - timestamp) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timestamp]);

  if (secondsAgo < 5) return <>just now</>;
  if (secondsAgo < 60) return <>{secondsAgo}s ago</>;
  const minutes = Math.floor(secondsAgo / 60);
  return <>{minutes}m ago</>;
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
  icon: ReactNode;
}) {
  const toneClass = {
    indigo: 'bg-indigo-500/10 text-indigo-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
    violet: 'bg-violet-500/10 text-violet-300',
    cyan: 'bg-cyan-500/10 text-cyan-300',
  }[tone];

  return (
    <Link to={to} className="block h-full" aria-label={`${label}: ${count}. Click to view details.`}>
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${toneClass} shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>{icon}</svg>
          </div>
          <span className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">
            View
          </span>
        </div>

        <div>
          <p className="text-4xl font-extrabold leading-none tracking-[-0.05em] text-[var(--sl-text)] tabular-nums" aria-live="polite">{count}</p>
          <p className="mt-2 max-w-[14ch] text-[12px] leading-5 text-[var(--sl-muted)] sm:text-[13px] font-medium">{label}</p>
        </div>
      </div>
    </Link>
  );
}

function WidgetListStack({
  items,
  emptyTitle,
  emptyDetail,
}: {
  items: Array<{ key: string; title: string; detail: string; status: string; tone: 'dark' | 'soft' }>;
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (items.length === 0) {
    return <WidgetEmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex flex-col gap-2 rounded-[22px] px-4 py-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between ${item.tone === 'dark' ? 'bg-black/20' : 'border border-[var(--sl-border)] bg-[var(--sl-surface-soft)]'}`}
        >
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--sl-text)]">{item.title}</p>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--sl-muted)]">{item.detail}</p>
          </div>
          <StatusBadge status={item.status} />
        </div>
      ))}
    </div>
  );
}

function SchedulerWidget({
  enabled,
  intervalMinutes,
  pendingRefreshCount,
}: {
  enabled: boolean;
  intervalMinutes: number;
  pendingRefreshCount: number;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-[var(--sl-muted)] opacity-30'}`} />
          <p className="text-[13px] text-[var(--sl-text)]">
            {enabled ? `Active every ${intervalMinutes} min` : 'Disabled'}
          </p>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[var(--sl-muted)]">
          {enabled
            ? `${pendingRefreshCount} app${pendingRefreshCount === 1 ? '' : 's'} currently queued for refresh checks.`
            : 'Turn this on when you want expiring installs renewed automatically.'}
        </p>
      </div>

      <div className="mt-auto flex justify-end">
        <Link to="/settings" className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">
          Configure scheduler
        </Link>
      </div>
    </div>
  );
}

function QuotaWidget({
  usages,
  maxFreeUsage,
}: {
  usages: Array<{ accountId: string; teamId: string; used: number; limit: number }>;
  maxFreeUsage: number;
}) {
  if (usages.length === 0) {
    return (
      <WidgetEmptyState
        title="No tracked free-account quota"
        detail="This widget becomes useful once a free Apple account starts consuming weekly app identifiers. Until then, it stays compact and informative instead of blank."
      />
    );
  }

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {usages.map((usage) => {
        const ratio = usage.limit > 0 ? Math.min(usage.used / usage.limit, 1) : 0;
        return (
          <div key={usage.accountId} className="rounded-[22px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
              <span className="font-mono text-[var(--sl-muted)]">{usage.teamId}</span>
              <span className="text-[var(--sl-text)]">{usage.used} / {usage.limit}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sl-bg)]">
              <div
                className={`h-full rounded-full ${ratio >= 0.8 ? 'bg-amber-400' : 'bg-[var(--sl-accent)]'}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
            <p className={`mt-3 text-[11px] ${maxFreeUsage >= 0.8 ? 'text-amber-200' : 'text-[var(--sl-muted)]'}`}>
              {ratio >= 0.8 ? 'Approaching weekly app ID ceiling' : 'Within healthy weekly range'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function WidgetEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <EmptyState
      title={title}
      description={detail}
      icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>}
    />
  );
}


