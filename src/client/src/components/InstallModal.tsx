import { useState, useEffect, useCallback, createContext, useContext, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api, type AppleAppIdRecord, type AppleAppIdUsageRecord } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useSSE } from '../hooks/useSSE';
import { StatusBadge, StepIcon } from './Shared';
import type { AppleAccount, IpaArtifact, DeviceInfo, InstallJob, JobLogEntry, PipelineStep } from '../../../shared/types';
import { STORAGE_KEYS, UI_LIMITS } from '../../../shared/constants';

const INSTALLER_REFRESH_MS = 5000;
const INSTALLER_WARM_CACHE_MS = 30_000;

type InstallInventorySnapshot = {
  accounts: AppleAccount[];
  ipas: IpaArtifact[];
  devices: DeviceInfo[];
  appIds: AppleAppIdRecord[];
  appIdUsage: AppleAppIdUsageRecord[];
  loadedAt: number;
};

type InstallInventoryData = Omit<InstallInventorySnapshot, 'loadedAt'>;

let lastInstallInventorySnapshot: InstallInventorySnapshot | null = null;

const EMPTY_INSTALL_INVENTORY: InstallInventoryData = {
  accounts: [],
  ipas: [],
  devices: [],
  appIds: [],
  appIdUsage: [],
};

function getWarmInventorySnapshot(): InstallInventorySnapshot | null {
  if (!lastInstallInventorySnapshot) return null;
  if ((Date.now() - lastInstallInventorySnapshot.loadedAt) > INSTALLER_WARM_CACHE_MS) {
    lastInstallInventorySnapshot = null;
    return null;
  }
  return lastInstallInventorySnapshot;
}

function filterActiveAccounts(accounts: AppleAccount[]): AppleAccount[] {
  return accounts.filter((account) => account.status === 'active');
}

function resolveInventorySelection(
  snapshot: Pick<InstallInventorySnapshot, 'accounts' | 'ipas' | 'devices'>,
  current: { accountId: string; ipaId: string; deviceUdid: string },
  preselect: { ipaId?: string; deviceUdid?: string },
) {
  const activeAccounts = filterActiveAccounts(snapshot.accounts);
  const lastAccountId = localStorage.getItem(STORAGE_KEYS.lastInstallAccountId) ?? '';
  const lastDeviceUdid = localStorage.getItem(STORAGE_KEYS.lastInstallDeviceUdid) ?? '';
  const hasMultipleActiveAccounts = activeAccounts.length > 1;

  const accountId = current.accountId && activeAccounts.some((account) => account.id === current.accountId)
    ? current.accountId
    : !hasMultipleActiveAccounts && activeAccounts.some((account) => account.id === lastAccountId)
      ? lastAccountId
      : activeAccounts.length === 1
        ? activeAccounts[0].id
        : '';

  const ipaId = preselect.ipaId && snapshot.ipas.some((ipa) => ipa.id === preselect.ipaId)
    ? preselect.ipaId
    : current.ipaId && snapshot.ipas.some((ipa) => ipa.id === current.ipaId)
      ? current.ipaId
      : snapshot.ipas.length === 1
        ? snapshot.ipas[0].id
        : '';

  const deviceUdid = preselect.deviceUdid && snapshot.devices.some((device) => device.udid === preselect.deviceUdid)
    ? preselect.deviceUdid
    : current.deviceUdid && snapshot.devices.some((device) => device.udid === current.deviceUdid)
      ? current.deviceUdid
      : snapshot.devices.some((device) => device.udid === lastDeviceUdid)
        ? lastDeviceUdid
        : snapshot.devices.length === 1
          ? snapshot.devices[0].udid
          : '';

  return { activeAccounts, accountId, ipaId, deviceUdid };
}


// ── Context for opening the install modal from anywhere ──────────────

interface InstallModalCtx {
  openInstall: (preselect?: { ipaId?: string; deviceUdid?: string }) => void;
}

const InstallModalContext = createContext<InstallModalCtx>({ openInstall: () => {} });

export function useInstallModal() {
  return useContext(InstallModalContext);
}

export function InstallModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [preselect, setPreselect] = useState<{ ipaId?: string; deviceUdid?: string }>({});

  const openInstall = useCallback((pre?: { ipaId?: string; deviceUdid?: string }) => {
    setPreselect(pre ?? {});
    setOpen(true);
  }, []);

  return (
    <InstallModalContext value={{ openInstall }}>
      {children}
      {open && (
        <InstallModal
          preselect={preselect}
          onClose={() => setOpen(false)}
        />
      )}
    </InstallModalContext>
  );
}

