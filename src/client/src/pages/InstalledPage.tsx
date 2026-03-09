import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { SSEIndicator, useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageHeader, PageLoader, EmptyState, SectionHeading } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { InstalledApp, AutoRefreshState, AppleAccount } from '../../../shared/types';
import type { AppleAppIdRecord, AppleAppIdUsageRecord } from '../lib/api';

const FALLBACK_REFRESH_MS = 5000;

type InstalledSnapshot = {
  apps: InstalledApp[];
  refreshStates: AutoRefreshState[];
  accounts: AppleAccount[];
  appIds: AppleAppIdRecord[];
  appIdUsage: AppleAppIdUsageRecord[];
  staleSections: string[];
};

type AppIdConsumer = {
  record: AppleAppIdRecord;
  kind: 'tracked' | 'deactivated' | 'extension' | 'orphaned';
  relatedAppName?: string;
};

export default function InstalledPage() {
  const warmSnapshot = getUiSnapshot<InstalledSnapshot>('page:installed');
  const [apps, setApps] = useState<InstalledApp[]>(warmSnapshot?.data.apps ?? []);
  const [refreshStates, setRefreshStates] = useState<AutoRefreshState[]>(warmSnapshot?.data.refreshStates ?? []);
  const [accounts, setAccounts] = useState<AppleAccount[]>(warmSnapshot?.data.accounts ?? []);
  const [appIds, setAppIds] = useState<AppleAppIdRecord[]>(warmSnapshot?.data.appIds ?? []);
  const [appIdUsage, setAppIdUsage] = useState<AppleAppIdUsageRecord[]>(warmSnapshot?.data.appIdUsage ?? []);
  const [staleSections, setStaleSections] = useState<string[]>(warmSnapshot?.data.staleSections ?? []);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(warmSnapshot?.updatedAt ?? null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const { toast } = useToast();
  const confirmDialog = useConfirm();
  const { openInstall } = useInstallModal();
  const refreshTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);

  useEffect(() => { document.title = 'Installed — SideLink'; }, []);

  const loadSnapshot = useCallback(async (): Promise<InstalledSnapshot> => {
    const currentApps = apps;
    const currentRefreshStates = refreshStates;
    const currentAccounts = accounts;
    const currentAppIds = appIds;
    const currentAppIdUsage = appIdUsage;

    const [appsRes, statesRes, accountsRes, appIdsRes, appIdUsageRes] = await Promise.allSettled([
      api.listInstalledApps(),
      api.getAutoRefreshStates(),
      api.listAppleAccounts(),
      api.listAppleAppIds(),
      api.listAppleAppIdUsage(),
    ]);

    const stale: string[] = [];

    const nextApps = appsRes.status === 'fulfilled'
      ? (appsRes.value.data ?? [])
      : (stale.push('installed apps'), currentApps);
    const nextRefreshStates = statesRes.status === 'fulfilled'
      ? (statesRes.value.data ?? [])
      : (stale.push('refresh states'), currentRefreshStates);
    const nextAccounts = accountsRes.status === 'fulfilled'
      ? (accountsRes.value.data ?? [])
      : (stale.push('accounts'), currentAccounts);
    const nextAppIds = appIdsRes.status === 'fulfilled'
      ? (appIdsRes.value.data ?? [])
      : (stale.push('App IDs'), currentAppIds);
    const nextAppIdUsage = appIdUsageRes.status === 'fulfilled'
      ? (appIdUsageRes.value.data ?? [])
      : (stale.push('App ID usage'), currentAppIdUsage);

    return {
      apps: nextApps,
      refreshStates: nextRefreshStates,
      accounts: nextAccounts,
      appIds: nextAppIds,
      appIdUsage: nextAppIdUsage,
      staleSections: stale,
    };
  }, [accounts, appIdUsage, appIds, apps, refreshStates]);

  const applySnapshot = useCallback((snapshot: InstalledSnapshot) => {
    setApps(snapshot.apps);
    setRefreshStates(snapshot.refreshStates);
    setAccounts(snapshot.accounts);
    setAppIds(snapshot.appIds);
    setAppIdUsage(snapshot.appIdUsage);
    setStaleSections(snapshot.staleSections);
    setLastSnapshotAt(Date.now());
    setUiSnapshot('page:installed', snapshot);
  }, []);

  const reload = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    if (!force && Date.now() - lastLoadedAtRef.current < 400) return;

    inFlightRef.current = true;
    try {
      applySnapshot(await loadSnapshot());
      lastLoadedAtRef.current = Date.now();
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [applySnapshot, loadSnapshot]);

  const scheduleReload = useCallback((force = false) => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void reload(force);
    }, 200);
  }, []);

  usePageRefresh(reload);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void reload(true);
      }
    }, FALLBACK_REFRESH_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [reload]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const sseState = useSSE({
    'job-update': () => { scheduleReload(); },
    'device-update': () => { scheduleReload(); },
    'scheduler-update': () => { scheduleReload(); },
    'app-update': () => { scheduleReload(true); },
  });

  const triggerRefresh = async (appId: string) => {
    try {
      await api.triggerRefresh(appId);
      toast('info', 'Refresh triggered');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Refresh failed'));
    }
  };

  const removeApp = async (app: InstalledApp) => {
    const ok = await confirmDialog({
      title: 'Remove Installed App',
      message: `Remove "${app.appName || app.originalBundleId}" from tracking? This won't uninstall it from the device.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeInstalledApp(app.id);
      toast('success', 'App removed from tracking');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to remove app'));
    }
  };

  const removeOrphanedAppId = async (appId: AppleAppIdRecord) => {
    const ok = await confirmDialog({
      title: 'Delete Orphaned App ID',
      message: `Delete ${appId.bundleId}? This orphaned App ID no longer matches a tracked install and may be consuming Apple account quota.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.deleteAppleAppId(appId.id);
      toast('success', 'Orphaned App ID deleted');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to delete orphaned App ID'));
    }
  };

  const triggerRefreshAll = async () => {
    try {
      const res = await api.triggerRefreshAll();
      toast('success', `Triggered refresh for ${res.data?.triggered ?? 0} apps`);
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Refresh all failed'));
    }
  };

  const deactivateApp = async (app: InstalledApp) => {
    const ok = await confirmDialog({
      title: 'Deactivate Installed App',
      message: `Deactivate "${app.appName || app.originalBundleId}"? This will uninstall it from the device but keep it available for reactivation.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deactivateInstalledApp(app.id);
      toast('success', 'App deactivated');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to deactivate app'));
    }
  };

  const reactivateApp = async (app: InstalledApp) => {
    try {
      await api.reactivateInstalledApp(app.id);
      toast('success', 'App reactivation queued');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to reactivate app'));
    }
  };

  const getRefreshState = (id: string) =>
    refreshStates.find(s => s.installedAppId === id);

  const getAccountLabel = (accountId: string) => {
    const account = accounts.find((entry) => entry.id === accountId);
    if (!account) return `${accountId.slice(0, 8)}...`;
    return account.appleId || account.teamName || `${account.id.slice(0, 8)}...`;
  };

  const appIdConsumersByAccount = useMemo(() => {
    const consumers = new Map<string, AppIdConsumer[]>();

    for (const appId of appIds) {
      const directInstall = apps.find((app) => app.accountId === appId.accountId && app.originalBundleId === appId.originalBundleId);
      const parentInstall = apps.find((app) => app.accountId === appId.accountId && appId.originalBundleId.startsWith(`${app.originalBundleId}.`));

      const entry: AppIdConsumer = directInstall
        ? {
            record: appId,
            kind: directInstall.status === 'deactivated' ? 'deactivated' : 'tracked',
            relatedAppName: directInstall.appName,
          }
        : parentInstall
          ? {
              record: appId,
              kind: 'extension',
              relatedAppName: parentInstall.appName,
            }
          : {
              record: appId,
              kind: 'orphaned',
            };

      const existing = consumers.get(appId.accountId) ?? [];
      existing.push(entry);
      consumers.set(appId.accountId, existing);
    }

    return consumers;
  }, [appIds, apps]);

  const hiddenConsumers = useMemo(
    () => appIds.filter((appId) => !apps.some((app) => app.accountId === appId.accountId && app.originalBundleId === appId.originalBundleId && app.status !== 'deactivated')).length,
    [appIds, apps],
  );

  const feedHealthDetail = staleSections.length > 0
    ? `Using the last successful snapshot while ${staleSections.join(', ')} ${staleSections.length === 1 ? 'retries' : 'retry'}.`
    : 'Direct app-change events update this page, with a 5-second polling fallback if SSE drops.';

  const lastSnapshotLabel = lastSnapshotAt
    ? new Date(lastSnapshotAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null;

  if (loading && apps.length === 0) return <PageLoader message="Loading installed apps..." />;

  const activeApps = apps.filter(app => app.status !== 'deactivated');
  const deactivatedApps = apps.filter(app => app.status === 'deactivated');
  const expiringSoon = activeApps.filter((app) => {
    if (!app.expiresAt) return false;
    return new Date(app.expiresAt).getTime() - Date.now() <= 1000 * 60 * 60 * 24 * 2;
  }).length;

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Installed Fleet"
        title="Track live installs, expiry risk, and recovery actions from one board"
        description="The installed view now shows both tracked installs and the App IDs that actually consume free-account capacity, including extensions and leftover identifiers that were previously invisible."
        actions={(
          <>
            {activeApps.length > 0 && (
              <button onClick={triggerRefreshAll} className="sl-btn-ghost flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5v6h6M19.5 19.5v-6h-6" /><path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 00-13.66-5.66L4.5 6m15 12l-1.84-1.84A8 8 0 014 14" /></svg>
                Refresh All
              </button>
            )}
            {apps.length > 0 && (
              <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Install New
              </button>
            )}
          </>
        )}
        stats={[
          { label: 'Active', value: activeApps.length, tone: 'teal' },
          { label: 'Deactivated', value: deactivatedApps.length, tone: 'slate' },
          { label: 'Expiring Soon', value: expiringSoon, tone: expiringSoon > 0 ? 'amber' : 'sky' },
          { label: 'Hidden Consumers', value: hiddenConsumers, tone: hiddenConsumers > 0 ? 'amber' : 'sky' },
        ]}
      />

      <div className="sl-card flex items-center justify-between gap-3 p-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--sl-text)]">Installed feed health</p>
          <p className="text-[11px] text-[var(--sl-muted)]">{feedHealthDetail}</p>
          {lastSnapshotLabel && (
            <p className="mt-1 text-[11px] text-[var(--sl-muted)]">Last snapshot: {lastSnapshotLabel}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <SSEIndicator state={sseState} />
          {staleSections.length > 0 && (
            <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100">
              Partial snapshot
            </span>
          )}
        </div>
      </div>

      {appIdUsage.length > 0 && (
        <section className="space-y-2">
          <SectionHeading
            eyebrow="Quota"
            title="App ID consumers"
            description="Free-account limits are driven by App IDs, not just the installs listed below. Extensions and leftover identifiers appear here so quota pressure is explainable."
            action={<Link to="/apple" className="sl-btn-ghost !px-3 !py-2 !text-[12px]">Manage in Apple IDs</Link>}
          />

          <div className="grid gap-3 xl:grid-cols-2">
            {appIdUsage.map((usage) => {
              const consumers = (appIdConsumersByAccount.get(usage.accountId) ?? []).sort((left, right) =>
                right.record.createdAt.localeCompare(left.record.createdAt),
              );
              const activeRatio = usage.maxActive > 0 ? Math.min(usage.active / usage.maxActive, 1) : 0;
              const weeklyRatio = usage.maxWeekly > 0 ? Math.min(usage.weeklyCreated / usage.maxWeekly, 1) : 0;

              return (
                <div key={usage.accountId} className="sl-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--sl-text)]">{usage.appleId}</p>
                      <p className="mt-1 text-[11px] text-[var(--sl-muted)]">{accounts.find((account) => account.id === usage.accountId)?.teamName ?? usage.teamId}</p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-[var(--sl-muted)]">
                      {consumers.length} tracked App ID{consumers.length === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <UsageMeter label="Active App IDs" used={usage.active} limit={usage.maxActive} ratio={activeRatio} />
                    <UsageMeter label="Created This Week" used={usage.weeklyCreated} limit={usage.maxWeekly} ratio={weeklyRatio} />
                  </div>

                  <div className="mt-4 space-y-2">
                    {consumers.length === 0 ? (
                      <p className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-2 text-[12px] text-[var(--sl-muted)]">
                        No App IDs tracked for this account.
                      </p>
                    ) : consumers.map((consumer) => (
                      <div key={consumer.record.id} className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-[var(--sl-text)]">{consumer.record.name}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--sl-muted)]">{consumer.record.originalBundleId}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <ConsumerBadge kind={consumer.kind} />
                            {consumer.kind === 'orphaned' && (
                              <button
                                onClick={() => removeOrphanedAppId(consumer.record)}
                                className="sl-btn-danger !px-2.5 !py-1.5 !text-[11px]"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--sl-muted)]">
                          {consumer.kind === 'tracked' && `Visible install: ${consumer.relatedAppName ?? consumer.record.name}`}
                          {consumer.kind === 'deactivated' && `Deactivated install: ${consumer.relatedAppName ?? consumer.record.name}`}
                          {consumer.kind === 'extension' && `Extension App ID created under ${consumer.relatedAppName ?? 'a tracked install'}`}
                          {consumer.kind === 'orphaned' && 'No tracked install currently matches this App ID.'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {apps.length === 0 ? (
        <EmptyState
          title="No installed apps"
          description="Install an app to see it tracked here with expiry monitoring."
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          action={<button onClick={() => openInstall()} className="sl-btn-primary">Install an App</button>}
        />
      ) : (
        <div className="space-y-6 stagger-children">
          <section className="space-y-2">
            <SectionHeading eyebrow="Live Apps" title="Active installs" description={`${activeApps.length} install${activeApps.length === 1 ? '' : 's'} currently tracked across your devices.`} />
            {activeApps.map(app => {
            const refreshState = getRefreshState(app.id);
            const expiresAt = app.expiresAt ? new Date(app.expiresAt) : null;
            const daysLeft = expiresAt
              ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
              : null;
            const isExpiring = daysLeft !== null && daysLeft <= 2;
            const isExpired = daysLeft !== null && daysLeft <= 0;

              return (
              <div key={app.id} className="sl-card sl-card-interactive p-4 animate-fadeInUp group">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--sl-text)] truncate">{app.appName || app.originalBundleId}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[11px] font-mono text-[var(--sl-muted)] truncate max-w-[180px]">{app.originalBundleId}</span>
                      {app.appVersion && <span className="text-[11px] text-[var(--sl-muted)]">v{app.appVersion}</span>}
                      <span className="text-[11px] text-[var(--sl-muted)]">{getAccountLabel(app.accountId)}</span>
                      <span className="text-[11px] text-[var(--sl-muted)]">{app.deviceUdid?.slice(0, 8)}...</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    <button onClick={() => triggerRefresh(app.id)} className="sl-btn-ghost !text-[12px] !px-3 !py-1.5">
                      Refresh
                    </button>
                    <button onClick={() => deactivateApp(app)} className="sl-btn-ghost !text-[12px] !px-3 !py-1.5">
                      Deactivate
                    </button>
                    <button onClick={() => removeApp(app)} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">
                      Remove
                    </button>
                  </div>
                </div>

                {/* Expiry bar */}
                {expiresAt && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className={isExpired ? 'font-semibold text-red-400' : isExpiring ? 'font-semibold text-amber-400' : 'text-[var(--sl-muted)]'}>
                        {isExpired ? 'Expired' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`}
                      </span>
                      <span className="text-[var(--sl-muted)] opacity-60">Expires {expiresAt.toLocaleDateString()}</span>
                    </div>
                    <div className="h-1 bg-[var(--sl-surface-soft)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isExpired ? 'bg-red-500' : isExpiring ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, ((daysLeft ?? 0) / 7) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Auto-refresh indicator */}
                {refreshState && (
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--sl-muted)]">
                    {refreshState.lastRefreshAt && <span>Last refreshed: {new Date(refreshState.lastRefreshAt).toLocaleString()}</span>}
                    {refreshState.lastError && <span className="text-red-400">Error: {refreshState.lastError}</span>}
                  </div>
                )}
              </div>
              );
            })}
          </section>

          {deactivatedApps.length > 0 && (
            <section className="space-y-2">
              <SectionHeading eyebrow="Standby" title="Deactivated installs" description="These stay available for one-click reactivation without losing the app record." />
              {deactivatedApps.map(app => (
                <div key={app.id} className="sl-card p-4 animate-fadeInUp border border-amber-500/15 bg-amber-500/[0.03]">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--sl-text)] truncate">{app.appName || app.originalBundleId}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Deactivated</span>
                        <span className="text-[11px] font-mono text-[var(--sl-muted)] truncate max-w-[200px]">{app.originalBundleId}</span>
                        <span className="text-[11px] text-[var(--sl-muted)]">{getAccountLabel(app.accountId)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <button onClick={() => reactivateApp(app)} className="sl-btn-primary !text-[12px] !px-3 !py-1.5">
                        Reactivate
                      </button>
                      <button onClick={() => removeApp(app)} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  ratio,
}: {
  label: string;
  used: number;
  limit: number;
  ratio: number;
}) {
  const toneClass = ratio >= 1 ? 'bg-red-400' : ratio >= 0.8 ? 'bg-amber-400' : 'bg-[var(--sl-accent)]';

  return (
    <div className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[var(--sl-text)]">{label}</span>
        <span className="text-[var(--sl-muted)]">{used}/{limit}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sl-bg)]">
        <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function ConsumerBadge({ kind }: { kind: AppIdConsumer['kind'] }) {
  const labels: Record<AppIdConsumer['kind'], { text: string; className: string }> = {
    tracked: { text: 'Tracked install', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
    deactivated: { text: 'Deactivated', className: 'border-slate-300/15 bg-white/[0.05] text-slate-200' },
    extension: { text: 'Hidden extension', className: 'border-amber-400/20 bg-amber-400/10 text-amber-200' },
    orphaned: { text: 'Orphaned App ID', className: 'border-rose-400/20 bg-rose-400/10 text-rose-200' },
  };

  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${labels[kind].className}`}>{labels[kind].text}</span>;
}
