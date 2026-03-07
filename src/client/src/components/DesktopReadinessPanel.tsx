import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useElectron } from '../hooks/useElectron';

type HelperDoctorSnapshot = {
  platform: string;
  helperIpaPath: string;
  helperIpaExists: boolean;
  helperProjectDir: string;
  xcodeProjectExists: boolean;
  projectYmlExists: boolean;
  hasXcodebuild: boolean;
  hasXcodegen: boolean;
  helperPaired?: boolean;
  detectedTeamId?: string | null;
  detectedTeamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
};

type HealthSnapshot = {
  status: string;
  uptime: number;
};

export function DesktopReadinessPanel({
  activeAccountCount,
  deviceCount,
}: {
  activeAccountCount: number;
  deviceCount: number;
}) {
  const { info } = useElectron();
  const [doctor, setDoctor] = useState<HelperDoctorSnapshot | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [healthRes, doctorRes] = await Promise.all([
          api.health(),
          api.helperDoctor(),
        ]);

        if (cancelled) return;
        setHealth(healthRes.data ?? null);
        setDoctor(doctorRes.data ?? null);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to load desktop readiness diagnostics'));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isPackaged = info.isElectron && info.isPackaged;
  const isMac = info.platform === 'darwin';
  const helperReady = !!doctor?.helperIpaExists;
  const helperPaired = !!doctor?.helperPaired;
  const signingReady = activeAccountCount > 0;
  const devicesReady = deviceCount > 0;
  const runtimeReady = health?.status === 'ok';
  const overallReady = runtimeReady && helperReady && signingReady && devicesReady;
  const runtimeLabel = info.isElectron
    ? `${isPackaged ? 'Packaged desktop' : 'Development desktop'}${info.version !== '0.0.0' ? ` · v${info.version}` : ''}`
    : 'Browser preview';

  return (
    <section className="sl-card overflow-hidden">
      <div className="border-b border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="sl-section-label">Desktop Readiness</p>
            <h3 className="mt-1 text-[15px] font-semibold tracking-tight text-[var(--sl-text)]">Make packaged runtime problems visible before users hit dead ends</h3>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--sl-muted)]">
              This panel keeps runtime health, helper availability, Apple account readiness, and live device transport in the same place the operator is already watching installs.
            </p>
          </div>
          <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${overallReady ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'}`}>
            {overallReady ? 'Ready' : 'Needs attention'}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile
            label="Desktop runtime"
            title={runtimeLabel}
            detail={loading ? 'Checking backend health...' : runtimeReady ? `Backend healthy${health ? ` · uptime ${formatUptime(health.uptime)}` : ''}` : 'Runtime health could not be confirmed.'}
            ok={!!runtimeReady}
          />
          <StatusTile
            label="Helper asset"
            title={helperReady ? 'Bundled helper IPA detected' : 'Helper IPA missing'}
            detail={loading ? 'Resolving helper path...' : helperReady ? doctor?.helperIpaPath ?? 'Helper IPA available.' : 'The desktop shell cannot import or build the helper IPA from the current runtime.'}
            ok={helperReady}
          />
          <StatusTile
            label="Apple signing"
            title={signingReady ? `${activeAccountCount} active signing account${activeAccountCount === 1 ? '' : 's'}` : 'No active Apple ID'}
            detail={signingReady ? 'Apple account state is sufficient for provisioning and installs.' : 'Connect or re-authenticate an Apple ID before expecting installs to work.'}
            ok={signingReady}
          />
          <StatusTile
            label="Device transport"
            title={devicesReady ? `${deviceCount} live device${deviceCount === 1 ? '' : 's'} detected` : 'No devices detected'}
            detail={devicesReady ? 'USB or network transport is visible to the device service.' : isMac ? 'Trust prompts, USB stack readiness, or local transport discovery still need attention on this Mac.' : 'No device transport is currently visible to the runtime.'}
            ok={devicesReady}
          />
        </div>

        <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Focused diagnosis</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--sl-text)]">
                {helperReady && helperPaired && signingReady && devicesReady
                  ? 'The desktop runtime, helper path, signing roster, and device transport all look healthy from the overview.'
                  : 'The DMG should not feel “mysteriously broken” anymore. The gaps below point at what is actually missing.'}
              </p>
            </div>
            {helperPaired ? (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200">Helper paired</span>
            ) : (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">Helper not paired</span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!signingReady && <Link to="/apple" className="sl-btn-primary !px-3.5 !py-2 !text-[12px]">Open Apple IDs</Link>}
            {!devicesReady && <Link to="/devices" className="sl-btn-primary !px-3.5 !py-2 !text-[12px]">Open Devices</Link>}
            {(!helperReady || !helperPaired) && <Link to="/settings" className="sl-btn-ghost !px-3.5 !py-2 !text-[12px]">Open Helper Settings</Link>}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-[12px] leading-5 text-red-100">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusTile({
  label,
  title,
  detail,
  ok,
}: {
  label: string;
  title: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-4 ${ok ? 'border-emerald-400/20 bg-emerald-400/[0.06]' : 'border-amber-400/20 bg-amber-400/[0.07]'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">{label}</p>
        <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-300'}`} />
      </div>
      <p className="mt-3 text-[14px] font-semibold text-[var(--sl-text)]">{title}</p>
      <p className="mt-2 text-[12px] leading-5 text-[var(--sl-muted)]">{detail}</p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(1, Math.floor(seconds))}s`;
}