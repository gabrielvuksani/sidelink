import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { useElectron } from '../hooks/useElectron';
import { HelperPairingPanel } from './HelperPairingPanel';
import { useDesktopHealth } from '../hooks/useDesktopHealth';

const TEAM_SOURCE_LABELS: Record<string, string> = {
  request: 'Manual override',
  env: 'Environment',
  'apple-account-authenticated': 'Connected Apple account',
  'apple-account-any': 'Saved Apple account',
  'xcode-signing-identity': 'Xcode signing identity',
  none: 'Not detected',
};

// ─── Shared sub-components ──────────────────────────────────────────

function SigningTeamSection({
  detectedTeamId,
  detectedTeamIdSource,
  overrideTeamId,
  setOverrideTeamId,
  teamId,
  setTeamId,
  infoSlot,
}: {
  detectedTeamId: string | null | undefined;
  detectedTeamIdSource: string | null | undefined;
  overrideTeamId: boolean;
  setOverrideTeamId: (v: boolean) => void;
  teamId: string;
  setTeamId: (v: string) => void;
  infoSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-[24px] border border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(14,165,233,0.08),rgba(255,255,255,0.02))] p-4 sm:p-5">
      <div className={infoSlot ? 'flex flex-wrap items-start justify-between gap-3' : ''}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Signing team</p>
          <p className="mt-2 font-mono text-sm text-[var(--sl-text)]">{detectedTeamId ?? 'Unavailable'}</p>
          <p className="mt-1 text-[11px] text-[var(--sl-muted)]">Source: {TEAM_SOURCE_LABELS[detectedTeamIdSource ?? 'none']}</p>
        </div>
        {infoSlot}
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--sl-muted)]">
        <input
          type="checkbox"
          checked={overrideTeamId}
          onChange={(event) => setOverrideTeamId(event.target.checked)}
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
            onChange={(event) => setTeamId(event.target.value.toUpperCase())}
            className="sl-input max-w-full sm:max-w-xs font-mono uppercase"
          />
        </div>
      )}
    </div>
  );
}

