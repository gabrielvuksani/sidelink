import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import { isElectron } from '../lib/electron';
import { useElectron } from '../hooks/useElectron';
import { HelperControlPanel } from '../components/HelperControlPanel';
import { PageHeader } from '../components/Shared';
import type { SchedulerSnapshot } from '../../../shared/types';



export default function SettingsPage() {
  useEffect(() => { document.title = 'Settings - Sidelink'; }, []);

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Control Center"
        title="Settings that are structured like operations, not forms"
        description="Auto-refresh, helper automation, desktop updates, and runtime diagnostics are grouped by intent so the page reads like a real control surface instead of a dump of toggles."
        stats={[
          { label: 'Refresh', value: 'Automation', tone: 'sky' },
          { label: 'Security', value: 'Credentials', tone: 'amber' },
          { label: 'Helper', value: 'Build + Pair', tone: 'teal' },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SchedulerSettings />
        <HelperControlPanel />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PasswordChange />
        {isElectron ? <AppUpdateSection /> : <SystemInfo />}
      </div>

      {isElectron && <SystemInfo />}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="sl-card overflow-hidden p-0">
      <div className="border-b border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] px-5 py-4">
        <h3 className="text-[14px] font-semibold tracking-tight text-[var(--sl-text)]">{title}</h3>
        {subtitle && <p className="mt-1 max-w-lg text-[12px] leading-5 text-[var(--sl-muted)]">{subtitle}</p>}
      </div>
      <div className="p-5">
        {children}
      </div>
    </section>
  );
}

function MetricChip({ label, value, tone }: { label: string; value: string; tone: 'sky' | 'violet' | 'emerald' }) {
  const toneClass = {
    sky: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
    violet: 'border-violet-400/20 bg-violet-400/10 text-violet-100',
    emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-3 backdrop-blur-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 text-[15px] font-semibold">{value}</p>
    </div>
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
        <InfoRow label="Application" value="Sidelink" />
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