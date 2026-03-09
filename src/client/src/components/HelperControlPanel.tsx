import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { useElectron } from '../hooks/useElectron';
import { HelperPairingPanel } from './HelperPairingPanel';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';

type HelperDoctorSnapshot = {
  platform: string;
  helperIpaPath: string;
  helperIpaExists: boolean;
  helperProjectDir: string;
  xcodeProjectExists: boolean;
  projectYmlExists: boolean;
  hasXcodebuild: boolean;
  hasXcodegen: boolean;
  appleAuthReady?: boolean;
  appleAuthError?: string | null;
  helperPaired?: boolean;
  detectedTeamId?: string | null;
  detectedTeamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
};

export function HelperControlPanel({
  variant = 'settings',
}: {
  variant?: 'settings' | 'overview';
}) {
  const { toast } = useToast();
  const { info } = useElectron();
  const snapshotKey = `panel:helper-control:${variant}`;
  const warmSnapshot = getUiSnapshot<HelperDoctorSnapshot | null>(snapshotKey);
  const [teamId, setTeamId] = useState('');
  const [overrideTeamId, setOverrideTeamId] = useState(false);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [running, setRunning] = useState(false);
  const [doctor, setDoctor] = useState<HelperDoctorSnapshot | null>(warmSnapshot?.data ?? null);

  const refreshDoctor = async () => {
    setLoading(true);
    try {
      const res = await api.helperDoctor();
      const nextDoctor = res.data ?? null;
      setDoctor(nextDoctor);
      setUiSnapshot(snapshotKey, nextDoctor);
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
  }, [snapshotKey]);

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

  const copy = variant === 'overview'
    ? {
        title: 'iPhone helper',
        subtitle: 'Keep helper readiness, code-first pairing, and import actions in one tighter control surface instead of splitting them across separate cards.',
      }
    : {
        title: 'iOS Helper',
        subtitle: 'One click helper IPA import, and macOS build/export when required.',
      };

  const overviewStatuses = [
    { label: 'Helper asset', ok: !!doctor?.helperIpaExists, detail: doctor?.helperIpaExists ? 'Ready' : 'Missing' },
    { label: 'Apple runtime', ok: doctor?.appleAuthReady !== false, detail: doctor?.appleAuthReady === false ? 'Needs repair' : 'Ready' },
    { label: 'Pairing', ok: !!doctor?.helperPaired, detail: doctor?.helperPaired ? 'Connected' : 'Waiting' },
  ];

  return (
    <section className="sl-card overflow-hidden p-0">
      <div className="border-b border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-[var(--sl-text)]">{copy.title}</h3>
            <p className="mt-1 max-w-lg text-[12px] leading-5 text-[var(--sl-muted)]">{copy.subtitle}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${doctor?.helperPaired ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-sky-400/20 bg-sky-400/10 text-sky-200'}`}>
            {doctor?.helperPaired ? 'Paired' : 'Pairing required'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {loading ? (
          <p className="text-xs text-[var(--sl-muted)]">Loading helper diagnostics...</p>
        ) : (
          <>
            {variant === 'overview' ? (
              <div className="grid gap-2 sm:grid-cols-3 text-xs">
                {overviewStatuses.map((status) => (
                  <div key={status.label} className={`rounded-2xl border px-3 py-3 ${status.ok ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100' : 'border-amber-400/20 bg-amber-400/[0.08] text-amber-100'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">{status.label}</p>
                    <p className="mt-2 text-[13px] font-semibold">{status.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <HelperStatus label="Helper IPA" ok={!!doctor?.helperIpaExists} />
                  <HelperStatus label="xcodebuild" ok={!!doctor?.hasXcodebuild || !canBuild} />
                  <HelperStatus label="Xcode Project" ok={!!doctor?.xcodeProjectExists || !!doctor?.projectYmlExists} />
                  <HelperStatus label="xcodegen" ok={!!doctor?.hasXcodegen || !!doctor?.xcodeProjectExists || !canBuild} />
                </div>

                <div className={`rounded-2xl border px-4 py-3 text-xs leading-5 ${doctor?.appleAuthReady === false ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100'}`}>
                  <p className="font-semibold uppercase tracking-[0.18em]">Apple Auth Runtime</p>
                  <p className="mt-2">
                    {doctor?.appleAuthReady === false
                      ? (doctor.appleAuthError ?? 'The packaged Apple helper runtime is not healthy.')
                      : 'The packaged Apple helper runtime passed its local readiness checks.'}
                  </p>
                </div>
              </>
            )}

            {canBuild && (
              <div className="space-y-3 rounded-2xl border border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(14,165,233,0.08),rgba(255,255,255,0.02))] p-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Signing team</p>
                  <p className="mt-2 font-mono text-sm text-[var(--sl-text)]">{doctor?.detectedTeamId ?? 'Unavailable'}</p>
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
              <p className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 text-xs leading-5 text-[var(--sl-muted)]">
                Helper build/export is macOS + Xcode only. On this OS, SideLink can still import a bundled or prebuilt helper IPA automatically.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={ensureHelper}
                disabled={running}
                className="sl-btn-primary !bg-[var(--sl-accent-2)] flex items-center gap-2"
              >
                {running && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {running ? 'Processing...' : 'One-Click Build / Import'}
              </button>
              <button
                onClick={() => { void refreshDoctor(); }}
                disabled={loading}
                className="sl-btn-ghost"
              >
                Refresh
              </button>
            </div>

            <HelperPairingPanel
              paired={!!doctor?.helperPaired}
              compact={variant === 'overview'}
              title={variant === 'overview' ? 'Pair or repair your helper connection' : undefined}
              subtitle={variant === 'overview'
                ? 'Enter the short code from the iPhone first. Open QR only when camera handoff is the faster route.'
                : undefined}
            />

            {variant !== 'overview' && doctor?.helperIpaPath && (
              <p className="text-[11px] text-[var(--sl-muted)]">
                Resolved helper path: <span className="font-mono text-[var(--sl-text)]">{doctor.helperIpaPath}</span>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function HelperStatus({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 text-[11px]">{ok ? 'Ready' : 'Needs setup'}</p>
    </div>
  );
}