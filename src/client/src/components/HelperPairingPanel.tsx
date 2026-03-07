import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { UI_LIMITS } from '../../../shared/constants';

interface HelperPairingPanelProps {
  title?: string;
  subtitle?: string;
  paired?: boolean;
  compact?: boolean;
}

export function HelperPairingPanel({
  title = 'Pair your iPhone helper',
  subtitle = 'Open SideLink on your iPhone, choose Pair / Repair, then scan this QR or enter the 6-digit code manually.',
  paired = false,
  compact = false,
}: HelperPairingPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingPayload, setPairingPayload] = useState<string | null>(null);
  const { toast } = useToast();

  const refreshPairing = async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setRefreshing(false);
    } else {
      setRefreshing(true);
    }
    try {
      const res = await api.createHelperPairingCode();
      setPairingCode(res.data?.code ?? null);
      setPairingExpiresAt(res.data?.expiresAt ?? null);
      setPairingPayload(res.data?.qrPayload ?? null);
      if (!options?.silent) {
        toast('success', 'New helper pairing code generated');
      }
    } catch (e: unknown) {
      if (!options?.silent) {
        toast('error', getErrorMessage(e, 'Failed to generate helper pairing code'));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshPairing({ silent: true });

    const interval = window.setInterval(() => {
      void refreshPairing({ silent: true });
    }, UI_LIMITS.pairingCodeRefreshMs);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const expiresLabel = useMemo(() => {
    if (!pairingExpiresAt) return null;
    const expires = new Date(pairingExpiresAt);
    return Number.isNaN(expires.getTime()) ? null : expires.toLocaleTimeString();
  }, [pairingExpiresAt]);

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', successMessage);
    } catch {
      toast('error', 'Clipboard access is unavailable');
    }
  };

  return (
    <div className={`rounded-2xl border border-[var(--sl-border)] ${compact ? 'bg-[var(--sl-surface-soft)] p-4' : 'bg-[var(--sl-surface)] p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${paired ? 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.6)]' : 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.5)]'}`} />
            <h4 className="text-sm font-semibold text-[var(--sl-text)]">{title}</h4>
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--sl-muted)]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {pairingCode && (
            <button
              type="button"
              onClick={() => void copyText(pairingCode, 'Pairing code copied')}
              className="sl-btn-ghost !px-2.5 !py-1.5 !text-[11px]"
            >
              Copy code
            </button>
          )}
          <button
            type="button"
            onClick={() => { void refreshPairing(); }}
            disabled={refreshing}
            className="sl-btn-ghost !px-2.5 !py-1.5 !text-[11px]"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[180px,1fr]">
          <div className="aspect-square rounded-2xl border border-[var(--sl-border)] bg-white/90" />
          <div className="space-y-3">
            <div className="h-5 w-32 animate-pulse rounded bg-[var(--sl-surface-soft)]" />
            <div className="h-20 animate-pulse rounded-2xl bg-[var(--sl-surface-soft)]" />
            <div className="h-24 animate-pulse rounded-2xl bg-[var(--sl-surface-soft)]" />
          </div>
        </div>
      ) : pairingPayload && pairingCode ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[180px,1fr]">
          <div className="rounded-[28px] border border-[var(--sl-border)] bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.18)]">
            <QRCodeSVG value={pairingPayload} size={compact ? 140 : 148} level="M" includeMargin className="h-auto w-full" />
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(8,145,178,0.16),rgba(14,116,144,0.04))] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Pairing code</p>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="font-mono text-3xl font-semibold tracking-[0.28em] text-[var(--sl-text)]">{pairingCode}</p>
                {expiresLabel && <p className="text-[11px] text-[var(--sl-muted)]">Expires at {expiresLabel}</p>}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Scan on iPhone</p>
                <ol className="mt-2 space-y-2 text-[12px] leading-5 text-[var(--sl-text)]">
                  <li>1. Open SideLink on your iPhone.</li>
                  <li>2. Go to Pair / Repair in onboarding or settings.</li>
                  <li>3. Scan this QR to fill the server and pairing code instantly.</li>
                </ol>
              </div>

              <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Manual fallback</p>
                <p className="mt-2 text-[12px] leading-5 text-[var(--sl-text)]">
                  If scanning is unavailable, choose a discovered desktop or type the desktop address, then enter this 6-digit pairing code on your iPhone.
                </p>
                <div className="mt-3 rounded-xl border border-[var(--sl-border)] bg-black/10 px-3 py-3">
                  <p className="font-mono text-2xl font-semibold tracking-[0.24em] text-[var(--sl-text)]">{pairingCode}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[12px] text-amber-200">
          Unable to generate a pairing payload right now. Refresh and try again.
        </div>
      )}
    </div>
  );
}