import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from './Toast';
import { UI_LIMITS } from '../../../shared/constants';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';

type PairingSnapshot = {
  code: string | null;
  expiresAt: string | null;
  qrPayload: string | null;
  backendUrl: string | null;
  candidateAddresses: string[];
};

interface HelperPairingPanelProps {
  title?: string;
  subtitle?: string;
  paired?: boolean;
  compact?: boolean;
  layout?: 'default' | 'feature';
  autoRefresh?: boolean;
  presentation?: 'inline' | 'modal-only';
  defaultModal?: 'code' | 'qr';
  openSignal?: number;
  showOpenButton?: boolean;
}

export function HelperPairingPanel({
  title = 'Pair your iPhone helper',
  subtitle = 'Open SideLink on your iPhone, choose Pair / Repair, then scan this QR or enter the 6-digit code manually.',
  paired = false,
  compact = false,
  layout = 'default',
  autoRefresh = true,
  presentation = 'inline',
  defaultModal = 'code',
  openSignal,
  showOpenButton = true,
}: HelperPairingPanelProps) {
  const snapshotKey = 'panel:helper-pairing';
  const warmSnapshot = getUiSnapshot<PairingSnapshot>(snapshotKey, UI_LIMITS.pairingCodeRefreshMs);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [activeModal, setActiveModal] = useState<'code' | 'qr' | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(warmSnapshot?.data.code ?? null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(warmSnapshot?.data.expiresAt ?? null);
  const [pairingPayload, setPairingPayload] = useState<string | null>(warmSnapshot?.data.qrPayload ?? null);
  const [pairingBackendUrl, setPairingBackendUrl] = useState<string | null>(warmSnapshot?.data.backendUrl ?? null);
  const [pairingCandidateAddresses, setPairingCandidateAddresses] = useState<string[]>(warmSnapshot?.data.candidateAddresses ?? []);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { toast } = useToast();
  const modalTitleId = useId();
  const previousOpenSignal = useRef(openSignal);

  const isFeatureLayout = layout === 'feature';
  const isModalOnly = presentation === 'modal-only';
  const isModalOpen = activeModal !== null;

  const refreshPairing = async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setRefreshing(false);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await api.createHelperPairingCode();
      const nextSnapshot = {
        code: res.data?.code ?? null,
        expiresAt: res.data?.expiresAt ?? null,
        qrPayload: res.data?.qrPayload ?? null,
        backendUrl: res.data?.backendUrl ?? null,
        candidateAddresses: res.data?.candidateAddresses ?? [],
      };
      setPairingCode(nextSnapshot.code);
      setPairingExpiresAt(nextSnapshot.expiresAt);
      setPairingPayload(nextSnapshot.qrPayload);
      setPairingBackendUrl(nextSnapshot.backendUrl);
      setPairingCandidateAddresses(nextSnapshot.candidateAddresses);
      setUiSnapshot(snapshotKey, nextSnapshot);
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
    void refreshPairing({ silent: !!warmSnapshot });
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    if (isModalOnly && !isModalOpen) return;

    const interval = window.setInterval(() => {
      void refreshPairing({ silent: true });
    }, UI_LIMITS.pairingCodeRefreshMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoRefresh, isModalOnly, isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!pairingExpiresAt) return;

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [pairingExpiresAt]);

  useEffect(() => {
    if (openSignal === undefined) return;
    if (previousOpenSignal.current === undefined) {
      previousOpenSignal.current = openSignal;
      return;
    }
    if (openSignal === previousOpenSignal.current) return;
    previousOpenSignal.current = openSignal;
    openModal(defaultModal);
  }, [defaultModal, openSignal, pairingCode, pairingPayload, pairingExpiresAt]);

  useEffect(() => {
    if (!isModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveModal(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen]);

  const expiresLabel = useMemo(() => {
    if (!pairingExpiresAt) return null;
    const expires = new Date(pairingExpiresAt);
    return Number.isNaN(expires.getTime()) ? null : expires.toLocaleTimeString();
  }, [pairingExpiresAt]);

  const secondsRemaining = useMemo(() => {
    if (!pairingExpiresAt) return null;
    const msRemaining = new Date(pairingExpiresAt).getTime() - nowMs;
    return msRemaining > 0 ? Math.ceil(msRemaining / 1000) : 0;
  }, [nowMs, pairingExpiresAt]);

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

  const showInlineQr = !isModalOnly && (!compact || isFeatureLayout);

  const openModal = (nextModal: 'code' | 'qr') => {
    setActiveModal(nextModal);

    const expiresAt = pairingExpiresAt ? Date.parse(pairingExpiresAt) : Number.NaN;
    const needsRefresh = !pairingCode || !pairingPayload || Number.isNaN(expiresAt) || expiresAt - Date.now() <= 15_000;
    if (needsRefresh) {
      void refreshPairing({ silent: true });
    }
  };

  const closeModal = () => setActiveModal(null);

  const modalShell = activeModal && pairingPayload && pairingCode
    ? createPortal(
        <div
          className="sl-modal-overlay animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          onClick={closeModal}
        >
          <div className="sl-modal-frame">
            <div
              className="sl-modal-panel relative w-full overflow-hidden border-white/10 shadow-[0_40px_120px_rgba(1,8,15,0.72)] animate-scaleIn"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

              <div className="shrink-0 border-b border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(18,30,40,0.98),rgba(8,14,22,0.98))] px-4 py-5 sm:px-7">
                <div className="sl-modal-header">
                <div>
                  <p className="sl-kicker">iPhone Helper Pairing</p>
                  <h5 id={modalTitleId} className="mt-3 text-[1.2rem] font-semibold tracking-[-0.04em] text-[var(--sl-text)] sm:text-[1.5rem]">
                    {activeModal === 'qr' ? 'Scan the desktop QR on your iPhone' : 'Enter the desktop pairing code on your iPhone'}
                  </h5>
                  <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--sl-muted)]">
                    {activeModal === 'qr'
                      ? 'Use camera handoff when it is faster than typing. If scanning is inconvenient, the same short code is available below.'
                      : 'Manual entry stays reliable when the camera handoff is inconvenient. Open the QR modal any time for the faster path.'}
                  </p>
                </div>

                <div className="sl-modal-header-actions items-center sm:justify-end">
                  {expiresLabel && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">
                      Refreshes every 60s · expires {expiresLabel}
                    </span>
                  )}
                  <button type="button" onClick={closeModal} className="sl-btn-ghost justify-center !px-3 !py-2 !text-[12px]">
                    Close
                  </button>
                </div>
              </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto bg-[linear-gradient(180deg,rgba(10,17,26,0.98),rgba(6,11,18,0.98))] p-4 sm:p-7">
              <div className="mx-auto max-w-lg space-y-4">
                {activeModal === 'qr' ? (
                  <div className="mx-auto w-full max-w-[248px] rounded-[26px] border border-white/15 bg-white p-4 shadow-[0_28px_80px_rgba(15,23,42,0.24)] sm:max-w-[320px] sm:rounded-[32px] sm:p-6">
                    <QRCodeSVG value={pairingPayload} size={208} level="M" includeMargin className="h-auto w-full sm:[&_svg]:h-[240px] sm:[&_svg]:w-[240px]" />
                  </div>
                ) : (
                  <div className="rounded-[30px] border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(45,212,191,0.16),rgba(10,18,27,0.96))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Pairing code</p>
                    <p className="mt-5 break-all font-mono text-[clamp(1.45rem,9vw,4rem)] font-semibold tracking-[0.18em] text-[var(--sl-text)] sm:tracking-[0.28em]">{pairingCode}</p>
                    <p className="mt-4 text-[12px] leading-6 text-[var(--sl-muted)]">
                      Keep this code visible while the helper is open on your iPhone. It is regenerated every 60 seconds while this modal stays open.
                    </p>
                  </div>
                )}

                <div className="grid gap-3 min-[480px]:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void copyText(pairingCode, 'Pairing code copied')}
                    className="sl-btn-primary justify-center !py-2.5 text-center"
                  >
                    Copy code
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(activeModal === 'qr' ? 'code' : 'qr')}
                    className="sl-btn-ghost justify-center !py-2.5 text-center"
                  >
                    {activeModal === 'qr' ? 'Show code' : 'Show QR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void refreshPairing(); }}
                    disabled={refreshing}
                    className="sl-btn-ghost justify-center !py-2.5 text-center"
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>

                {pairingBackendUrl && (
                  <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Desktop address fallback</p>
                    <p className="mt-3 break-all font-mono text-[13px] text-[var(--sl-text)]">{pairingBackendUrl}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void copyText(pairingBackendUrl, 'Desktop address copied')} className="sl-btn-ghost justify-center !py-2 text-center">
                        Copy address
                      </button>
                      {pairingCandidateAddresses.length > 0 && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">
                          {pairingCandidateAddresses.length} LAN candidate{pairingCandidateAddresses.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`overflow-hidden rounded-[26px] border border-[var(--sl-border)] ${compact ? 'bg-[linear-gradient(180deg,rgba(20,33,45,0.94),rgba(11,18,27,0.96))] p-4 sm:p-5' : 'bg-[linear-gradient(180deg,rgba(18,30,40,0.96),rgba(9,16,24,0.98))] p-4 sm:p-5'} ${isFeatureLayout ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${paired ? 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.6)]' : 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.5)]'}`} />
            <h4 className="text-sm font-semibold text-[var(--sl-text)]">{title}</h4>
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--sl-muted)]">{subtitle}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {expiresLabel && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-muted)]">
              {secondsRemaining !== null ? `Expires in ${secondsRemaining}s` : `Expires ${expiresLabel}`}
            </span>
          )}
          {pairingPayload && pairingCode && !loading && showOpenButton && (
            <button
              type="button"
              onClick={() => openModal(defaultModal)}
              className="sl-btn-primary min-[420px]:w-auto w-full justify-center !px-3 !py-1.5 !text-[11px]"
            >
              Open pairing modal
            </button>
          )}
          {pairingCode && (
            <button
              type="button"
              onClick={() => void copyText(pairingCode, 'Pairing code copied')}
              className="sl-btn-ghost min-[420px]:w-auto w-full justify-center !px-2.5 !py-1.5 !text-[11px]"
            >
              Copy code
            </button>
          )}
          <button
            type="button"
            onClick={() => { void refreshPairing(); }}
            disabled={refreshing}
            className="sl-btn-ghost min-[420px]:w-auto w-full justify-center !px-2.5 !py-1.5 !text-[11px]"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[180px,1fr]">
          <div className="aspect-square max-w-[220px] rounded-2xl border border-[var(--sl-border)] bg-white/90" />
          <div className="space-y-3">
            <div className="h-5 w-32 animate-pulse rounded bg-[var(--sl-surface-soft)]" />
            <div className="h-20 animate-pulse rounded-2xl bg-[var(--sl-surface-soft)]" />
            <div className="h-24 animate-pulse rounded-2xl bg-[var(--sl-surface-soft)]" />
          </div>
        </div>
      ) : isModalOnly ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.12fr),minmax(220px,0.88fr)]">
            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(8,145,178,0.16),rgba(14,116,144,0.05))] p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Pairing handoff</p>
              <p className="mt-3 text-[15px] font-semibold text-[var(--sl-text)]">Open the code or QR only when you need it</p>
              <p className="mt-2 text-[12px] leading-6 text-[var(--sl-muted)]">
                Overview stays compact and stable while the pairing payload lives in dedicated full-screen modals. That keeps the widget from constantly reflowing during refreshes.
              </p>
            </div>

            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Refresh policy</p>
              <p className="mt-3 text-[15px] font-semibold text-[var(--sl-text)]">60-second payload rotation</p>
              <p className="mt-2 text-[12px] leading-6 text-[var(--sl-muted)]">
                The pairing code and QR now refresh only while a pairing modal is open, so the widget itself stays visually calm.
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">On your iPhone</p>
            <ol className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--sl-text)] min-[560px]:grid-cols-3">
              {stepCopy.map((step, index) => (
                <li key={step} className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Step {index + 1}</span>
                  <p className="mt-2">{step}</p>
                </li>
              ))}
            </ol>
          </div>

          {pairingBackendUrl && (
            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Desktop address fallback</p>
              <p className="mt-3 break-all font-mono text-[13px] text-[var(--sl-text)]">{pairingBackendUrl}</p>
              <p className="mt-2 text-[11px] leading-5 text-[var(--sl-muted)]">
                If discovery fails on the iPhone, enter this desktop address manually and then type the same 6-digit code.
              </p>
            </div>
          )}
        </div>
      ) : pairingPayload && pairingCode ? (
        <div className={`mt-4 grid gap-4 ${showInlineQr ? (isFeatureLayout ? 'xl:grid-cols-[168px,1fr]' : 'lg:grid-cols-[188px,1fr]') : '2xl:grid-cols-[minmax(0,1.18fr),minmax(260px,0.82fr)]'}`}>
          {showInlineQr && (
            <div className={`mx-auto w-full rounded-[28px] border border-white/15 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.22)] ${isFeatureLayout ? 'max-w-[196px] xl:mx-0' : 'max-w-[220px] lg:mx-0'}`}>
              <QRCodeSVG value={pairingPayload} size={isFeatureLayout ? 140 : 152} level="M" includeMargin className="h-auto w-full" />
            </div>
          )}
          <div className="space-y-3">
            <div className={`grid gap-3 ${showInlineQr ? (isFeatureLayout ? 'md:grid-cols-[minmax(0,1.16fr),minmax(200px,0.84fr)]' : 'md:grid-cols-[minmax(0,1fr),176px]') : 'md:grid-cols-[minmax(0,1.2fr),minmax(220px,0.8fr)]'}`}>
              <div className="rounded-[24px] border border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(14,116,144,0.05))] p-4 sm:p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sl-muted)]">Pairing code</p>
                <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <p className="font-mono text-[1.7rem] font-semibold tracking-[0.22em] text-[var(--sl-text)] sm:text-3xl">{pairingCode}</p>
                </div>
                <p className="mt-3 text-[12px] leading-5 text-[var(--sl-muted)]">
                  {showInlineQr
                    ? (isFeatureLayout
                      ? 'Keep the code visible for manual pairing, with QR available beside it when camera handoff is faster.'
                      : 'Use the QR for the fastest handoff. If camera pairing is blocked, the code below is enough to pair manually.')
                    : 'Use Show QR when you want the full camera handoff. The code below is enough for manual pairing without expanding the whole dashboard card.'}
                </p>
              </div>

              <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">{showInlineQr ? 'Manual fallback' : 'Camera handoff'}</p>
                <div className="mt-3 rounded-xl border border-[var(--sl-border)] bg-black/10 px-3 py-3">
                  {showInlineQr ? (
                    <p className="font-mono text-[1.45rem] font-semibold tracking-[0.2em] text-[var(--sl-text)] sm:text-2xl">{pairingCode}</p>
                  ) : (
                    <button type="button" onClick={() => openModal('qr')} className="sl-btn-primary w-full justify-center !py-2.5 text-center">
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

            <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">On your iPhone</p>
              <ol className={`mt-3 grid gap-2 text-[12px] leading-5 text-[var(--sl-text)] ${isFeatureLayout ? 'min-[480px]:grid-cols-3' : 'min-[480px]:grid-cols-2 xl:grid-cols-3'}`}>
                {stepCopy.map((step, index) => (
                  <li key={step} className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">Step {index + 1}</span>
                    <p className="mt-2">{step}</p>
                  </li>
                ))}
              </ol>
            </div>

            {pairingBackendUrl && (
              <div className="rounded-[24px] border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-4 sm:p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">Desktop address fallback</p>
                <p className="mt-3 break-all font-mono text-[13px] text-[var(--sl-text)]">{pairingBackendUrl}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copyText(pairingBackendUrl, 'Desktop address copied')} className="sl-btn-ghost justify-center !py-2 text-center">
                    Copy address
                  </button>
                  {pairingCandidateAddresses.length > 0 && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--sl-muted)]">
                      {pairingCandidateAddresses.join(' • ')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[12px] text-amber-200">
          Unable to generate a pairing payload right now. Refresh and try again.
        </div>
      )}

      {modalShell}
    </div>
  );
}
