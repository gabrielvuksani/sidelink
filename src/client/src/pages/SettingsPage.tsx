import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import { isElectron } from '../lib/electron';
import { useElectron } from '../hooks/useElectron';
import { HelperPairingPanel } from '../components/HelperPairingPanel';
import type { SchedulerSnapshot } from '../../../shared/types';



export default function SettingsPage() {
  useEffect(() => { document.title = 'Settings — SideLink'; }, []);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-xl font-bold text-[var(--sl-text)]">Settings</h2>
        <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Auto-refresh, desktop updates, and helper automation</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SchedulerSettings />
        <PasswordChange />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {isElectron && <AppUpdateSection />}
        <HelperSection />
      </div>

      <SystemInfo />
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="sl-card p-5">
      <div className="mb-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">{title}</h3>
        {subtitle && <p className="mt-1 text-[12px] text-[var(--sl-muted)]">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function SchedulerSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval_] = useState(30);
  const { toast } = useToast();

  useEffect(() => {
    api.getScheduler().then(r => {
      const c: SchedulerSnapshot | undefined = r.data;
      setEnabled(c?.enabled ?? false);
      setInterval_(Math.round((c?.checkIntervalMs ?? 1_800_000) / 60_000));
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateScheduler({ enabled, checkIntervalMs: interval * 60_000 });
      toast('success', 'Scheduler settings saved');
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to update scheduler'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Panel title="Auto-Refresh" subtitle="Keep free-account installs renewed before expiry.">
      <div className="space-y-4">
        <label className="flex items-center gap-3 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-2.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--sl-border)] bg-transparent text-[var(--sl-accent)] focus:ring-[var(--sl-accent)]"
          />
          <span className="text-sm text-[var(--sl-text)]">Enable automatic app refresh</span>
        </label>

        <div>
          <label htmlFor="sched-interval" className="mb-1.5 block text-xs text-[var(--sl-muted)]">Check interval (minutes)</label>
          <input
            id="sched-interval"
            type="number"
            min={1}
            max={1440}
            value={interval}
            onChange={e => setInterval_(Number(e.target.value))}
            className="sl-input !w-36"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="sl-btn-primary flex items-center gap-2"
        >
          {saving && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Panel>
  );
}

function PasswordChange() {
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    if (newPwd !== confirmPwd) {
      toast('error', 'Passwords do not match');
      return;
    }
    if (newPwd.length < 8) {
      toast('error', 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(current, newPwd);
      toast('success', 'Password changed. Redirecting to login...');
      setTimeout(() => { window.location.reload(); }, 1200);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to change password'));
      setLoading(false);
    }
  };

  return (
    <Panel title="Security" subtitle="Rotate dashboard credentials and invalidate old sessions.">
      <div className="space-y-3">
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)} className="sl-input" />
        <input type="password" autoComplete="new-password" placeholder="New password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className="sl-input" />
        <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} className="sl-input" />
        <button
          onClick={submit}
          disabled={loading || !current || !newPwd || !confirmPwd}
          className="sl-btn-ghost flex items-center gap-2"
        >
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--sl-muted)]/40 border-t-[var(--sl-muted)]" />}
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </div>
    </Panel>
  );
}

