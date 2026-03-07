import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageHeader, PageLoader, EmptyState, SectionHeading } from '../components/Shared';
import type { InstalledApp, AutoRefreshState, DashboardState } from '../../../shared/types';

export default function InstalledPage() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [refreshStates, setRefreshStates] = useState<AutoRefreshState[]>([]);
  const [weeklyUsage, setWeeklyUsage] = useState<DashboardState['weeklyAppIdUsage']>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const confirmDialog = useConfirm();
  const { openInstall } = useInstallModal();

  useEffect(() => { document.title = 'Installed — Sidelink'; }, []);

  const reload = useCallback(async () => {
    const [appsRes, statesRes, dashboardRes] = await Promise.all([
      api.listInstalledApps(),
      api.getAutoRefreshStates().catch(() => ({ data: [] as AutoRefreshState[] })),
      api.dashboard().catch(() => ({ data: { weeklyAppIdUsage: {} } as DashboardState })),
    ]);
    setApps(appsRes.data ?? []);
    setRefreshStates(statesRes.data ?? []);
    setWeeklyUsage(dashboardRes.data?.weeklyAppIdUsage ?? {});
    setLoading(false);
  }, []);

  usePageRefresh(reload);

  const triggerRefresh = async (appId: string) => {
    try {
      await api.triggerRefresh(appId);
      toast('info', 'Refresh triggered');
      reload();
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
      reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to remove app'));
    }
  };

  const triggerRefreshAll = async () => {
    try {
      const res = await api.triggerRefreshAll();
      toast('success', `Triggered refresh for ${res.data?.triggered ?? 0} apps`);
      reload();
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
      reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to deactivate app'));
    }
  };

  const reactivateApp = async (app: InstalledApp) => {
    try {
      await api.reactivateInstalledApp(app.id);
      toast('success', 'App reactivation queued');
      reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to reactivate app'));
    }
  };

  const getRefreshState = (id: string) =>
    refreshStates.find(s => s.installedAppId === id);

  if (loading) return <PageLoader message="Loading installed apps..." />;

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
        description="The installed view now behaves like a fleet dashboard: refresh active apps, keep expiring installs visible, and preserve deactivated items for fast reactivation."
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
        ]}
      />

      {Object.keys(weeklyUsage ?? {}).length > 0 && (
        <div className="sl-card p-3">
          <p className="text-[12px] font-semibold text-[var(--sl-text)]">Weekly Free Account App ID Usage</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.values(weeklyUsage ?? {}).map((entry) => (
              <span key={entry.accountId} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                {entry.accountId.slice(0, 8)}...: {entry.used}/{entry.limit}
              </span>
            ))}
          </div>
        </div>
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
