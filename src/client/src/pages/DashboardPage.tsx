import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSSE, SSEIndicator } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useInstallModal } from '../components/InstallModal';
import { StatusBadge, PageHeader, PageLoader } from '../components/Shared';
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
  | 'auto-refresh'
  | 'quota';

type DashboardWidgetSize = 'small' | 'medium' | 'wide' | 'large';

type DashboardLayoutItem = {
  id: DashboardWidgetId;
  size: DashboardWidgetSize;
};

type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  title: string;
  description: string;
  allowedSizes: DashboardWidgetSize[];
  defaultSize: DashboardWidgetSize;
  tone?: 'default' | 'feature' | 'warning';
  headerMode?: 'hidden' | 'compact' | 'standard';
  render: (size: DashboardWidgetSize) => ReactNode;
};

const OVERVIEW_LAYOUT_STORAGE_KEY = 'sidelink:overview-layout:v3';

const DEFAULT_WIDGET_LAYOUT: DashboardLayoutItem[] = [
  { id: 'accounts', size: 'small' },
  { id: 'devices', size: 'small' },
  { id: 'ipas', size: 'small' },
  { id: 'installed', size: 'small' },
  { id: 'helper', size: 'large' },
  { id: 'readiness', size: 'wide' },
  { id: 'active-jobs', size: 'wide' },
  { id: 'recent-jobs', size: 'medium' },
  { id: 'auto-refresh', size: 'medium' },
  { id: 'quota', size: 'wide' },
];

type WidgetSizeMeta = { allowedSizes: DashboardWidgetSize[]; defaultSize: DashboardWidgetSize };

const WIDGET_META: Record<DashboardWidgetId, WidgetSizeMeta> = {
  accounts: { allowedSizes: ['small', 'medium'], defaultSize: 'small' },
  devices: { allowedSizes: ['small', 'medium'], defaultSize: 'small' },
  ipas: { allowedSizes: ['small', 'medium'], defaultSize: 'small' },
  installed: { allowedSizes: ['small', 'medium'], defaultSize: 'small' },
  helper: { allowedSizes: ['medium', 'wide', 'large'], defaultSize: 'large' },
  readiness: { allowedSizes: ['medium', 'wide'], defaultSize: 'wide' },
  'active-jobs': { allowedSizes: ['medium', 'wide', 'large'], defaultSize: 'wide' },
  'recent-jobs': { allowedSizes: ['medium', 'wide'], defaultSize: 'medium' },
  'auto-refresh': { allowedSizes: ['small', 'medium', 'wide'], defaultSize: 'medium' },
  quota: { allowedSizes: ['medium', 'wide', 'large'], defaultSize: 'wide' },
};