function HelperSection() {
  const { toast } = useToast();
  const { info } = useElectron();
  const [teamId, setTeamId] = useState('');
  const [overrideTeamId, setOverrideTeamId] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [doctor, setDoctor] = useState<null | {
    platform: string;
    helperIpaPath: string;
    helperIpaExists: boolean;
    helperProjectDir: string;
    xcodeProjectExists: boolean;
    projectYmlExists: boolean;
    hasXcodebuild: boolean;
    hasXcodegen: boolean;
    detectedTeamId?: string | null;
    detectedTeamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
    helperPaired?: boolean;
  }>(null);

  const refreshDoctor = async () => {
    setLoading(true);
    try {
      const res = await api.helperDoctor();
      setDoctor(res.data ?? null);
      const detected = res.data?.detectedTeamId;
      if (detected && !teamId) setTeamId(detected);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to fetch helper diagnostics'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshDoctor();
  }, []);

  const ensureHelper = async () => {
    setRunning(true);
    try {
      const res = await api.ensureHelperIpa(overrideTeamId ? teamId.trim() || undefined : undefined);
      const data = res.data;
      if (data?.built) {
        toast('success', `Helper built and imported as ${data.importedIpa.bundleName}`);
      } else {
        toast('success', `Helper imported as ${data?.importedIpa.bundleName ?? 'SidelinkHelper'}`);
      }
      await refreshDoctor();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to ensure helper IPA'));
    } finally {
      setRunning(false);
    }
  };

  const platform = doctor?.platform ?? info.platform;
  const canBuild = platform === 'darwin';
  const teamSourceLabel: Record<string, string> = {
    request: 'Manual override',
    env: 'Environment',
    'apple-account-authenticated': 'Connected Apple account',
    'apple-account-any': 'Saved Apple account',
    'xcode-signing-identity': 'Xcode signing identity',
    none: 'Not detected',
  };

  return (
    <Panel title="iOS Helper" subtitle="One click helper IPA import, and macOS build/export when required.">
      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-[var(--sl-muted)]">Loading helper diagnostics...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Status label="Helper IPA" ok={!!doctor?.helperIpaExists} />
              <Status label="xcodebuild" ok={!!doctor?.hasXcodebuild || !canBuild} />
              <Status label="Xcode Project" ok={!!doctor?.xcodeProjectExists || !!doctor?.projectYmlExists} />
              <Status label="xcodegen" ok={!!doctor?.hasXcodegen || !!doctor?.xcodeProjectExists || !canBuild} />
            </div>

            {canBuild && (
              <div className="space-y-2">
                <div className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 text-xs">
                  <p className="text-[var(--sl-muted)]">Auto-detected Team ID</p>
                  <p className="mt-1 font-mono text-sm text-[var(--sl-text)]">{doctor?.detectedTeamId ?? 'Unavailable'}</p>
                  <p className="mt-1 text-[11px] text-[var(--sl-muted)]">Source: {teamSourceLabel[doctor?.detectedTeamIdSource ?? 'none']}</p>
                </div>

                <label className="flex items-center gap-2 text-xs text-[var(--sl-muted)]">
                  <input
                    type="checkbox"
                    checked={overrideTeamId}
                    onChange={e => setOverrideTeamId(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--sl-border)] bg-transparent text-[var(--sl-accent)] focus:ring-[var(--sl-accent)]"
                  />
                  Use manual Team ID override
                </label>

                {overrideTeamId && (
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--sl-muted)]">Team ID override</label>
                    <input
                      placeholder="XXXXXXXXXX"
                      value={teamId}
                      onChange={e => setTeamId(e.target.value.toUpperCase())}
                      className="sl-input max-w-xs font-mono uppercase"
                    />
                  </div>
                )}
              </div>
            )}

            {!canBuild && (
              <p className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 text-xs text-[var(--sl-muted)]">
                Helper build/export is macOS + Xcode only. On this OS, SideLink can still import a bundled/prebuilt helper IPA automatically.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={ensureHelper}
                disabled={running}
                className="sl-btn-primary !bg-[var(--sl-accent-2)] flex items-center gap-2"
              >
                {running && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {running ? 'Processing...' : 'One-Click Build / Import'}
              </button>
              <button
                onClick={refreshDoctor}
                disabled={loading}
                className="sl-btn-ghost"
              >
                Refresh
              </button>
            </div>

            <HelperPairingPanel paired={!!doctor?.helperPaired} />

            <div className="flex items-center gap-2 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-2">
              <span className={`inline-block h-2 w-2 rounded-full ${doctor?.helperPaired ? 'bg-green-500' : 'bg-[var(--sl-muted)]'}`} />
              <span className="text-xs text-[var(--sl-text)]">
                {doctor?.helperPaired ? 'iOS helper paired' : 'No iOS helper paired'}
              </span>
            </div>

            {doctor?.helperIpaPath && (
              <p className="text-[11px] text-[var(--sl-muted)]">Resolved helper path: <span className="font-mono text-[var(--sl-text)]">{doctor.helperIpaPath}</span></p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 text-[11px]">{ok ? 'Ready' : 'Needs setup'}</p>
    </div>
  );
}

function SystemInfo() {
  const [uptime, setUptime] = useState<number | null>(null);
  const { info } = useElectron();

  useEffect(() => {
    api.health().then(r => setUptime(r.data?.uptime ?? null)).catch(() => {});
  }, []);

  const formatUptime = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
  };

  const platformLabel = (p: string) => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux', browser: 'Browser' } as Record<string, string>)[p] ?? p;

  return (
    <Panel title="Runtime" subtitle="Cross-platform environment and app diagnostics.">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <InfoRow label="Application" value="SideLink" />
        {info.isElectron && <InfoRow label="Version" value={<span className="font-mono text-xs">{info.version}</span>} />}
        <InfoRow label="Platform" value={platformLabel(info.platform)} />
        <InfoRow label="Runtime" value={info.isElectron ? (info.isPackaged ? 'Desktop (packaged)' : 'Desktop (dev)') : 'Browser'} />
        <InfoRow label="Signing" value="Hybrid (auto/native/typescript)" />
        {uptime !== null && <InfoRow label="Uptime" value={formatUptime(uptime)} />}
      </div>
    </Panel>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-2">
      <span className="text-[var(--sl-muted)]">{label}</span>
      <span className="text-[var(--sl-text)]">{value}</span>
    </div>
  );
}

function AppUpdateSection() {
  const { updater, checkForUpdates, downloadUpdate, installUpdate, info } = useElectron();
  const [checking, setChecking] = useState(false);

  const handleCheck = () => {
    setChecking(true);
    checkForUpdates();
    setTimeout(() => setChecking(false), 10_000);
  };

  useEffect(() => {
    if (updater.status !== 'idle' && updater.status !== 'checking') {
      setChecking(false);
    }
  }, [updater.status]);

  const statusMessages: Record<string, { text: string; color: string }> = {
    idle: { text: 'Click to check for updates', color: 'text-[var(--sl-muted)]' },
    checking: { text: 'Checking for updates...', color: 'text-sky-300' },
    available: { text: `Version ${updater.version ?? '?'} is available`, color: 'text-sky-300' },
    'not-available': { text: 'You are on the latest version', color: 'text-emerald-300' },
    downloading: { text: `Downloading... ${Math.round(updater.percent ?? 0)}%`, color: 'text-sky-300' },
    downloaded: { text: 'Update downloaded. Restart to install.', color: 'text-emerald-300' },
    error: { text: `Error: ${updater.error ?? 'Unknown'}`, color: 'text-rose-300' },
  };

  const msg = statusMessages[updater.status] ?? statusMessages.idle;

  return (
    <Panel title="Desktop Updates" subtitle="Native updater flow for macOS, Windows, and Linux packages.">
      <div className="space-y-3">
        <p className="text-sm text-[var(--sl-text)]">Current version: <span className="font-mono text-xs text-[var(--sl-muted)]">{info.version}</span></p>
        <p className={`text-xs ${msg.color}`}>{msg.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          {updater.status === 'available' && (
            <button onClick={downloadUpdate} className="rounded-xl bg-[var(--sl-accent)] px-3 py-1.5 text-xs font-semibold text-white">Download</button>
          )}
          {updater.status === 'downloaded' && (
            <button onClick={installUpdate} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Restart and Update</button>
          )}
          {(updater.status === 'idle' || updater.status === 'not-available' || updater.status === 'error') && (
            <button onClick={handleCheck} disabled={checking} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-3 py-1.5 text-xs font-medium text-[var(--sl-text)] disabled:opacity-50">
              {checking && <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--sl-muted)]/30 border-t-[var(--sl-muted)]" />}
              Check for Updates
            </button>
          )}
        </div>
        {updater.status === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sl-surface-soft)]">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--sl-accent),var(--sl-accent-2))] transition-all duration-300" style={{ width: `${updater.percent ?? 0}%` }} />
          </div>
        )}
      </div>
    </Panel>
  );
}