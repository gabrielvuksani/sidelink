import { Link } from 'react-router-dom';
import { useElectron } from '../hooks/useElectron';
import { useDesktopHealth } from '../hooks/useDesktopHealth';

export function DesktopReadinessPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { info } = useElectron();
  const { data, loading, error, refresh } = useDesktopHealth({
    autoRefreshMs: 15_000,
    snapshotKey: 'desktop-health',
    warmTtlMs: 15_000,
  });

  const isPackaged = info.isElectron && info.isPackaged;
  const isMac = info.platform === 'darwin';
  const doctor = data?.helper.doctor;
  const pairing = data?.helper.pairing;
  const activeAccountCount = data?.accounts.active ?? 0;
  const deviceCount = data?.devices.total ?? 0;
  const helperReady = !!doctor?.helperIpaExists;
  const helperPaired = !!pairing?.paired;
  const appleRuntimeReady = doctor?.appleAuthReady !== false;
  const signingReady = activeAccountCount > 0 && appleRuntimeReady;
  const devicesReady = deviceCount > 0;
  const runtimeReady = data?.runtime.status === 'ok';
  const overallReady = data?.readiness.overall ?? false;
  const readinessIssues = data?.readiness.issues ?? [];
  const runtimeLabel = info.isElectron
    ? `${isPackaged ? 'Packaged desktop' : 'Development desktop'}${info.version !== '0.0.0' ? ` · v${info.version}` : ''}`
    : 'Browser preview';
  const pairedAtLabel = pairing?.pairedAt ? formatTimestamp(pairing.pairedAt) : null;

  const body = (
    <div className={`space-y-4 ${embedded ? 'p-0' : 'p-4 sm:p-5'}`}>
      <div className="grid gap-3 min-[420px]:grid-cols-2">
        <StatusTile
          label="Desktop runtime"
          title={runtimeLabel}
          detail={loading ? 'Checking backend health...' : runtimeReady ? `Backend healthy${data ? ` · uptime ${formatUptime(data.runtime.uptime)}` : ''}` : 'Runtime health could not be confirmed.'}
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
          title={
            !appleRuntimeReady
              ? 'Packaged Apple runtime unhealthy'
              : signingReady
                ? `${activeAccountCount} active signing account${activeAccountCount === 1 ? '' : 's'}`
                : 'No active Apple ID'
          }
          detail={
            !appleRuntimeReady
              ? (doctor?.appleAuthError ?? 'Apple sign-in will fail until the packaged helper runtime is healthy.')
              : signingReady
                ? 'Apple account state is sufficient for provisioning and installs.'
                : 'Connect or re-authenticate an Apple ID before expecting installs to work.'
          }
          ok={signingReady}
        />
        <StatusTile
          label="Helper pairing"
          title={helperPaired ? 'iPhone helper paired' : 'Helper not paired'}
          detail={helperPaired
            ? `Token source: ${pairing?.tokenSource === 'env' ? 'environment override' : 'desktop pairing'}${pairedAtLabel ? ` · paired ${pairedAtLabel}` : ''}`
            : 'Generate a fresh pairing code and pair or repair the iPhone helper from Settings or onboarding.'}
          ok={helperPaired}
        />
        <StatusTile
          label="Device transport"
          title={devicesReady ? `${deviceCount} live device${deviceCount === 1 ? '' : 's'} detected` : 'No devices detected'}
          detail={devicesReady ? 'USB or network transport is visible to the device service.' : isMac ? 'Trust prompts, USB stack readiness, or local transport discovery still need attention on this Mac.' : 'No device transport is currently visible to the runtime.'}
          ok={devicesReady}
        />
      </div>

      <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Focused diagnosis</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--sl-text)]">
              {overallReady
                ? 'The desktop runtime, helper path, signing roster, and device transport all look healthy from the overview.'
                : 'The DMG should not feel mysteriously broken anymore. The gaps below point at what is actually missing.'}
            </p>
          </div>
          {helperPaired ? (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200">Helper paired</span>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">Helper not paired</span>
          )}
        </div>

        <div className="mt-4 grid gap-2 min-[420px]:grid-cols-2 xl:flex xl:flex-wrap">
          {!signingReady && <Link to="/apple" className="sl-btn-primary !px-3.5 !py-2 !text-[12px]">Open Apple IDs</Link>}
          {!devicesReady && <Link to="/devices" className="sl-btn-primary !px-3.5 !py-2 !text-[12px]">Open Devices</Link>}
          {(!helperReady || !helperPaired) && <Link to="/settings" className="sl-btn-ghost !px-3.5 !py-2 !text-[12px]">Open Helper Settings</Link>}
          <button onClick={() => { void refresh({ bypassCache: true }); }} className="sl-btn-ghost !px-3.5 !py-2 !text-[12px]">Refresh Health</button>
        </div>
      </div>

      {!error && readinessIssues.length > 0 && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-[12px] leading-6 text-amber-100">
          {readinessIssues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-[12px] leading-5 text-red-100">
          {error}
        </div>
      )}

      {!error && doctor?.appleAuthError && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-[12px] leading-5 text-amber-100">
          Apple auth runtime: {doctor.appleAuthError}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <section className="sl-card dashboard-widget dashboard-widget-featured overflow-hidden">
      <div className="border-b border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] px-4 py-4 sm:px-5">
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

      {body}
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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}