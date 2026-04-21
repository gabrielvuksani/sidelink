import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { SSEIndicator, useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageHeader, PageLoader, EmptyState, SectionHeading, SearchInput, ExpiryBadge, Collapsible } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { InstalledApp, AutoRefreshState, AppleAccount } from '../../../shared/types';
import type { AppleAppIdRecord, AppleAppIdUsageRecord, AppUpdateInfo } from '../lib/api';

type InstalledSnapshot = {
  apps: InstalledApp[];
  refreshStates: AutoRefreshState[];
  accounts: AppleAccount[];
  appIds: AppleAppIdRecord[];
  appIdUsage: AppleAppIdUsageRecord[];
  updates: AppUpdateInfo[];
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
  const [updates, setUpdates] = useState<AppUpdateInfo[]>(warmSnapshot?.data.updates ?? []);
  const [staleSections, setStaleSections] = useState<string[]>(warmSnapshot?.data.staleSections ?? []);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(warmSnapshot?.updatedAt ?? null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const { toast } = useToast();
  const confirmDialog = useConfirm();
  const { openInstall } = useInstallModal();
  const refreshTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const stateRef = useRef<InstalledSnapshot>({
    apps: warmSnapshot?.data.apps ?? [],
    refreshStates: warmSnapshot?.data.refreshStates ?? [],
    accounts: warmSnapshot?.data.accounts ?? [],
    appIds: warmSnapshot?.data.appIds ?? [],
    appIdUsage: warmSnapshot?.data.appIdUsage ?? [],
    updates: warmSnapshot?.data.updates ?? [],
    staleSections: warmSnapshot?.data.staleSections ?? [],
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'expiry' | 'installed'>('name');

  useEffect(() => { document.title = 'Installed — SideLink'; }, []);

  const activeApps = apps.filter(app => app.status !== 'deactivated');
  const deactivatedApps = apps.filter(app => app.status === 'deactivated');
  const expiringSoon = activeApps.filter((app) => {
    if (!app.expiresAt) return false;
    return new Date(app.expiresAt).getTime() - Date.now() <= 1000 * 60 * 60 * 24 * 2;
  }).length;

  const filterApp = useCallback((app: InstalledApp) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (app.appName?.toLowerCase().includes(q) ?? false) || app.originalBundleId.toLowerCase().includes(q);
  }, [searchQuery]);

  const sortApps = useCallback((a: InstalledApp, b: InstalledApp) => {
    if (sortBy === 'expiry') {
      const aExp = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const bExp = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      return aExp - bExp;
    }
    if (sortBy === 'installed') {
      const aDate = a.installedAt ? new Date(a.installedAt).getTime() : 0;
      const bDate = b.installedAt ? new Date(b.installedAt).getTime() : 0;
      return bDate - aDate;
    }
    return (a.appName || a.originalBundleId).localeCompare(b.appName || b.originalBundleId);
  }, [sortBy]);

  const filteredActiveApps = useMemo(() => activeApps.filter(filterApp).sort(sortApps), [activeApps, filterApp, sortApps]);
  const filteredDeactivatedApps = useMemo(() => deactivatedApps.filter(filterApp).sort(sortApps), [deactivatedApps, filterApp, sortApps]);

  const loadSnapshot = useCallback(async (force = false): Promise<InstalledSnapshot> => {
    const currentApps = stateRef.current.apps;
    const currentRefreshStates = stateRef.current.refreshStates;
    const currentAccounts = stateRef.current.accounts;
    const currentAppIds = stateRef.current.appIds;
    const currentAppIdUsage = stateRef.current.appIdUsage;
    const currentUpdates = stateRef.current.updates;

    const [appsRes, statesRes, accountsRes, appIdsRes, appIdUsageRes, updatesRes] = await Promise.allSettled([
      api.listInstalledApps({ bypassCache: force }),
      api.getAutoRefreshStates({ bypassCache: force }),
      api.listAppleAccounts({ bypassCache: force }),
      api.listAppleAppIds(false, { bypassCache: force }),
      api.listAppleAppIdUsage({ bypassCache: force }),
      api.checkAppUpdates({ bypassCache: force }),
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
    const nextUpdates = updatesRes.status === 'fulfilled'
      ? (updatesRes.value.data ?? [])
      : currentUpdates;

    return {
      apps: nextApps,
      refreshStates: nextRefreshStates,
      accounts: nextAccounts,
      appIds: nextAppIds,
      appIdUsage: nextAppIdUsage,
      updates: nextUpdates,
      staleSections: stale,
    };
  }, []);

  const applySnapshot = useCallback((snapshot: InstalledSnapshot) => {
    stateRef.current = snapshot;
    setApps(snapshot.apps);
    setRefreshStates(snapshot.refreshStates);
    setAccounts(snapshot.accounts);
    setAppIds(snapshot.appIds);
    setAppIdUsage(snapshot.appIdUsage);
    setUpdates(snapshot.updates);
    setStaleSections(snapshot.staleSections);
    setLastSnapshotAt(Date.now());
    setUiSnapshot('page:installed', snapshot);
  }, []);

  const reload = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    if (!force && Date.now() - lastLoadedAtRef.current < 400) return;

    inFlightRef.current = true;
    try {
      applySnapshot(await loadSnapshot(force));
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
  }, [reload]);

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 8_000, revalidateOnFocus: false });

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

  const trustProfiles = useMemo(() => {
    const seen = new Set<string>();
    return activeApps
      .map((app) => accounts.find((entry) => entry.id === app.accountId) ?? null)
      .filter((account): account is AppleAccount => {
        if (!account || seen.has(account.id)) return false;
        seen.add(account.id);
        return true;
      });
  }, [accounts, activeApps]);

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

  const feedHealthTone = staleSections.length > 0
    ? 'border-amber-300/15 bg-amber-300/10 text-amber-100'
    : sseState === 'connected'
      ? 'border-emerald-300/15 bg-emerald-300/10 text-emerald-100'
      : 'border-sky-300/15 bg-sky-300/10 text-sky-100';

  const feedHealthHeadline = staleSections.length > 0
    ? 'Partial data'
    : sseState === 'connected'
      ? 'Connected'
      : 'Reconnecting';

  const feedHealthDetail = staleSections.length > 0
    ? `Some data may be outdated while ${staleSections.join(', ')} ${staleSections.length === 1 ? 'reconnects' : 'reconnect'}.`
    : refreshStates.length === 0 && activeApps.length > 0
      ? 'Installed apps are loaded. Refresh schedule details are still syncing.'
      : 'This page updates automatically as changes happen.';

  const lastSnapshotLabel = lastSnapshotAt
    ? new Date(lastSnapshotAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null;

  const [verifyDismissed, setVerifyDismissed] = useState(() => {
    try { return localStorage.getItem('sidelink:verify-banner-dismissed') === '1'; } catch { return false; }
  });

  if (loading && apps.length === 0) return <PageLoader message="Loading installed apps..." />;

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Installed Apps"
        title="Monitor installed apps and auto-refresh status"
        description="View your installed apps, check certificate expiry dates, and manage App ID usage across your accounts."
        actions={(
          <>
            {expiringSoon > 0 && (
              <button
                onClick={async () => {
                  const expiring = activeApps.filter((app) => {
                    if (!app.expiresAt) return false;
                    return new Date(app.expiresAt).getTime() - Date.now() <= 1000 * 60 * 60 * 24 * 2;
                  });
                  toast('info', `Refreshing ${expiring.length} expiring app${expiring.length === 1 ? '' : 's'}...`);
                  await Promise.allSettled(expiring.map((app) => api.triggerRefresh(app.id)));
                  void reload(true);
                }}
                className="sl-btn-ghost flex items-center gap-2 border-amber-400/20 text-amber-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
                Refresh {expiringSoon} Expiring
              </button>
            )}
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
          { label: 'Updates', value: updates.length, tone: updates.length > 0 ? 'sky' : 'slate' },
        ]}
      />

      <Collapsible title={
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--sl-text)]">Connection status</span>
          <SSEIndicator state={sseState} />
          {staleSections.length > 0 && (
            <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100">
              Partial data
            </span>
          )}
        </div>
      }>
        <div className="sl-card p-3 mt-2">
          <p className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${feedHealthTone}`}>
            {feedHealthHeadline}
          </p>
          <p className="mt-1 text-[11px] text-[var(--sl-muted)]">{feedHealthDetail}</p>
          {lastSnapshotLabel && (
            <p className="mt-1 text-[11px] text-[var(--sl-muted)]">Last updated: {lastSnapshotLabel}</p>
          )}
          <p className="mt-1 text-[11px] text-[var(--sl-muted)]">
            {apps.length} tracked app{apps.length === 1 ? '' : 's'} • {refreshStates.length} refresh state{refreshStates.length === 1 ? '' : 's'} • {appIdUsage.length} quota record{appIdUsage.length === 1 ? '' : 's'}
          </p>
        </div>
      </Collapsible>

      {appIdUsage.length > 0 && (
        <Collapsible title={<SectionHeading eyebrow="Quota" title="App ID usage" description="App IDs used by your installed apps and their impact on free account limits." action={<Link to="/apple" className="sl-btn-ghost sl-btn-sm">Manage in Apple IDs</Link>} />}>
        <section className="space-y-2 mt-2">

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
                                className="sl-btn-danger sl-btn-xs"
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
        </Collapsible>
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
          {!verifyDismissed && (
          <div className="sl-card sl-card-amber px-4 py-3">
            <div className="flex items-start gap-2.5">
              <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              <div className="space-y-1.5 text-[12px] text-[var(--sl-muted)] leading-relaxed flex-1">
                <p>
                  <span className="text-amber-300 font-semibold">Seeing &ldquo;Verify App&rdquo;?</span>{' '}
                  Open <strong className="text-[var(--sl-text)]">Settings → General → VPN &amp; Device Management</strong> on your device and trust the exact developer profile that signed the app. This is required once per signing certificate.
                </p>
                {trustProfiles.length > 0 && (
                  <p>
                    Current installs are signed by{' '}
                    {trustProfiles.map((account, index) => (
                      <span key={account.id}>
                        <strong className="text-[var(--sl-text)]">{account.appleId}</strong>
                        {' '}(<span className="font-mono text-[var(--sl-text)]">{account.teamId}</span>)
                        {index < trustProfiles.length - 2 ? ', ' : index === trustProfiles.length - 2 ? ' and ' : ''}
                      </span>
                    ))}.
                    {trustProfiles.length > 1 ? ' Trust the matching profile for the app you installed.' : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setVerifyDismissed(true); try { localStorage.setItem('sidelink:verify-banner-dismissed', '1'); } catch {} }}
                className="text-[var(--sl-muted)] hover:text-[var(--sl-text)] shrink-0 mt-0.5 transition-colors"
                title="Dismiss banner"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          )}
          {/* Search & Sort Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Filter by name or bundle ID..." />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-0.5">
              {([['name', 'Name'], ['expiry', 'Expiry'], ['installed', 'Newest']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    sortBy === key
                      ? 'bg-[var(--sl-accent)] text-white shadow-sm'
                      : 'text-[var(--sl-muted)] hover:text-[var(--sl-text)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <section className="space-y-2">
            <SectionHeading eyebrow="Live Apps" title="Active installs" description={`${filteredActiveApps.length} of ${activeApps.length} install${activeApps.length === 1 ? '' : 's'} shown.`} />
            {filteredActiveApps.map(app => {
            const refreshState = getRefreshState(app.id);
            const appUpdate = updates.find(u => u.installedAppId === app.id);

              return (
              <div key={app.id} className="sl-card sl-card-interactive p-4 animate-fadeInUp group">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[var(--sl-accent)]/20 to-[var(--sl-accent-2)]/20 flex items-center justify-center shrink-0">
                      <span className="text-[15px] font-bold text-[var(--sl-accent)]">{(app.appName || app.originalBundleId).charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-[var(--sl-text)] truncate">{app.appName || app.originalBundleId}</p>
                        {app.expiresAt && <ExpiryBadge expiresAt={app.expiresAt} />}
                        {appUpdate && (
                          <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
                            Update v{appUpdate.availableVersion}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[11px] font-mono text-[var(--sl-muted)] truncate max-w-[220px]">{app.originalBundleId}</span>
                        {app.appVersion && <span className="text-[11px] text-[var(--sl-muted)]">v{app.appVersion}</span>}
                        <span className="text-[11px] text-[var(--sl-muted)]">{getAccountLabel(app.accountId)}</span>
                        {app.deviceUdid && <span className="text-[11px] text-[var(--sl-muted)]">{app.deviceUdid.slice(0, 8)}...</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => triggerRefresh(app.id)} className="sl-btn-ghost sl-btn-sm" title="Refresh signing">
                      <svg className="w-3.5 h-3.5 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                      Refresh
                    </button>
                    <button onClick={() => deactivateApp(app)} className="sl-btn-ghost sl-btn-sm">
                      Deactivate
                    </button>
                    <button onClick={() => removeApp(app)} className="sl-btn-danger sl-btn-xs">
                      Remove
                    </button>
                  </div>
                </div>

                {/* Expiry bar */}
                {app.expiresAt && (() => {
                  const expiresAt = new Date(app.expiresAt);
                  const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  const isExpiring = daysLeft <= 2;
                  const isExpired = daysLeft <= 0;
                  return (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-[var(--sl-muted)] opacity-60">Expires {expiresAt.toLocaleDateString()}</span>
                      </div>
                      <div className="h-1 bg-[var(--sl-surface-soft)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isExpired ? 'bg-red-500' : isExpiring ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, (daysLeft / 7) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

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

          {filteredDeactivatedApps.length > 0 && (
            <section className="space-y-2">
              <SectionHeading eyebrow="Standby" title="Deactivated installs" description="These stay available for one-click reactivation without losing the app record." />
              {filteredDeactivatedApps.map(app => (
                <div key={app.id} className="sl-card p-4 animate-fadeInUp border border-amber-500/15 bg-amber-500/[0.03]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                        <span className="text-[15px] font-bold text-amber-300">{(app.appName || app.originalBundleId).charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--sl-text)] truncate">{app.appName || app.originalBundleId}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Deactivated</span>
                          <span className="text-[11px] font-mono text-[var(--sl-muted)] truncate max-w-[200px]">{app.originalBundleId}</span>
                          <span className="text-[11px] text-[var(--sl-muted)]">{getAccountLabel(app.accountId)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => reactivateApp(app)} className="sl-btn-primary sl-btn-sm">
                        Reactivate
                      </button>
                      <button onClick={() => removeApp(app)} className="sl-btn-danger sl-btn-xs">
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
