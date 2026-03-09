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
  const [showQrModal, setShowQrModal] = useState(false);
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

  const stepCopy = compact
    ? [
        'Open SideLink on your iPhone.',
        'Choose Pair / Repair.',
        'Scan the QR or enter the code manually.',
      ]
    : [
        'Open SideLink on your iPhone.',
        'Go to Pair / Repair in onboarding or settings.',
        'Scan the QR to fill the server and pairing code instantly.',
      ];

  const showInlineQr = !compact;

  return (
    <div className={`rounded-[24px] border border-[var(--sl-border)] ${compact ? 'bg-[linear-gradient(180deg,rgba(20,33,45,0.94),rgba(11,18,27,0.96))] p-4' : 'bg-[linear-gradient(180deg,rgba(18,30,40,0.96),rgba(9,16,24,0.98))] p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${paired ? 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.6)]' : 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.5)]'}`} />
            <h4 className="text-sm font-semibold text-[var(--sl-text)]">{title}</h4>
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--sl-muted)]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expiresLabel && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">
              Expires {expiresLabel}
            </span>
          )}
          {pairingPayload && pairingCode && !loading && (
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="sl-btn-primary !px-3 !py-1.5 !text-[11px]"
            >
              Show QR
            </button>
          )}
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
        <div className={`mt-4 grid gap-4 ${showInlineQr ? 'lg:grid-cols-[188px,1fr]' : 'xl:grid-cols-[minmax(0,1.2fr),minmax(260px,0.8fr)]'}`}>
          {showInlineQr && (
            <div className="rounded-[28px] border border-white/15 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
              <QRCodeSVG value={pairingPayload} size={152} level="M" includeMargin className="h-auto w-full" />
            </div>
          )}
          <div className="space-y-3">
            <div className={`grid gap-3 ${showInlineQr ? 'md:grid-cols-[minmax(0,1fr),176px]' : 'md:grid-cols-[minmax(0,1.2fr),minmax(220px,0.8fr)]'}`}>
              <div className="rounded-2xl border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(14,116,144,0.05))] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Pairing code</p>
                <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <p className="font-mono text-3xl font-semibold tracking-[0.24em] text-[var(--sl-text)]">{pairingCode}</p>
                </div>
                <p className="mt-3 text-[12px] leading-5 text-[var(--sl-muted)]">
                  {showInlineQr
                    ? 'Use the QR for the fastest handoff. If camera pairing is blocked, the code below is enough to pair manually.'
                    : 'Use Show QR when you want the full camera handoff. The code below is enough for manual pairing without expanding the whole dashboard card.'}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">{showInlineQr ? 'Manual fallback' : 'Camera handoff'}</p>
                <div className="mt-3 rounded-xl border border-[var(--sl-border)] bg-black/10 px-3 py-3">
                  {showInlineQr ? (
                    <p className="font-mono text-2xl font-semibold tracking-[0.22em] text-[var(--sl-text)]">{pairingCode}</p>
                  ) : (
                    <button type="button" onClick={() => setShowQrModal(true)} className="sl-btn-primary w-full justify-center !py-2.5 text-center">
                      Open QR modal
                    </button>
                  )}
                </div>
                <p className="mt-3 text-[11px] leading-5 text-[var(--sl-muted)]">
                  {showInlineQr
                    ? 'Choose a discovered desktop or enter the desktop address, then type this code on the iPhone.'
                    : 'Open the modal for a full-size QR when the iPhone camera is ready, or keep using the manual code shown alongside it.'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">On your iPhone</p>
              <ol className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--sl-text)] md:grid-cols-3">
                {stepCopy.map((step, index) => (
                  <li key={step} className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Step {index + 1}</span>
                    <p className="mt-2">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[12px] text-amber-200">
          Unable to generate a pairing payload right now. Refresh and try again.
        </div>
      )}

      {showQrModal && pairingPayload && pairingCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="helper-qr-modal-title"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="sl-card w-full max-w-3xl overflow-hidden animate-scaleIn"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--sl-border)] px-6 py-4">
              <div>
                <h5 id="helper-qr-modal-title" className="text-[15px] font-semibold text-[var(--sl-text)]">Pair your iPhone helper</h5>
                <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Scan the QR from the iPhone helper, or use the code below if camera pairing is inconvenient.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="sl-btn-ghost !px-2.5 !py-1.5 !text-[11px]"
              >
                Close
              </button>
            </div>

            <div className="grid gap-5 p-6 lg:grid-cols-[260px,1fr]">
              <div className="rounded-[28px] border border-white/15 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
                <QRCodeSVG value={pairingPayload} size={220} level="M" includeMargin className="h-auto w-full" />
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(14,116,144,0.05))] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Manual pairing code</p>
                  <p className="mt-3 font-mono text-3xl font-semibold tracking-[0.24em] text-[var(--sl-text)]">{pairingCode}</p>
                  {expiresLabel && <p className="mt-3 text-[11px] text-[var(--sl-muted)]">Expires {expiresLabel}</p>}
                </div>

                <div className="rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">On your iPhone</p>
                  <ol className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--sl-text)] md:grid-cols-3">
                    {stepCopy.map((step, index) => (
                      <li key={step} className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Step {index + 1}</span>
                        <p className="mt-2">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}