export default function DashboardPage() {
  const warmSnapshot = getUiSnapshot<DashboardState>('page:dashboard');
  const [data, setData] = useState<DashboardState | null>(warmSnapshot?.data ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [layout, setLayout] = useState<DashboardLayoutItem[]>(() => loadDashboardLayout());
  const { openInstall } = useInstallModal();
  const refreshTimerRef = useRef<number | null>(null);
  const dataRef = useRef<DashboardState | null>(warmSnapshot?.data ?? null);
  const reloadInFlightRef = useRef(false);
  const queuedForceReloadRef = useRef(false);

  useEffect(() => { document.title = 'Overview — SideLink'; }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    persistDashboardLayout(layout);
  }, [layout]);

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
        description: `Open ${stat.label.toLowerCase()} and inspect the current roster.`,
        allowedSizes: ['small', 'medium'] as DashboardWidgetSize[],
        defaultSize: 'small' as DashboardWidgetSize,
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
        description: 'Build, import, and open pairing code or QR handoff from one operational widget instead of a long right-rail card.',
        allowedSizes: ['medium', 'wide', 'large'],
        defaultSize: 'large',
        tone: 'feature',
        headerMode: 'standard',
        render: () => <HelperControlPanel variant="overview" embedded />,
      },
      {
        id: 'readiness',
        title: 'Desktop readiness',
        description: 'Runtime, signing, transport, and helper health in one glanceable diagnostic surface.',
        allowedSizes: ['medium', 'wide'],
        defaultSize: 'wide',
        headerMode: 'standard',
        render: () => <DesktopReadinessPanel embedded />,
      },
      {
        id: 'active-jobs',
        title: 'Active installs',
        description: 'Keep live signing or install work visible without pushing other cards into dead space.',
        allowedSizes: ['medium', 'wide', 'large'],
        defaultSize: 'wide',
        headerMode: 'compact',
        render: () => (
          <WidgetListStack
            emptyTitle="No active installations"
            emptyDetail="When a signing or install job starts, this widget becomes the live progress surface instead of leaving an empty column in the overview."
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
        description: 'Completed and failed install history, close enough to act on without opening another page first.',
        allowedSizes: ['medium', 'wide'],
        defaultSize: 'medium',
        headerMode: 'compact',
        render: () => (
          <>
            <div className="mb-3 flex justify-end">
              <Link to="/install" className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">Open install history</Link>
            </div>
            <WidgetListStack
              emptyTitle="No jobs yet"
              emptyDetail="The first install or signing action will appear here with a stable card height instead of shifting the entire overview grid."
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
        id: 'auto-refresh',
        title: 'Auto-refresh',
        description: 'Scheduler health and renewal pressure without leaving the overview.',
        allowedSizes: ['small', 'medium', 'wide'],
        defaultSize: 'medium',
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
        description: 'Show free-account quota pressure before limits become install failures.',
        allowedSizes: ['medium', 'wide', 'large'],
        defaultSize: 'wide',
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
  }, [activeAccounts.length, activeJobs, data?.accounts, data?.devices, data?.installedApps, data?.ipas, data?.scheduler, freeAccountUsages, maxFreeUsage, recentJobs]);

  const widgetDefinitionMap = useMemo(
    () => Object.fromEntries(widgetDefinitions.map((definition) => [definition.id, definition])) as Record<DashboardWidgetId, DashboardWidgetDefinition>,
    [widgetDefinitions],
  );

  const normalizedLayout = useMemo(
    () => normalizeDashboardLayout(layout, WIDGET_META),
    [layout],
  );

  useEffect(() => {
    if (!areLayoutsEqual(layout, normalizedLayout)) {
      setLayout(normalizedLayout);
    }
  }, [layout, normalizedLayout]);

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

  if (loading && !data) return <PageLoader message="Loading overview..." />;

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
            Devices, installs, helper pairing, and signing readiness in one dashboard snapshot.
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-200">
              <span className="sl-chip"><SSEIndicator state={sseState} /> Live sync</span>
              <span className="sl-chip">{activeJobs.length > 0 ? `${activeJobs.length} active install${activeJobs.length > 1 ? 's' : ''}` : 'Ready for installs'}</span>
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
        <div className="sl-card rounded-[24px] !border-amber-500/15 !bg-amber-500/[0.04] p-4 sm:p-5">
          <div className="space-y-3">
            {setupAlerts.map((alert) => (
              <div key={alert.title} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                  <svg className="h-4.5 w-4.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-amber-300">{alert.title}</p>
                  <p className="mt-0.5 text-[12px] text-amber-400/60">{alert.detail}</p>
                </div>
                <Link to={alert.to} className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500 w-full shrink-0 text-center text-[12px] sm:w-auto">
                  {alert.action}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {normalizedLayout.filter((w) => ['accounts', 'devices', 'ipas', 'installed'].includes(w.id)).map((widget) => {
          const definition = widgetDefinitionMap[widget.id];
          return (
            <section key={widget.id} className="sl-card dashboard-widget flex min-h-[180px] flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
                {definition.render(widget.size)}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {normalizedLayout.filter((w) => !['accounts', 'devices', 'ipas', 'installed'].includes(w.id)).map((widget) => {
          const definition = widgetDefinitionMap[widget.id];
          return (
            <OverviewWidgetShell
              key={widget.id}
              title={definition.title}
              description={definition.description}
              tone={definition.tone ?? 'default'}
              headerMode={definition.headerMode ?? 'standard'}
            >
              {definition.render(widget.size)}
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
    feature: '!border-sky-400/15 !bg-[linear-gradient(180deg,rgba(21,40,54,0.96),rgba(10,18,27,0.98))]',
    warning: '!border-amber-500/15 !bg-amber-500/[0.04]',
  }[tone];

  return (
    <section className={`sl-card dashboard-widget flex min-h-[210px] flex-col overflow-hidden ${toneClass}`}>
      {headerMode !== 'hidden' && (
        <div className={`border-b border-[var(--sl-border)] ${headerMode === 'standard' ? 'px-4 py-4 sm:px-5' : 'px-4 py-3 sm:px-5'} bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]`}>
          <div className="min-w-0">
            {headerMode === 'standard' ? <p className="sl-section-label">Overview Widget</p> : null}
            <h3 className={`${headerMode === 'compact' ? 'text-[14px]' : 'mt-1 text-[15px]'} font-semibold tracking-tight text-[var(--sl-text)]`}>{title}</h3>
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
    <Link to={to} className="block h-full">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${toneClass} shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>{icon}</svg>
          </div>
          <span className="text-[12px] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-accent-hover)]">
            View
          </span>
        </div>

        <div>
          <p className="text-3xl font-bold leading-none tracking-[-0.05em] text-[var(--sl-text)]">{count}</p>
          <p className="mt-2 max-w-[14ch] text-[12px] leading-5 text-[var(--sl-muted)] sm:text-[13px]">{label}</p>
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
    <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-4 py-5">
      <p className="text-[13px] font-semibold text-[var(--sl-text)]">{title}</p>
      <p className="mt-2 text-[12px] leading-6 text-[var(--sl-muted)]">{detail}</p>
    </div>
  );
}

function loadDashboardLayout(): DashboardLayoutItem[] {
  if (typeof window === 'undefined') return DEFAULT_WIDGET_LAYOUT;

  try {
    const raw = window.localStorage.getItem(OVERVIEW_LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_WIDGET_LAYOUT;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_WIDGET_LAYOUT;

    const nextLayout = parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const id = 'id' in item ? item.id : null;
      const size = 'size' in item ? item.size : null;
      if (!isDashboardWidgetId(id) || !isDashboardWidgetSize(size)) return [];
      return [{ id, size }];
    });

    return nextLayout.length > 0 ? mergeWithDefaultLayout(nextLayout) : DEFAULT_WIDGET_LAYOUT;
  } catch {
    return DEFAULT_WIDGET_LAYOUT;
  }
}

function persistDashboardLayout(layout: DashboardLayoutItem[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OVERVIEW_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function normalizeDashboardLayout(
  layout: DashboardLayoutItem[],
  meta: Record<DashboardWidgetId, WidgetSizeMeta>,
): DashboardLayoutItem[] {
  const seen = new Set<DashboardWidgetId>();
  const nextLayout: DashboardLayoutItem[] = [];

  for (const item of layout) {
    if (seen.has(item.id)) continue;
    const widgetMeta = meta[item.id];
    if (!widgetMeta) continue;
    const nextSize = widgetMeta.allowedSizes.includes(item.size) ? item.size : widgetMeta.defaultSize;
    nextLayout.push({ id: item.id, size: nextSize });
    seen.add(item.id);
  }

  for (const defaultItem of DEFAULT_WIDGET_LAYOUT) {
    if (!seen.has(defaultItem.id)) {
      const widgetMeta = meta[defaultItem.id];
      nextLayout.push({ id: defaultItem.id, size: widgetMeta.defaultSize });
    }
  }

  return nextLayout;
}

function mergeWithDefaultLayout(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const defaultIds = new Set(DEFAULT_WIDGET_LAYOUT.map((item) => item.id));
  const merged = layout.filter((item) => defaultIds.has(item.id));
  const seen = new Set(merged.map((item) => item.id));

  for (const defaultItem of DEFAULT_WIDGET_LAYOUT) {
    if (!seen.has(defaultItem.id)) {
      merged.push(defaultItem);
    }
  }

  return merged;
}

function areLayoutsEqual(left: DashboardLayoutItem[], right: DashboardLayoutItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.id === right[index].id && item.size === right[index].size);
}

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && DEFAULT_WIDGET_LAYOUT.some((item) => item.id === value);
}

function isDashboardWidgetSize(value: unknown): value is DashboardWidgetSize {
  return value === 'small' || value === 'medium' || value === 'wide' || value === 'large';
}