function ActionButtons({
  onProvision,
  running,
  secondaryAction,
  className = '',
}: {
  onProvision: () => void;
  running: boolean;
  secondaryAction: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-2 min-[420px]:grid-cols-2 ${className}`}>
      <button
        onClick={onProvision}
        disabled={running}
        className="sl-btn-secondary flex items-center justify-center gap-2"
      >
        {running && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
        {running ? 'Provisioning\u2026' : 'Provision helper'}
      </button>
      {secondaryAction}
    </div>
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

// ─── Main component ─────────────────────────────────────────────────

export function HelperControlPanel({
  variant = 'settings',
  embedded = false,
}: {
  variant?: 'settings' | 'overview';
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { info } = useElectron();
  const [teamId, setTeamId] = useState('');
  const [overrideTeamId, setOverrideTeamId] = useState(false);
  const [running, setRunning] = useState(false);
  const [pairingOpenSignal, setPairingOpenSignal] = useState(0);
  const { data, loading, error, refresh } = useDesktopHealth({
    autoRefreshMs: 15_000,
    snapshotKey: 'desktop-health',
    warmTtlMs: 15_000,
  });

  const doctor = data?.helper.doctor ?? null;
  const pairing = data?.helper.pairing ?? null;
  const readinessIssues = data?.readiness.issues ?? [];

  useEffect(() => {
    if (doctor?.detectedTeamId && !teamId) {
      setTeamId(doctor.detectedTeamId);
    }
  }, [doctor?.detectedTeamId, teamId]);

  const ensureHelper = async () => {
    setRunning(true);
    try {
      const response = await api.ensureHelperIpa(overrideTeamId ? teamId.trim() || undefined : undefined);
      const helper = response.data;
      if (helper?.built) {
        toast('success', `Helper built and imported as ${helper.importedIpa.bundleName}`);
      } else {
        toast('success', `Helper imported as ${helper?.importedIpa.bundleName ?? 'SidelinkHelper'}`);
      }
      await refresh({ bypassCache: true });
    } catch (nextError: unknown) {
      toast('error', getErrorMessage(nextError, 'Failed to ensure helper IPA'));
    } finally {
      setRunning(false);
    }
  };

  const platform = doctor?.platform ?? info.platform;
  const canBuild = platform === 'darwin';

  const copy = variant === 'overview'
    ? {
        title: 'iPhone helper',
        subtitle: 'Build health, pairing, and helper import now sit on the same truth source as the rest of the desktop diagnostics.',
      }
    : {
        title: 'iOS Helper',
        subtitle: 'Pairing state, packaged helper readiness, and macOS build controls now stay aligned with the desktop runtime.',
      };

  const overviewStatuses = [
    { label: 'Helper asset', ok: !!doctor?.helperIpaExists, detail: doctor?.helperIpaExists ? 'Ready' : 'Missing' },
    { label: 'Apple runtime', ok: doctor?.appleAuthReady !== false, detail: doctor?.appleAuthReady === false ? 'Needs repair' : 'Ready' },
    { label: 'Pairing', ok: !!pairing?.paired, detail: pairing?.paired ? 'Connected' : 'Waiting' },
  ];

  const pairingSubtitle = pairing?.paired
    ? `Current token source: ${pairing.tokenSource === 'env' ? 'environment override' : 'desktop pairing'}${pairing.pairedAt ? ` \u00b7 paired ${new Date(pairing.pairedAt).toLocaleString()}` : ''}`
    : 'Generate a fresh desktop code, keep the backend address visible, and use QR only when camera handoff is genuinely faster.';

  const signingTeamProps = {
    detectedTeamId: doctor?.detectedTeamId,
    detectedTeamIdSource: doctor?.detectedTeamIdSource,
    overrideTeamId,
    setOverrideTeamId,
    teamId,
    setTeamId,
  };

  const overviewControlSurface = (
    <>
      <div className="grid gap-2 min-[440px]:grid-cols-3 text-xs">
        {overviewStatuses.map((status) => (
          <div key={status.label} className={`rounded-[22px] border px-3 py-3 sm:px-4 sm:py-4 ${status.ok ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100' : 'border-amber-400/20 bg-amber-400/[0.08] text-amber-100'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">{status.label}</p>
            <p className="mt-2 text-[13px] font-semibold">{status.detail}</p>
          </div>
        ))}
      </div>

      {canBuild ? (
        <SigningTeamSection
          {...signingTeamProps}
          infoSlot={
            <div className="rounded-2xl border border-white/8 bg-black/10 px-3 py-2.5 text-[11px] leading-5 text-[var(--sl-muted)]">
              Build, import, and pairing now read from the same live readiness state instead of diverging across separate widgets.
            </div>
          }
        />
      ) : (
        <p className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 text-xs leading-5 text-[var(--sl-muted)]">
          Helper build and export stay macOS + Xcode only. This overview keeps import and pairing controls visible without dragging build-only setup into other workflows.
        </p>
      )}

      <ActionButtons
        onProvision={ensureHelper}
        running={running}
        secondaryAction={
          <button
            type="button"
            onClick={() => setPairingOpenSignal((current) => current + 1)}
            disabled={loading}
            className="sl-btn-ghost justify-center"
          >
            {pairing?.paired ? 'Repair pairing' : 'Pair iPhone'}
          </button>
        }
      />
    </>
  );

  const body = (
    <div className={`space-y-4 ${embedded ? 'p-0' : 'p-4 sm:p-5'}`}>
      {loading && !doctor ? (
        <p className="text-xs text-[var(--sl-muted)]">Loading helper diagnostics...</p>
      ) : variant === 'overview' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.88fr),minmax(340px,1.12fr)] 2xl:grid-cols-[minmax(300px,0.82fr),minmax(380px,1.18fr)] xl:items-start">
          <div className="space-y-4">
            {overviewControlSurface}
          </div>
          <HelperPairingPanel
            paired={!!pairing?.paired}
            compact
            layout="feature"
            autoRefresh={false}
            presentation="modal-only"
            defaultModal="code"
            openSignal={pairingOpenSignal}
            showOpenButton={false}
            title="Pair or repair your helper connection"
            subtitle={pairing?.paired
              ? `Paired${pairing.pairedAt ? ` on ${new Date(pairing.pairedAt).toLocaleString()}` : ''}. Open a fresh code only when you want to repair or move the helper connection.`
              : 'Open the short code or QR from dedicated modals without stretching the overview widget into a long onboarding stack.'}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2 text-xs min-[430px]:grid-cols-2">
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

          {readinessIssues.length > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs leading-6 text-amber-100">
              {readinessIssues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          )}

          {canBuild && <SigningTeamSection {...signingTeamProps} />}

          {!canBuild && (
            <p className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 text-xs leading-5 text-[var(--sl-muted)]">
              Helper build/export is macOS + Xcode only. On this OS, SideLink can still import a bundled or prebuilt helper IPA automatically.
            </p>
          )}

          <ActionButtons
            onProvision={ensureHelper}
            running={running}
            className="xl:flex xl:flex-wrap"
            secondaryAction={
              <button
                onClick={() => { void refresh({ bypassCache: true }); }}
                disabled={loading}
                className="sl-btn-ghost justify-center xl:justify-start"
              >
                Refresh
              </button>
            }
          />

          <HelperPairingPanel
            paired={!!pairing?.paired}
            compact={false}
            title={pairing?.paired ? 'Repair or move helper pairing' : 'Pair your iPhone helper'}
            subtitle={pairingSubtitle}
          />

          {doctor?.helperIpaPath && (
            <p className="text-[11px] text-[var(--sl-muted)]">
              Resolved helper path: <span className="font-mono text-[var(--sl-text)]">{doctor.helperIpaPath}</span>
            </p>
          )}
        </>
      )}
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <section className={`sl-card overflow-hidden p-0 ${variant === 'overview' ? 'dashboard-widget dashboard-widget-featured' : 'min-w-0'}`}>
      <div className="border-b border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-[var(--sl-text)]">{copy.title}</h3>
            <p className="mt-1 max-w-lg text-[12px] leading-5 text-[var(--sl-muted)]">{copy.subtitle}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-[11px] ${pairing?.paired ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-sky-400/20 bg-sky-400/10 text-sky-200'}`}>
            {pairing?.paired ? 'Paired' : 'Pairing required'}
          </span>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-[12px] text-red-300 sm:px-5">
          {error}
        </div>
      )}

      {body}
    </section>
  );
}
