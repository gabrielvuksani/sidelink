import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { useSSE } from '../hooks/useSSE';
import { StatusBadge } from './Shared';
import type { AppleAccount, IpaArtifact, DeviceInfo, InstallJob, JobLogEntry, PipelineStep, DashboardState } from '../../../shared/types';
import { STORAGE_KEYS, UI_LIMITS } from '../../../shared/constants';


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
  const [accounts, setAccounts] = useState<AppleAccount[]>([]);
  const [ipas, setIpas] = useState<IpaArtifact[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedIpa, setSelectedIpa] = useState(preselect.ipaId ?? '');
  const [selectedDevice, setSelectedDevice] = useState(preselect.deviceUdid ?? '');
  const [includeExtensions, setIncludeExtensions] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [activeJob, setActiveJob] = useState<InstallJob | null>(null);
  const [error, setError] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const [jobLogs, setJobLogs] = useState<JobLogEntry[]>([]);
  const [showVerboseLogs, setShowVerboseLogs] = useState(true);
  const [weeklyUsage, setWeeklyUsage] = useState<DashboardState['weeklyAppIdUsage']>({});
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      api.listAppleAccounts(),
      api.listIpas(),
      api.listDevices(),
      api.dashboard().catch(() => ({ data: { weeklyAppIdUsage: {} } as DashboardState })),
    ]).then(([accts, ipaList, devList, dashboard]) => {
      const activeAccounts = (accts.data ?? []).filter(a => a.status === 'active');
      const lastAccountId = localStorage.getItem(STORAGE_KEYS.lastInstallAccountId) ?? '';
      const lastDeviceUdid = localStorage.getItem(STORAGE_KEYS.lastInstallDeviceUdid) ?? '';
      setAccounts(activeAccounts);
      setIpas(ipaList.data ?? []);
      setDevices(devList.data ?? []);
      setWeeklyUsage(dashboard.data?.weeklyAppIdUsage ?? {});
      // Prefer last successful selections, then fallback to first available.
      if (activeAccounts.some(account => account.id === lastAccountId)) {
        setSelectedAccount(lastAccountId);
      } else if (activeAccounts.length > 0) {
        setSelectedAccount(activeAccounts[0].id);
      }
      if ((ipaList.data ?? []).length === 1 && !preselect.ipaId) setSelectedIpa((ipaList.data ?? [])[0].id);
      if (devList.data?.some(device => device.udid === lastDeviceUdid) && !preselect.deviceUdid) {
        setSelectedDevice(lastDeviceUdid);
      } else if ((devList.data ?? []).length === 1 && !preselect.deviceUdid) {
        setSelectedDevice((devList.data ?? [])[0].udid);
      }
    }).finally(() => setLoading(false));
  }, [preselect.ipaId, preselect.deviceUdid]);

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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed')) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, activeJob]);

  // SSE for job updates
  useSSE({
    'job-update': (data) => {
      const job = data as InstallJob;
      if (activeJob && job?.id === activeJob.id) {
        setActiveJob(job);
        if (job.status === 'completed') {
          toast('success', 'App installed successfully!');
        }
        if (job.status === 'failed') {
          toast('error', job.error ?? 'Installation failed');
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
    try {
      const res = await api.startInstall({
        accountId: selectedAccount,
        ipaId: selectedIpa,
        deviceUdid: selectedDevice,
        includeExtensions,
      });
      setActiveJob(res.data ?? null);
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

  const canInstall = selectedAccount && selectedIpa && selectedDevice && !installing && !activeJob;
  const selectedIpaObj = ipas.find(i => i.id === selectedIpa);
  const selectedDeviceObj = devices.find(d => d.udid === selectedDevice);
  const selectedAccountObj = accounts.find((account) => account.id === selectedAccount);
  const selectedWeeklyUsage = selectedAccount ? weeklyUsage?.[selectedAccount] : undefined;
  const freeLimitReached = !!selectedAccountObj
    && selectedAccountObj.accountType === 'free'
    && !!selectedWeeklyUsage
    && selectedWeeklyUsage.used >= selectedWeeklyUsage.limit;
  const jobDone = activeJob && (activeJob.status === 'completed' || activeJob.status === 'failed');
  const readinessIssues = [
    ipas.length === 0 ? 'Upload an IPA before starting a quick install.' : null,
    devices.length === 0 ? 'Connect a device before starting a quick install.' : null,
    accounts.length === 0 ? 'Add and verify an active Apple ID before installing.' : null,
    !selectedIpa && ipas.length > 0 ? 'Select an IPA to install.' : null,
    !selectedDevice && devices.length > 0 ? 'Select a target device.' : null,
    !selectedAccount && accounts.length > 0 ? 'Select an Apple account.' : null,
    freeLimitReached ? 'This free account has reached its weekly App ID limit.' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fadeIn"
        onClick={() => (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') && onClose()}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-lg sl-card shadow-2xl animate-fadeInUp overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--sl-border)]">
          <h2 className="text-base font-semibold text-[var(--sl-text)]">Install App</h2>
          <button
            onClick={() => { if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') onClose(); }}
            className={`transition-colors p-1 ${activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed' ? 'text-[var(--sl-muted)] opacity-30 cursor-not-allowed' : 'text-[var(--sl-muted)] hover:text-[var(--sl-text)]'}`}
            disabled={!!activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed'}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[var(--sl-accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeJob ? (
          /* Pipeline progress view */
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--sl-muted)]">Pipeline Progress</span>
              <StatusBadge status={activeJob.status} />
            </div>
            <div className="space-y-2">
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

            {/* 2FA input */}
            {activeJob.status === 'waiting_2fa' && (
              <div className="sl-card !border-amber-500/15 !bg-amber-500/[0.04] p-4 mt-3">
                <p className="text-amber-300 text-[13px] font-semibold mb-2">2FA Code Required</p>
                <div className="flex gap-2">
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
                  <button onClick={handle2FASubmit} disabled={twoFACode.length < 6 || submitting2FA} className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500">
                    {submitting2FA ? 'Verifying...' : 'Submit'}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {activeJob.error && activeJob.status !== 'waiting_2fa' && (
              <div className="sl-card !border-red-500/15 !bg-red-500/[0.04] p-3">
                <p className="text-red-400 text-[13px]">{activeJob.error}</p>
              </div>
            )}

            {/* Done actions */}
            {jobDone && (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 sl-btn-ghost"
                >
                  Close
                </button>
                {activeJob.status === 'failed' && (
                  <>
                    <button
                      onClick={() => { setActiveJob(null); setError(''); }}
                      className="flex-1 sl-btn-primary"
                    >
                      Try Again
                    </button>
                    <a
                      href="/logs"
                      className="flex-1 sl-btn-ghost text-center"
                    >
                      View Logs
                    </a>
                  </>
                )}
              </div>
            )}

            <div className="border border-[var(--sl-border)] bg-[var(--sl-bg)] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowVerboseLogs((prev) => !prev)}
                className="w-full px-3 py-2 text-left text-[12px] text-[var(--sl-muted)] hover:text-[var(--sl-text)] hover:bg-[var(--sl-surface-soft)] transition-colors"
              >
                {showVerboseLogs ? '\u25be' : '\u25b8'} Verbose Install Log ({jobLogs.length})
              </button>
              {showVerboseLogs && (
                <div className="max-h-52 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed bg-black/40">
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
          <div className="p-6 space-y-4">
            {/* IPA selection */}
            <div>
              <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">App to Install</label>
              {ipas.length === 0 ? (
                <p className="text-xs text-amber-400">No IPAs uploaded yet</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
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

            {/* Device selection */}
            <div>
              <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">Target Device</label>
              {devices.length === 0 ? (
                <p className="text-xs text-amber-400">No devices connected</p>
              ) : (
                <div className="space-y-1.5">
                  {devices.map(d => (
                    <button
                      key={d.udid}
                      onClick={() => setSelectedDevice(d.udid)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all ${
                        selectedDevice === d.udid
                          ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-500/30'
                          : 'bg-[var(--sl-surface-soft)] hover:bg-[var(--sl-surface-raised)]'
                      }`}
                    >
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
                      {selectedDevice === d.udid && (
                        <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Account selection (only if multiple) */}
            {accounts.length > 1 && (
              <div>
                <label className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider block mb-2">Apple Account</label>
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  className="sl-input w-full"
                >
                  <option value="">Select account...</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.appleId} ({a.accountType})</option>
                  ))}
                </select>
                {selectedWeeklyUsage && (
                  <p className="mt-1 text-[11px] text-amber-300/90">
                    Weekly App IDs used: {selectedWeeklyUsage.used}/{selectedWeeklyUsage.limit}
                  </p>
                )}
              </div>
            )}
            {accounts.length === 0 && (
              <p className="text-xs text-amber-400">No active Apple ID. Add one in Apple ID settings.</p>
            )}

            {accounts.length === 1 && selectedAccountObj && (
              <div className="sl-card p-3">
                <p className="text-[11px] font-semibold text-[var(--sl-muted)] uppercase tracking-wider">Apple Account</p>
                <p className="mt-1 text-[13px] text-[var(--sl-text)]">{selectedAccountObj.appleId}</p>
                <p className="text-[11px] text-[var(--sl-muted)]">{selectedAccountObj.teamName} · {selectedAccountObj.accountType}</p>
                {selectedWeeklyUsage && (
                  <p className="mt-2 text-[11px] text-amber-300/90">
                    Weekly App IDs used: {selectedWeeklyUsage.used}/{selectedWeeklyUsage.limit}
                  </p>
                )}
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
                    Each extension uses an App ID slot. Free accounts have a limit of 3 active apps.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="sl-card !border-red-500/15 !bg-red-500/[0.04] p-3">
                <p className="text-red-400 text-[13px]">{error}</p>
              </div>
            )}

            {readinessIssues.length > 0 && !error && (
              <div className="sl-card !border-amber-500/20 !bg-amber-500/[0.06] p-3">
                <ul className="space-y-1 text-amber-300 text-[12px]">
                  {readinessIssues.map((issue) => (
                    <li key={issue}>• {issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {freeLimitReached && (
              <div className="sl-card !border-amber-500/20 !bg-amber-500/[0.06] p-3">
                <p className="text-amber-300 text-[12px]">
                  This free account has reached its weekly App ID limit. Switch accounts or wait for the weekly window reset.
                </p>
              </div>
            )}

            {/* Summary + Install button */}
            <div className="pt-2">
              {selectedIpaObj && selectedDeviceObj && (
                <p className="text-[12px] text-[var(--sl-muted)] mb-3 text-center">
                  Install <span className="text-[var(--sl-text)]">{selectedIpaObj.bundleName ?? selectedIpaObj.originalName}</span> on <span className="text-[var(--sl-text)]">{selectedDeviceObj.name || 'iOS Device'}</span>
                </p>
              )}
              <button
                onClick={install}
                disabled={!canInstall || freeLimitReached}
                className="w-full sl-btn-primary disabled:opacity-40 disabled:cursor-not-allowed py-3"
              >
                {installing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting...
                  </span>
                ) : 'Install'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (status === 'running') return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 bg-[var(--sl-accent)] rounded-full animate-pulse" /></span>;
  if (status === 'waiting_2fa') return <svg className="w-4 h-4 text-amber-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>;
  if (status === 'failed') return <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 border border-[var(--sl-muted)] rounded-full" /></span>;
}