// ── The modal itself ─────────────────────────────────────────────────

function InstallModal({
  preselect,
  onClose,
}: {
  preselect: { ipaId?: string; deviceUdid?: string };
  onClose: () => void;
}) {
  const warmInventory = getWarmInventorySnapshot();
  const warmSelection = warmInventory
    ? resolveInventorySelection(
        warmInventory,
        {
          accountId: '',
          ipaId: preselect.ipaId ?? '',
          deviceUdid: preselect.deviceUdid ?? '',
        },
        preselect,
      )
    : null;

  const [inventory, setInventory] = useState<InstallInventoryData>(() => warmInventory
    ? {
        accounts: warmInventory.accounts,
        ipas: warmInventory.ipas,
        devices: warmInventory.devices,
        appIds: warmInventory.appIds,
        appIdUsage: warmInventory.appIdUsage,
      }
    : EMPTY_INSTALL_INVENTORY);
  const [loading, setLoading] = useState(!warmInventory);
  const [refreshingInventory, setRefreshingInventory] = useState(false);

  const [selectedAccount, setSelectedAccount] = useState(warmSelection?.accountId ?? '');
  const [selectedIpa, setSelectedIpa] = useState(warmSelection?.ipaId ?? preselect.ipaId ?? '');
  const [selectedDevice, setSelectedDevice] = useState(warmSelection?.deviceUdid ?? preselect.deviceUdid ?? '');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(() => {
    const initial = warmSelection?.deviceUdid ?? preselect.deviceUdid ?? '';
    return initial ? new Set([initial]) : new Set();
  });
  const [includeExtensions, setIncludeExtensions] = useState(false);
  const [deviceCapabilities, setDeviceCapabilities] = useState<{ hasLiveContainer: boolean; liveContainerBundleId: string | null; totalAppsInstalled: number } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [activeJob, setActiveJob] = useState<InstallJob | null>(null);
  const [error, setError] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const [jobLogs, setJobLogs] = useState<JobLogEntry[]>([]);
  const [showVerboseLogs, setShowVerboseLogs] = useState(true);
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const inventoryRefreshTimerRef = useRef<number | null>(null);
  const inventoryRequestIdRef = useRef(0);
  const inventoryRef = useRef(inventory);
  const selectedAccountRef = useRef(selectedAccount);
  const selectedIpaRef = useRef(selectedIpa);
  const selectedDeviceRef = useRef(selectedDevice);

  const accounts = useMemo(() => filterActiveAccounts(inventory.accounts), [inventory.accounts]);
  const { ipas, devices, appIds, appIdUsage } = inventory;

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    selectedAccountRef.current = selectedAccount;
  }, [selectedAccount]);

  useEffect(() => {
    selectedIpaRef.current = selectedIpa;
  }, [selectedIpa]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
    // Keep multi-select set in sync with resolved single device
    setSelectedDeviceIds((prev) => {
      if (selectedDevice && prev.size === 0) return new Set([selectedDevice]);
      return prev;
    });
  }, [selectedDevice]);

  const applyInventory = useCallback((snapshot: InstallInventoryData) => {
    const nextSelection = resolveInventorySelection(
      snapshot,
      {
        accountId: selectedAccountRef.current,
        ipaId: selectedIpaRef.current,
        deviceUdid: selectedDeviceRef.current,
      },
      preselect,
    );

    inventoryRef.current = snapshot;
    setInventory(snapshot);
    lastInstallInventorySnapshot = {
      ...snapshot,
      loadedAt: Date.now(),
    };

    setSelectedAccount(nextSelection.accountId);
    setSelectedIpa(nextSelection.ipaId);
    setSelectedDevice(nextSelection.deviceUdid);
  }, [preselect]);

  const reloadInventory = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = ++inventoryRequestIdRef.current;
    const currentInventory = inventoryRef.current;
    const shouldShowBlockingLoader = !options?.silent
      && currentInventory.accounts.length === 0
      && currentInventory.ipas.length === 0
      && currentInventory.devices.length === 0;

    if (shouldShowBlockingLoader) {
      setLoading(true);
    } else if (!options?.silent) {
      setRefreshingInventory(true);
    }

    const [accountsRes, ipaRes, deviceRes, appIdsRes, appIdUsageRes] = await Promise.allSettled([
      api.listAppleAccounts(),
      api.listIpas(),
      api.listDevices(),
      api.listAppleAppIds(),
      api.listAppleAppIdUsage(),
    ]);

    if (requestId !== inventoryRequestIdRef.current) return;

    const failures: string[] = [];
    const nextAccounts = accountsRes.status === 'fulfilled' ? (accountsRes.value.data ?? []) : (failures.push('accounts'), currentInventory.accounts);
    const nextIpas = ipaRes.status === 'fulfilled' ? (ipaRes.value.data ?? []) : (failures.push('IPAs'), currentInventory.ipas);
    const nextDevices = deviceRes.status === 'fulfilled' ? (deviceRes.value.data ?? []) : (failures.push('devices'), currentInventory.devices);
    const nextAppIds = appIdsRes.status === 'fulfilled' ? (appIdsRes.value.data ?? []) : (failures.push('App IDs'), currentInventory.appIds);
    const nextAppIdUsage = appIdUsageRes.status === 'fulfilled' ? (appIdUsageRes.value.data ?? []) : (failures.push('App ID usage'), currentInventory.appIdUsage);

    applyInventory({
      accounts: nextAccounts,
      ipas: nextIpas,
      devices: nextDevices,
      appIds: nextAppIds,
      appIdUsage: nextAppIdUsage,
    });

    setLoading(false);
    setRefreshingInventory(false);

    if (failures.length > 0 && !options?.silent) {
      toast('warning', `Some installer data could not be refreshed: ${failures.join(', ')}`);
    }
  }, [applyInventory, toast]);

  const scheduleInventoryReload = useCallback((options?: { silent?: boolean }) => {
    if (inventoryRefreshTimerRef.current !== null) {
      window.clearTimeout(inventoryRefreshTimerRef.current);
    }
    inventoryRefreshTimerRef.current = window.setTimeout(() => {
      inventoryRefreshTimerRef.current = null;
      void reloadInventory(options);
    }, 220);
  }, [reloadInventory]);

  useEffect(() => {
    void reloadInventory({ silent: true });
  }, [reloadInventory]);

  useEffect(() => {
    if (preselect.ipaId) {
      setSelectedIpa(preselect.ipaId);
    }
    if (preselect.deviceUdid) {
      setSelectedDevice(preselect.deviceUdid);
    }
  }, [preselect.ipaId, preselect.deviceUdid]);

  useEffect(() => {
    if (selectedAccount) {
      localStorage.setItem(STORAGE_KEYS.lastInstallAccountId, selectedAccount);
    }
  }, [selectedAccount]);

  useEffect(() => {
    if (selectedDevice) {
      localStorage.setItem(STORAGE_KEYS.lastInstallDeviceUdid, selectedDevice);
    }
  }, [selectedDevice]);

  // Fetch device capabilities when a single device is selected
  useEffect(() => {
    if (selectedDeviceIds.size !== 1) {
      setDeviceCapabilities(null);
      return;
    }
    const udid = Array.from(selectedDeviceIds)[0];
    let cancelled = false;
    api.getDeviceCapabilities(udid)
      .then((res) => {
        if (!cancelled && res.data) setDeviceCapabilities(res.data);
      })
      .catch(() => {
        if (!cancelled) setDeviceCapabilities(null);
      });
    return () => { cancelled = true; };
  }, [selectedDeviceIds]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed')) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, activeJob]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void reloadInventory({ silent: true });
      }
    }, INSTALLER_REFRESH_MS);

    const onFocus = () => { void reloadInventory({ silent: true }); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void reloadInventory({ silent: true });
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadInventory]);

  useEffect(() => () => {
    if (inventoryRefreshTimerRef.current !== null) {
      window.clearTimeout(inventoryRefreshTimerRef.current);
    }
  }, []);

  useBodyScrollLock(true);

  // SSE for job updates and live inventory refreshes
  useSSE({
    'device-update': () => { scheduleInventoryReload({ silent: true }); },
    'app-update': () => { scheduleInventoryReload({ silent: true }); },
    'job-update': (data) => {
      const job = data as InstallJob;
      if (activeJob && job?.id === activeJob.id) {
        setActiveJob(job);
        if (job.status === 'completed') {
          toast('success', 'App installed successfully!');
          void reloadInventory({ silent: true });
        }
        if (job.status === 'failed') {
          toast('error', job.error ?? 'Installation failed');
          void reloadInventory({ silent: true });
        }
      }
    },
    'job-log': (data) => {
      const entry = data as JobLogEntry;
      if (!activeJob || entry.jobId !== activeJob.id) return;
      setJobLogs((prev) => [...prev, entry].slice(-UI_LIMITS.maxJobLogEntries));
    },
  });

  useEffect(() => {
    if (!activeJob) {
      setJobLogs([]);
      return;
    }
    api.getJobLogs(activeJob.id)
      .then((response) => setJobLogs(response.data ?? []))
      .catch(() => setJobLogs([]));
  }, [activeJob?.id]);

  const install = async () => {
    setError('');
    setInstalling(true);
    setActiveJob(null);
    setJobLogs([]);

    const targetDeviceIds = selectedDeviceIds.size > 0
      ? Array.from(selectedDeviceIds)
      : selectedDevice ? [selectedDevice] : [];

    try {
      // Fire one job per selected device
      let firstJob: InstallJob | null = null;
      for (const deviceUdid of targetDeviceIds) {
        const res = await api.startInstall({
          accountId: selectedAccount,
          ipaId: selectedIpa,
          deviceUdid,
          includeExtensions,
        });
        if (!firstJob) firstJob = res.data ?? null;
      }
      setActiveJob(firstJob);
      if (targetDeviceIds.length > 1) {
        toast('info', `Queued install to ${targetDeviceIds.length} device(s)`);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Install failed'));
    } finally {
      setInstalling(false);
    }
  };

  const handle2FASubmit = async () => {
    if (!twoFACode.trim() || !activeJob) return;
    setSubmitting2FA(true);
    try {
      await api.submitJob2FA(activeJob.id, twoFACode.trim());
      toast('success', '2FA code submitted — resuming install');
      setTwoFACode('');
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, '2FA submission failed'));
    } finally {
      setSubmitting2FA(false);
    }
  };

  const deviceCount = selectedDeviceIds.size;
  const canInstall = selectedAccount && selectedIpa && deviceCount > 0 && !installing && !activeJob;
  const selectedIpaObj = ipas.find(i => i.id === selectedIpa);
  const selectedDeviceObj = deviceCount === 1 ? devices.find(d => selectedDeviceIds.has(d.udid)) : null;
  const selectedAccountObj = accounts.find((account) => account.id === selectedAccount);
  const selectedAccountUsage = appIdUsage.find((entry) => entry.accountId === selectedAccount);
  const selectedAccountAppIds = appIds
    .filter((entry) => entry.accountId === selectedAccount)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const requiredOriginalBundleIds = selectedIpaObj
    ? [
        selectedIpaObj.bundleId,
        ...(includeExtensions ? (selectedIpaObj.extensions ?? []).map((extension) => extension.bundleId) : []),
      ]
    : [];
  const existingAppIdOriginalBundleIds = new Set(selectedAccountAppIds.map((entry) => entry.originalBundleId));
  const missingRequiredAppIds = requiredOriginalBundleIds.filter((bundleId) => !existingAppIdOriginalBundleIds.has(bundleId));
  const activeLimitReached = !!selectedAccountObj
    && selectedAccountObj.accountType === 'free'
    && !!selectedAccountUsage
    && missingRequiredAppIds.length > 0
    && selectedAccountUsage.active >= selectedAccountUsage.maxActive;
  const weeklyLimitReached = !!selectedAccountObj
    && selectedAccountObj.accountType === 'free'
    && !!selectedAccountUsage
    && missingRequiredAppIds.length > 0
    && selectedAccountUsage.weeklyCreated >= selectedAccountUsage.maxWeekly;
  const freeLimitReached = activeLimitReached || weeklyLimitReached;
  const jobDone = activeJob && (activeJob.status === 'completed' || activeJob.status === 'failed');
  const readinessIssues = [
    ipas.length === 0 ? 'Upload an IPA before starting an install.' : null,
    devices.length === 0 ? 'Connect a device before starting an install.' : null,
    accounts.length === 0 ? 'Add and verify an active Apple ID before installing.' : null,
    !selectedIpa && ipas.length > 0 ? 'Select an IPA to install.' : null,
    deviceCount === 0 && devices.length > 0 ? 'Select a target device.' : null,
    !selectedAccount && accounts.length > 0 ? 'Select an Apple account.' : null,
    activeLimitReached ? 'This account is at the active App ID limit for the selected install.' : null,
    weeklyLimitReached ? 'This free account has reached its weekly App ID creation limit for the selected install.' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="sl-modal-overlay z-[92] animate-fadeIn">
      <div
        className="absolute inset-0"
        onClick={() => (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') && onClose()}
      />

      <div className="sl-modal-frame">
        <div
          ref={panelRef}
          className="sl-modal-panel sl-modal-panel-wide relative flex h-[min(920px,calc(100dvh-1.5rem))] w-full flex-col overflow-hidden sl-card shadow-2xl animate-fadeInUp sm:h-[min(920px,calc(100dvh-2.5rem))]"
        >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

        <div className="relative shrink-0 overflow-hidden border-b border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(18,30,40,0.98),rgba(8,14,22,0.98))] px-4 py-5 sm:px-7">
          <div className="pointer-events-none absolute -left-16 top-[-3.5rem] h-40 w-40 rounded-full bg-indigo-400/12 blur-3xl" />
          <div className="pointer-events-none absolute right-[-2rem] top-[-1.5rem] h-32 w-32 rounded-full bg-teal-400/10 blur-3xl" />
          <div className="sl-modal-header">
          <div>
            <p className="sl-kicker">Install Pipeline</p>
            <h2 className="mt-3 text-[1.3rem] font-semibold tracking-[-0.04em] text-[var(--sl-text)] sm:text-[1.5rem]">Install App</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--sl-muted)]">Select an IPA, target device, and Apple account. Monitor pipeline progress, respond to 2FA, and review logs from one place.</p>
          </div>
          <div className="sl-modal-header-actions items-center sm:justify-end">
            {!activeJob && (
              <button
                onClick={() => { void reloadInventory(); }}
                disabled={refreshingInventory}
                className="sl-btn-ghost sl-btn-sm justify-center"
              >
                {refreshingInventory ? 'Refreshing…' : 'Refresh data'}
              </button>
            )}
          <button
            onClick={() => { if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') onClose(); }}
            className="sl-btn-ghost sl-btn-sm justify-center"
            disabled={!!activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed'}
            aria-label="Close"
          >
            Close
          </button>
          </div>
        </div>
        </div>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-16 sm:px-6">
            <div className="w-6 h-6 border-2 border-[var(--sl-accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeJob ? (
          /* Pipeline progress view */
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 sm:p-7">
            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">Pipeline Progress</p>
                <StatusBadge status={activeJob.status} />
              </div>
              <div className="mt-4 space-y-2">
                {(activeJob.steps ?? []).map((step: PipelineStep, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <StepIcon status={step.status === 'running' && activeJob.status === 'waiting_2fa' ? 'waiting_2fa' : step.status} />
                  <span className={`text-[13px] ${
                    step.status === 'running'
                      ? (activeJob.status === 'waiting_2fa' ? 'text-amber-400' : 'text-indigo-400')
                      : step.status === 'completed' ? 'text-emerald-400'
                      : step.status === 'failed' ? 'text-red-400'
                      : 'text-[var(--sl-muted)]'
                  }`}>
                    {step.name}
                    {step.name === 'authenticate' && activeJob.status === 'waiting_2fa' && (
                      <span className="text-amber-400 ml-1">— waiting for 2FA</span>
                    )}
                  </span>
                  {step.error && (
                    <span className="text-xs text-red-400 ml-auto truncate max-w-[200px]">{step.error}</span>
                  )}
                </div>
              ))}
              </div>
            </div>

            {/* 2FA input */}
            {activeJob.status === 'waiting_2fa' && (
              <div className="rounded-[24px] border border-amber-500/15 bg-amber-500/[0.04] p-4 sm:p-5">
                <p className="text-amber-300 text-[13px] font-semibold mb-3">2FA Code Required</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={twoFACode}
                    onChange={e => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => e.key === 'Enter' && handle2FASubmit()}
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                    className="sl-input flex-1 text-center text-lg font-mono tracking-[0.3em]"
                  />
                  <button onClick={handle2FASubmit} disabled={twoFACode.length < 6 || submitting2FA} className="sl-btn-secondary">
                    {submitting2FA ? 'Verifying...' : 'Submit'}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {activeJob.error && activeJob.status !== 'waiting_2fa' && (
              <div className="sl-card sl-card-red p-3">
                <p className="text-red-400 text-[13px]">{activeJob.error}</p>
              </div>
            )}

            {/* Done actions */}
            {jobDone && (
              <div className="sl-modal-footer-actions pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 sl-btn-ghost justify-center"
                >
                  Close
                </button>
                {activeJob.status === 'failed' && (
                  <>
                    <button
                      onClick={() => { setActiveJob(null); setError(''); }}
                      className="flex-1 sl-btn-primary justify-center"
                    >
                      Try Again
                    </button>
                    <a
                      href="/logs"
                      className="flex-1 sl-btn-ghost justify-center text-center"
                    >
                      View Logs
                    </a>
                  </>
                )}
              </div>
            )}

            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-bg)] overflow-hidden">
              <button
                onClick={() => setShowVerboseLogs((prev) => !prev)}
                className="w-full px-4 py-3 text-left text-[12px] text-[var(--sl-muted)] hover:text-[var(--sl-text)] hover:bg-[var(--sl-surface-soft)] transition-colors"
              >
                {showVerboseLogs ? '\u25be' : '\u25b8'} Verbose Install Log ({jobLogs.length})
              </button>
              {showVerboseLogs && (
                <div className="max-h-52 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed bg-black/40">
                  {jobLogs.length === 0 ? (
                    <p className="text-[var(--sl-muted)]">Waiting for pipeline output...</p>
                  ) : jobLogs.map((line) => (
                    <p key={line.id} className={line.level === 'error' ? 'text-red-300' : line.level === 'warn' ? 'text-amber-300' : line.level === 'debug' ? 'text-slate-400' : 'text-[var(--sl-text)]'}>
                      [{new Date(line.at).toLocaleTimeString()}]
                      {line.step ? ` [${line.step}]` : ''} {line.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Selection form */
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 sm:p-7">
            {refreshingInventory && (
              <div className="rounded-[20px] border border-sky-400/20 bg-sky-400/[0.06] px-4 py-2.5 text-[12px] text-sky-100">
                Refreshing installer inventory…
              </div>
            )}
            {/* IPA selection */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr),minmax(300px,0.8fr)]">
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">App to Install</label>
                  {ipas.length === 0 ? (
                    <p className="text-xs text-amber-400">No IPAs uploaded yet</p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {ipas.map(ipa => (
                        <button
                          key={ipa.id}
                          onClick={() => { setSelectedIpa(ipa.id); setIncludeExtensions(false); }}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all ${
                            selectedIpa === ipa.id
                              ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-500/30'
                              : 'bg-[var(--sl-surface-soft)] hover:bg-[var(--sl-surface-raised)]'
                          }`}
                        >
                          {ipa.iconData ? (
                            <img src={`data:image/png;base64,${ipa.iconData}`} alt="" className="w-9 h-9 rounded-lg" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-[var(--sl-surface-soft)] flex items-center justify-center">
                              <svg className="w-4 h-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] text-[var(--sl-text)] truncate">{ipa.bundleName ?? ipa.originalName}</p>
                            <p className="text-[11px] text-[var(--sl-muted)]">{ipa.bundleId} · v{ipa.bundleShortVersion}</p>
                          </div>
                          {selectedIpa === ipa.id && (
                            <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">Target Device{devices.length > 1 ? 's' : ''}</label>
                  {devices.length === 0 ? (
                    <p className="text-xs text-amber-400">No devices connected</p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {devices.length > 1 && (
                        <label className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--sl-surface-soft)] transition-all">
                          <input
                            type="checkbox"
                            checked={selectedDeviceIds.size === devices.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDeviceIds(new Set(devices.map(d => d.udid)));
                                setSelectedDevice(devices[0].udid);
                              } else {
                                setSelectedDeviceIds(new Set());
                                setSelectedDevice('');
                              }
                            }}
                            className="w-4 h-4 rounded border-[var(--sl-border)] text-indigo-500 accent-indigo-500"
                          />
                          <span className="text-[12px] font-medium text-[var(--sl-muted)]">Select All ({devices.length})</span>
                        </label>
                      )}
                      {devices.map(d => {
                        const isSelected = selectedDeviceIds.has(d.udid);
                        return (
                          <label
                            key={d.udid}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-500/30'
                                : 'bg-[var(--sl-surface-soft)] hover:bg-[var(--sl-surface-raised)]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedDeviceIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(d.udid)) {
                                    next.delete(d.udid);
                                  } else {
                                    next.add(d.udid);
                                  }
                                  // Keep single-device state in sync for compatibility
                                  if (next.size === 1) setSelectedDevice(Array.from(next)[0]);
                                  else if (next.size === 0) setSelectedDevice('');
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-[var(--sl-border)] text-indigo-500 accent-indigo-500 shrink-0"
                            />
                            <div className="w-9 h-9 rounded-lg bg-[var(--sl-surface-soft)] flex items-center justify-center">
                              <svg className="w-4 h-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-[var(--sl-text)] truncate">{d.name || 'iOS Device'}</p>
                              <p className="text-[11px] text-[var(--sl-muted)]">
                                {d.transport === 'usb' ? 'USB' : 'WiFi'}
                                {d.iosVersion ? ` · iOS ${d.iosVersion}` : ''}
                                {d.productType ? ` · ${d.productType}` : ''}
                              </p>
                            </div>
                            {isSelected && (
                              <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {deviceCapabilities?.hasLiveContainer && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[12px]">
                      <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-emerald-300">LiveContainer detected — apps installed here can bypass the 3-app limit</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">

                {/* Account selection */}
                <div>
                  <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">Apple Account</label>
                  {accounts.length === 0 ? (
                    <p className="text-xs text-amber-400">No active Apple ID. Add one in Apple ID settings.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {accounts.map(a => {
                        const usage = appIdUsage.find((entry) => entry.accountId === a.id);
                        const needsReAuth = a.status === 'requires_2fa' || a.status === 'session_expired';
                        return (
                          <button
                            key={a.id}
                            onClick={() => setSelectedAccount(a.id)}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all ${
                              selectedAccount === a.id
                                ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-500/30'
                                : needsReAuth
                                  ? 'bg-amber-500/[0.06] hover:bg-amber-500/[0.1]'
                                  : 'bg-[var(--sl-surface-soft)] hover:bg-[var(--sl-surface-raised)]'
                            }`}
                          >
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${needsReAuth ? 'bg-amber-500/10' : 'bg-indigo-500/10'}`}>
                              <svg className={`w-4 h-4 ${needsReAuth ? 'text-amber-400' : 'text-indigo-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-[var(--sl-text)] truncate">{a.appleId}</p>
                              <p className="text-[11px] text-[var(--sl-muted)]">
                                {a.teamName ?? 'Unknown Team'} · {a.accountType}
                                {needsReAuth && <span className="text-amber-400 ml-1">· Re-auth needed</span>}
                              </p>
                              {usage && (
                                <p className="text-[10px] text-[var(--sl-muted)] mt-0.5">
                                  App IDs: {usage.active}/{usage.maxActive} active · {usage.weeklyCreated}/{usage.maxWeekly} this week
                                </p>
                              )}
                            </div>
                            {selectedAccount === a.id && (
                              <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedAccountObj && selectedAccountUsage && (
                  <div className="sl-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)]">App ID pressure</p>
                        <p className="mt-1 text-[12px] text-[var(--sl-text)]">
                          {missingRequiredAppIds.length === 0
                            ? 'This install can reuse existing App IDs.'
                            : `This install still needs ${missingRequiredAppIds.length} new App ID${missingRequiredAppIds.length === 1 ? '' : 's'}.`}
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-[var(--sl-muted)]">
                        {selectedAccountAppIds.length} tracked App ID{selectedAccountAppIds.length === 1 ? '' : 's'}
                      </div>
                    </div>

                    {missingRequiredAppIds.length > 0 && (
                      <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
                        Missing for this install: {missingRequiredAppIds.join(', ')}
                      </div>
                    )}

                    {selectedAccountAppIds.length > 0 && (
                      <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                        {selectedAccountAppIds.map((appId) => (
                          <div key={appId.id} className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-2">
                            <p className="truncate text-[12px] font-semibold text-[var(--sl-text)]">{appId.name}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--sl-muted)]">{appId.originalBundleId}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedAccountObj && !selectedAccountUsage && refreshingInventory && (
                  <div className="sl-card p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)]">App ID pressure</p>
                    <p className="mt-2 text-[12px] text-[var(--sl-muted)]">Loading quota and App ID usage details…</p>
                  </div>
                )}

                {/* Extensions toggle (only when IPA has extensions) */}
                {selectedIpaObj && (selectedIpaObj.extensions?.length ?? 0) > 0 && (
                  <div className="sl-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-[13px] text-[var(--sl-text)] font-medium">Include Extensions</p>
                        <p className="text-[11px] text-[var(--sl-muted)] mt-0.5">
                          {selectedIpaObj.extensions.length} extension{selectedIpaObj.extensions.length > 1 ? 's' : ''} found
                          {selectedIpaObj.extensions.length <= 3 && (
                            <span> ({selectedIpaObj.extensions.map(e => e.name).join(', ')})</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={includeExtensions}
                        onClick={() => setIncludeExtensions(!includeExtensions)}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--sl-accent)]/40 ${
                          includeExtensions ? 'bg-[var(--sl-accent)]' : 'bg-[var(--sl-surface-raised)]'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            includeExtensions ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                    {includeExtensions && (
                      <p className="text-[11px] text-amber-400/80 mt-2">
                        Each extension can require its own App ID. That is why a single visible app can still consume multiple free-account slots.
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <div className="sl-card sl-card-red p-3">
                    <p className="text-red-400 text-[13px]">{error}</p>
                  </div>
                )}

                {readinessIssues.length > 0 && !error && (
                  <div className="sl-card sl-card-amber-strong p-3">
                    <ul className="space-y-1 text-amber-300 text-[12px]">
                      {readinessIssues.map((issue) => (
                        <li key={issue}>• {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {freeLimitReached && (
                  <div className="sl-card sl-card-amber-strong p-3">
                    <p className="text-amber-300 text-[12px]">
                      {activeLimitReached
                        ? 'This install needs new App IDs, but the selected account is already at its active App ID limit. Reuse an existing identifier, delete stale App IDs, or switch accounts.'
                        : 'This install needs new App IDs, but the selected free account has already used its weekly App ID creation quota. Switch accounts or wait for the weekly window reset.'}
                    </p>
                  </div>
                )}

                <div className="rounded-[24px] border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(45,212,191,0.08),rgba(10,18,27,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">Install summary</p>
                  {selectedIpaObj && deviceCount > 0 ? (
                    <>
                      <p className="mt-3 text-[13px] leading-6 text-[var(--sl-muted)]">
                        Install <span className="font-semibold text-[var(--sl-text)]">{selectedIpaObj.bundleName ?? selectedIpaObj.originalName}</span> on {deviceCount === 1 && selectedDeviceObj ? (
                          <span className="font-semibold text-[var(--sl-text)]">{selectedDeviceObj.name || 'iOS Device'}</span>
                        ) : (
                          <span className="font-semibold text-[var(--sl-text)]">{deviceCount} device{deviceCount > 1 ? 's' : ''}</span>
                        )}.
                      </p>
                      {selectedAccountObj ? (
                        <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-[12px] leading-6 text-[var(--sl-muted)]">
                          <p>
                            Signing with <span className="font-semibold text-[var(--sl-text)]">{selectedAccountObj.appleId}</span>
                            {' '}on team <span className="font-mono text-[var(--sl-text)]">{selectedAccountObj.teamId}</span>.
                          </p>
                          <p className="mt-1 text-[11px] text-amber-200/90">
                            If iOS later shows &ldquo;Verify App&rdquo;, trust this exact developer profile on the device.
                          </p>
                        </div>
                      ) : accounts.length > 1 ? (
                        <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-3 text-[11px] leading-6 text-amber-200">
                          Choose the Apple account you want to sign with. SideLink no longer guesses when multiple Apple IDs are active.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-3 text-[13px] leading-6 text-[var(--sl-muted)]">Choose an IPA, target device, and Apple account to start the install pipeline.</p>
                  )}
                  <button
                    onClick={install}
                    disabled={!canInstall || freeLimitReached}
                    className="mt-4 w-full sl-btn-primary disabled:opacity-40 disabled:cursor-not-allowed py-3 text-[13px] font-semibold"
                  >
                    {installing ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Starting...
                      </span>
                    ) : deviceCount > 1 ? `Install to ${deviceCount} device(s)` : 'Install App'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
