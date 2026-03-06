import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageLoader, EmptyState } from '../components/Shared';
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

  useEffect(() => { reload(); }, [reload]);

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

  const getRefreshState = (id: string) =>
    refreshStates.find(s => s.installedAppId === id);

  if (loading) return <PageLoader message="Loading installed apps..." />;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--sl-text)]">Installed</h2>
          <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Apps installed on your devices</p>
        </div>
        {apps.length > 0 && (
          <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Install New
          </button>
        )}
      </div>

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
        <div className="space-y-2 stagger-children">
          {apps.map(app => {
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
        </div>
      )}
    </div>
  );
}
