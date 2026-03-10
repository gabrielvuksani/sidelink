import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { HelperDoctorSnapshot, HealthSnapshot } from '../../../shared/types';

type DesktopReadinessSnapshot = {
  health: HealthSnapshot | null;
  doctor: HelperDoctorSnapshot | null;
  activeAccountCount: number;
  deviceCount: number;
  issues: string[];
};

const SNAPSHOT_KEY = 'gate:desktop-readiness';

export function DesktopReadinessGate({ children }: { children: ReactNode }) {
  const warmSnapshot = getUiSnapshot<DesktopReadinessSnapshot>(SNAPSHOT_KEY, 15_000);
  const [loading, setLoading] = useState(!warmSnapshot);

  useEffect(() => {
    let cancelled = false;

    const load = async (showOverlay: boolean) => {
      if (showOverlay) {
        setLoading(true);
      }

      const [healthRes, doctorRes, accountsRes, devicesRes] = await Promise.allSettled([
        api.health({ bypassCache: true }),
        api.helperDoctor({ bypassCache: true }),
        api.listAppleAccounts({ bypassCache: true }),
        api.listDevices({ bypassCache: true }),
      ]);

      if (cancelled) {
        return;
      }

      const issues: string[] = [];
      const nextHealth = healthRes.status === 'fulfilled' ? (healthRes.value.data ?? null) : null;
      const nextDoctor = doctorRes.status === 'fulfilled' ? (doctorRes.value.data ?? null) : null;
      const nextAccounts = accountsRes.status === 'fulfilled' ? (accountsRes.value.data ?? []) : [];
      const nextDevices = devicesRes.status === 'fulfilled' ? (devicesRes.value.data ?? []) : [];

      if (healthRes.status === 'rejected') {
        issues.push(getErrorMessage(healthRes.reason, 'Runtime health check failed'));
      }
      if (doctorRes.status === 'rejected') {
        issues.push(getErrorMessage(doctorRes.reason, 'Helper readiness check failed'));
      }
      if (accountsRes.status === 'rejected') {
        issues.push(getErrorMessage(accountsRes.reason, 'Apple account roster failed to load'));
      }
      if (devicesRes.status === 'rejected') {
        issues.push(getErrorMessage(devicesRes.reason, 'Device inventory failed to load'));
      }

      const snapshot: DesktopReadinessSnapshot = {
        health: nextHealth,
        doctor: nextDoctor,
        activeAccountCount: nextAccounts.filter((account) => account.status === 'active').length,
        deviceCount: nextDevices.length,
        issues,
      };

      setUiSnapshot(SNAPSHOT_KEY, snapshot);
      setUiSnapshot('panel:desktop-readiness', {
        health: nextHealth,
        doctor: nextDoctor,
      });

      setLoading(false);
    };

    void load(!warmSnapshot);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading) {
    return <>{children}</>;
  }

  return (
    <div className="sl-modal-overlay !z-[80]" style={{ background: 'none' }}>
      <div className="sl-modal-frame">
        <div className="sl-modal-panel border border-white/10 bg-[var(--sl-bg)] shadow-[0_40px_120px_rgba(2,8,18,0.62)]">
        <div className="shrink-0 relative overflow-hidden border-b border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(14,24,36,0.98),rgba(6,12,18,0.98))] px-4 py-5 sm:px-7 sm:py-6">
          <div className="pointer-events-none absolute -left-20 top-[-4.5rem] h-48 w-48 rounded-full bg-cyan-400/16 blur-3xl" />
          <div className="pointer-events-none absolute right-[-3rem] top-[-2rem] h-40 w-40 rounded-full bg-amber-400/12 blur-3xl" />
          <p className="sl-kicker">Desktop Readiness</p>
          <h2 className="mt-3 text-[1.8rem] font-semibold tracking-[-0.04em] text-[var(--sl-text)]">Preparing the desktop control surface</h2>
          <p className="mt-2 text-[13px] leading-6 text-[var(--sl-muted)]">
            SideLink is validating runtime health, helper availability, Apple signing state, and live device transport before the shell opens.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-5">
            <div className="sl-readiness-loader">
              <span className="sl-readiness-loader-ring sl-readiness-loader-ring-primary" />
              <span className="sl-readiness-loader-ring sl-readiness-loader-ring-secondary" />
              <span className="sl-readiness-loader-core" />
              <span className="sl-readiness-loader-orbit sl-readiness-loader-orbit-cyan" />
              <span className="sl-readiness-loader-orbit sl-readiness-loader-orbit-amber" />
            </div>

            <div className="min-w-[220px] flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">Startup handoff</p>
              <p className="mt-2 text-[15px] font-semibold text-[var(--sl-text)]">Building a complete first snapshot before the shell becomes interactive</p>
              <p className="mt-2 text-[12px] leading-6 text-[var(--sl-muted)]">This avoids partial mount churn and opens the app in a stable, already-checked state.</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-3 min-[480px]:grid-cols-2">
            {[
              { label: 'Runtime health', detail: 'Checking backend availability and uptime.', tone: 'cyan' },
              { label: 'Helper asset', detail: 'Resolving helper IPA and packaged runtime state.', tone: 'emerald' },
              { label: 'Apple signing', detail: 'Loading saved Apple account roster.', tone: 'amber' },
              { label: 'Device transport', detail: 'Refreshing current device visibility.', tone: 'sky' },
            ].map((item) => (
              <div key={item.label} className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full animate-pulse ${item.tone === 'cyan' ? 'bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.55)]' : item.tone === 'emerald' ? 'bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.45)]' : item.tone === 'amber' ? 'bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.45)]' : 'bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.45)]'}`} />
                  <p className="text-[12px] font-semibold text-[var(--sl-text)]">{item.label}</p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--sl-muted)]">{item.detail}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[24px] border border-cyan-400/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.11),rgba(245,158,11,0.06))] px-4 py-4 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.08]">
                <span className="h-2 w-2 rounded-full bg-cyan-200 animate-pulse" />
              </span>
              <div>
                <p className="text-[12px] font-semibold tracking-[0.02em] text-sky-50">Staging the app before first paint</p>
                <p className="mt-1 text-[12px] leading-5 text-sky-100/80">Holding the UI until the first readiness snapshot is complete so the desktop shell opens with stable state instead of partial loading churn.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}