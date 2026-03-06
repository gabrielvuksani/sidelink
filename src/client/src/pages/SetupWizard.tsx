// ─── Setup Wizard ────────────────────────────────────────────────────
// Multi-step guided onboarding: Account → Apple ID → Device → First App.
// Replaces the old single-form SetupPage for a production-ready UX.

import { useState, useEffect, useCallback, useRef, type ReactNode, type DragEvent } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import { Card } from '../components/Shared';
import { BrandIcon } from '../components/BrandIcon';
import { HelperPairingPanel } from '../components/HelperPairingPanel';
import { isElectron, pickIpaFile } from '../lib/electron';
import type { AppleAccount, DeviceInfo, IpaArtifact } from '../../../shared/types';
import { STORAGE_KEYS, UI_LIMITS } from '../../../shared/constants';

// ── Step definitions ─────────────────────────────────────────────────

type WizardStep = 'welcome' | 'account' | 'apple' | 'device' | 'upload' | 'done';

const STEP_ORDER: WizardStep[] = ['welcome', 'account', 'apple', 'device', 'upload', 'done'];

const STEP_META: Record<WizardStep, { title: string; subtitle: string }> = {
  welcome:  { title: 'Welcome to Sidelink',       subtitle: 'Let\'s set everything up in a few quick steps.' },
  account:  { title: 'Create Admin Account',       subtitle: 'Secure your Sidelink instance with a login.' },
  apple:    { title: 'Connect Apple ID',            subtitle: 'Required for signing apps. You can skip and add later.' },
  device:   { title: 'Connect a Device',            subtitle: 'Plug in an iOS device or make sure it\'s on your network.' },
  upload:   { title: 'Upload Your First App',       subtitle: 'Drop an .ipa file to get started.' },
  done:     { title: 'You\'re All Set!',            subtitle: 'Sidelink is ready. Head to the dashboard to manage apps.' },
};

// ── Main Wizard ──────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<WizardStep>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.wizardStep);
    if (saved && STEP_ORDER.includes(saved as WizardStep) && saved !== 'done') {
      return saved as WizardStep;
    }
    return 'welcome';
  });
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  useEffect(() => { document.title = 'Setup — Sidelink'; }, []);

  const goTo = (target: WizardStep, dir: 'forward' | 'back' = 'forward') => {
    setDirection(dir);
    setStep(target);
    localStorage.setItem(STORAGE_KEYS.wizardStep, target);
  };

  const next = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) goTo(STEP_ORDER[idx + 1], 'forward');
  };

  const back = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) goTo(STEP_ORDER[idx - 1], 'back');
  };

  const stepIndex = STEP_ORDER.indexOf(step);
  const meta = STEP_META[step];

  return (
    <div className="flex h-screen bg-[var(--sl-bg)] overflow-hidden">
      {/* Left panel — branding + progress */}
      <div className="hidden lg:flex w-80 bg-[var(--sl-surface)] border-r border-[var(--sl-border)] flex-col p-8 justify-between">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <BrandIcon className="h-10 w-10" />
            <div>
              <h1 className="text-lg font-bold text-[var(--sl-text)]">Sidelink</h1>
              <p className="text-[10px] text-[var(--sl-muted)]">Desktop App</p>
            </div>
          </div>

          {/* Step list */}
          <div className="space-y-1">
            {STEP_ORDER.map((s, i) => {
              const isActive = s === step;
              const isDone = i < stepIndex;
              return (
                <div
                  key={s}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    isActive ? 'bg-indigo-500/10 text-indigo-400' : isDone ? 'text-emerald-400/70' : 'text-[var(--sl-muted)]'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border transition-all duration-200 ${
                    isActive ? 'border-indigo-500 bg-indigo-500/20 text-indigo-400' :
                    isDone ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400' :
                    'border-[var(--sl-border)] text-[var(--sl-muted)]'
                  }`}>
                    {isDone ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : i + 1}
                  </span>
                  <span className="text-sm capitalize">{STEP_META[s].title.split(' ').slice(0, 2).join(' ')}</span>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[10px] text-[var(--sl-muted)] opacity-50">
          You can always change these settings later.
        </p>
      </div>

      {/* Right panel — step content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile progress bar */}
        <div className="lg:hidden bg-[var(--sl-surface)] border-b border-[var(--sl-border)] p-4">
          <div className="flex items-center gap-2 mb-2">
            {STEP_ORDER.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  i <= stepIndex ? 'bg-[var(--sl-accent)]' : 'bg-[var(--sl-surface-raised)]'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--sl-muted)]">Step {stepIndex + 1} of {STEP_ORDER.length}</p>
        </div>

        {/* Content area */}
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className={`w-full max-w-md transition-all duration-300 ease-out ${
            direction === 'forward' ? 'animate-slideInRight' : 'animate-slideInLeft'
          }`} key={step}>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-[var(--sl-text)]">{meta.title}</h2>
              <p className="text-[var(--sl-muted)] text-sm mt-1">{meta.subtitle}</p>
            </div>

            {step === 'welcome'  && <WelcomeStep onNext={next} />}
            {step === 'account'  && <AccountStep onNext={next} onBack={back} />}
            {step === 'apple'    && <AppleStep onNext={next} onBack={back} />}
            {step === 'device'   && <DeviceStep onNext={next} onBack={back} />}
            {step === 'upload'   && <UploadStep onNext={next} onBack={back} />}
            {step === 'done'     && <DoneStep onFinish={onComplete} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared step wrapper ──────────────────────────────────────────────

function StepActions({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  loading = false,
  showSkip = false,
  onSkip,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  showSkip?: boolean;
  onSkip?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--sl-border)]">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[var(--sl-muted)] hover:text-[var(--sl-text)] transition-colors"
          >
            &larr; Back
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showSkip && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-[var(--sl-muted)] hover:text-[var(--sl-text)] transition-colors"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || loading}
          className="sl-btn-primary flex items-center gap-2"
        >
          {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Welcome ──────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const features = [
    { icon: '🔐', title: 'Sign Apps', desc: 'Use your Apple ID to sign any .ipa file' },
    { icon: '📱', title: 'Install to Device', desc: 'Push signed apps directly over USB or WiFi' },
    { icon: '🔄', title: 'Auto-Refresh', desc: 'Keep free-signed apps alive automatically' },
    { icon: '🖥️', title: 'Cross-Platform', desc: 'Works on macOS, Windows, and Linux' },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {features.map(f => (
          <Card key={f.title} className="p-4">
            <span className="text-xl mb-2 block">{f.icon}</span>
            <p className="text-[var(--sl-text)] text-sm font-medium">{f.title}</p>
            <p className="text-[var(--sl-muted)] text-xs mt-0.5">{f.desc}</p>
          </Card>
        ))}
      </div>
      <StepActions onNext={onNext} nextLabel="Get Started" />
    </div>
  );
}

// ── Step 2: Admin Account ────────────────────────────────────────────

function AccountStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    if (password !== confirmPwd) return setError('Passwords do not match');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    setError('');
    try {
      await api.setup(username, password);
      toast('success', 'Admin account created');
      onNext();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Setup failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="space-y-3">
        <div>
          <label htmlFor="wiz-user" className="text-[11px] text-[var(--sl-muted)] block mb-1">Username</label>
          <input
            id="wiz-user"
            type="text"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="sl-input w-full"
          />
        </div>
        <div>
          <label htmlFor="wiz-pwd" className="text-[11px] text-[var(--sl-muted)] block mb-1">Password</label>
          <input
            id="wiz-pwd"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="sl-input w-full"
          />
        </div>
        <div>
          <label htmlFor="wiz-confirm" className="text-[11px] text-[var(--sl-muted)] block mb-1">Confirm Password</label>
          <input
            id="wiz-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPwd}
            onChange={e => setConfirmPwd(e.target.value)}
            className="sl-input w-full"
          />
        </div>
      </div>
      {error && (
        <div className="mt-3 sl-card !border-red-500/15 !bg-red-500/[0.04] p-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}
      <StepActions
        onBack={onBack}
        onNext={submit}
        nextLabel="Create Account"
        nextDisabled={!username || !password || !confirmPwd}
        loading={loading}
      />
    </div>
  );
}

// ── Step 3: Apple ID ─────────────────────────────────────────────────

interface TwoFAInfo {
  requires2FA: boolean;
  authType?: string;
  trustedPhoneNumbers?: Array<{ id: number; numberWithDialCode: string }>;
}

function AppleStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [phase, setPhase] = useState<'form' | '2fa' | 'success'>('form');
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [twoFAInfo, setTwoFAInfo] = useState<TwoFAInfo | null>(null);
  const { toast } = useToast();

  const signIn = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.appleSignIn(appleId, password);
      if (res.data && 'requires2FA' in res.data && res.data.requires2FA) {
        setTwoFAInfo(res.data as TwoFAInfo);
        setPhase('2fa');
      } else {
        toast('success', 'Apple ID connected');
        setPhase('success');
      }
    } catch (e: unknown) {
      const body = (e as { data?: TwoFAInfo })?.data ?? (e as TwoFAInfo);
      if (body?.requires2FA) {
        setTwoFAInfo(body);
        setPhase('2fa');
      } else {
        setError(getErrorMessage(e, 'Sign in failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const submit2FA = async () => {
    setError('');
    setLoading(true);
    try {
      await api.submitApple2FA({ appleId, password, code });
      toast('success', 'Apple ID verified');
      setPhase('success');
    } catch (e: unknown) {
      setError(getErrorMessage(e, '2FA failed'));
    } finally {
      setLoading(false);
    }
  };

  if (phase === 'success') {
    return (
      <div>
        <div className="sl-card !border-emerald-500/15 !bg-emerald-500/[0.04] p-6 text-center mb-4">
          <svg aria-hidden="true" className="w-10 h-10 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 font-medium">Apple ID Connected</p>
          <p className="text-emerald-400/60 text-xs mt-1">{appleId}</p>
        </div>
        <StepActions onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div>
      {phase === 'form' ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="wiz-apple-id" className="text-[11px] text-[var(--sl-muted)] block mb-1">Apple ID</label>
            <input
              id="wiz-apple-id"
              type="text"
              autoComplete="email"
              placeholder="name@example.com"
              value={appleId}
              onChange={e => setAppleId(e.target.value)}
              className="sl-input w-full"
            />
          </div>
          <div>
            <label htmlFor="wiz-apple-pwd" className="text-[11px] text-[var(--sl-muted)] block mb-1">Password</label>
            <input
              id="wiz-apple-pwd"
              type="password"
              autoComplete="off"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="sl-input w-full"
            />
          </div>
          <p className="text-xs text-[var(--sl-muted)] opacity-60">
            Your credentials are encrypted at rest and only used for signing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[var(--sl-muted)]">
            Enter the 6-digit code from your trusted Apple device.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="sl-input w-full text-center tracking-[0.5em] font-mono"
            autoFocus
          />
          {twoFAInfo?.trustedPhoneNumbers && twoFAInfo.trustedPhoneNumbers.length > 0 && (
            <div className="pt-2 border-t border-[var(--sl-border)]">
              <p className="text-xs text-[var(--sl-muted)] mb-1">Or receive via SMS:</p>
              {twoFAInfo.trustedPhoneNumbers.map(p => (
                <button
                  key={p.id}
                  onClick={async () => {
                    try {
                      await api.requestAppleSMS(appleId, p.id);
                      toast('info', 'SMS code sent');
                    } catch { setError('Failed to send SMS'); }
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 mr-3 transition-colors"
                >
                  SMS to {p.numberWithDialCode}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 sl-card !border-red-500/15 !bg-red-500/[0.04] p-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <StepActions
        onBack={phase === '2fa' ? () => setPhase('form') : onBack}
        onNext={phase === '2fa' ? submit2FA : signIn}
        nextLabel={phase === '2fa' ? 'Verify' : 'Sign In'}
        nextDisabled={phase === '2fa' ? code.length !== 6 : !appleId || !password}
        loading={loading}
        showSkip
        onSkip={onNext}
      />
    </div>
  );
}

// ── Step 4: Device Connection ────────────────────────────────────────

function DeviceStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const { toast } = useToast();

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.refreshDevices();
      setDevices(res.data ?? []);
      if (!initialLoad && (res.data?.length ?? 0) > 0) {
        toast('success', `Found ${res.data?.length} device(s)`);
      }
    } catch {
      // Silently handle — user can retry
    } finally {
      setScanning(false);
      setInitialLoad(false);
    }
  }, [initialLoad, toast]);

  useEffect(() => { scan(); }, []);  // initial scan

  return (
    <div>
      {devices.length > 0 ? (
        <div className="space-y-2 mb-4">
          {devices.map(d => (
            <Card key={d.udid} className="p-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                d.transport === 'usb' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-cyan-950/50 text-cyan-400'
              }`}>
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                </svg>
              </div>
              <div>
                <p className="text-[var(--sl-text)] text-sm font-medium">{d.name || 'iOS Device'}</p>
                <p className="text-[var(--sl-muted)] text-xs">
                  {d.productType ?? 'Unknown'} · {d.transport === 'usb' ? 'USB' : 'WiFi'}
                  {d.iosVersion ? ` · iOS ${d.iosVersion}` : ''}
                </p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="sl-card p-8 text-center mb-4">
          {scanning ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--sl-accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-[var(--sl-muted)] text-sm">Scanning for devices...</p>
            </div>
          ) : (
            <>
              <svg aria-hidden="true" className="w-10 h-10 text-[var(--sl-muted)] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
              <p className="text-[var(--sl-text)] text-sm mb-1">No devices found</p>
              <p className="text-[var(--sl-muted)] text-xs">Connect an iOS device via USB or WiFi, then scan again.</p>
            </>
          )}
        </div>
      )}

      {!scanning && (
        <button
          onClick={scan}
          className="w-full text-sm sl-btn-ghost mb-2 flex items-center justify-center gap-2"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Scan Again
        </button>
      )}

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel={devices.length > 0 ? 'Continue' : 'Skip for now'}
        showSkip={devices.length > 0}
        onSkip={onNext}
      />
    </div>
  );
}

// ── Step 5: Upload IPA ───────────────────────────────────────────────

const MAX_FILE_SIZE = UI_LIMITS.maxIpaFileSizeBytes;

function UploadStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploaded, setUploaded] = useState<IpaArtifact | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const upload = async (file: File) => {
    if (uploading) return;
    if (file.size > MAX_FILE_SIZE) { toast('error', 'File too large — maximum 4 GB'); return; }
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await api.uploadIpa(file, setUploadPct);
      setUploaded(res.data ?? null);
      toast('success', `Uploaded ${file.name}`);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const f = files[0];
    if (!f.name.endsWith('.ipa')) { toast('warning', 'Please select an .ipa file'); return; }
    upload(f);
  };

  const handleElectronPick = async () => {
    const path = await pickIpaFile();
    if (path) {
      // Electron native picker returns a path — we need to create a fetch for it
      // For now, fall back to the HTML file input
      fileRef.current?.click();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  if (uploaded) {
    return (
      <div>
        <div className="sl-card !border-emerald-500/15 !bg-emerald-500/[0.04] p-6 text-center mb-4">
          <svg aria-hidden="true" className="w-10 h-10 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 font-medium">{uploaded.bundleName || uploaded.originalName}</p>
          <p className="text-emerald-400/60 text-xs mt-1">
            {uploaded.bundleId} · v{uploaded.bundleShortVersion}
          </p>
        </div>
        <StepActions onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && (isElectron ? handleElectronPick() : fileRef.current?.click())}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-all mb-4 cursor-pointer ${
          uploading ? 'border-indigo-700 bg-indigo-950/10 cursor-wait'
          : dragging ? 'border-indigo-500 bg-indigo-950/20'
          : 'border-[var(--sl-border)] hover:border-[var(--sl-border-hover)] bg-[var(--sl-surface)]'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".ipa"
          onChange={e => handleFiles(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <div>
            <p className="text-indigo-400 text-sm mb-3">Uploading... {uploadPct}%</p>
            <div className="w-48 mx-auto h-2 bg-[var(--sl-surface-raised)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--sl-accent)] rounded-full transition-all duration-200"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <svg aria-hidden="true" className="w-10 h-10 text-[var(--sl-muted)] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-[var(--sl-text)] text-sm">Drop an .ipa file here or click to browse</p>
            <p className="text-[var(--sl-muted)] text-xs mt-1">Maximum 4 GB</p>
          </>
        )}
      </div>

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="Skip for now"
        showSkip={false}
      />
    </div>
  );
}

// ── Step 6: Done ─────────────────────────────────────────────────────

function DoneStep({ onFinish }: { onFinish: () => void }) {
  const handleFinish = () => {
    localStorage.removeItem(STORAGE_KEYS.wizardStep);
    onFinish();
  };
  return (
    <div>
      <div className="sl-card !border-indigo-500/15 !bg-indigo-500/[0.03] p-8 text-center mb-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-[var(--sl-accent)]/20 flex items-center justify-center mb-4">
          <svg aria-hidden="true" className="w-8 h-8 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[var(--sl-text)] text-lg font-semibold mb-2">Setup Complete</p>
        <p className="text-[var(--sl-muted)] text-sm">
          You're ready to sign and install apps. Head to the dashboard to get started.
        </p>
      </div>

      <div className="mb-6">
        <HelperPairingPanel
          title="Finish mobile setup"
          subtitle="Pair the iPhone helper now so you can browse sources, trigger installs, and refresh apps directly from your phone."
          compact
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="p-3 text-center">
          <p className="text-xs text-[var(--sl-muted)]">What's Next</p>
          <p className="text-sm text-[var(--sl-text)] mt-0.5">Go to Install page</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-[var(--sl-muted)]">Need help?</p>
          <p className="text-sm text-[var(--sl-text)] mt-0.5">Check Settings</p>
        </Card>
      </div>

      <button
        onClick={handleFinish}
        className="w-full sl-btn-primary py-3"
      >
        Open Dashboard &rarr;
      </button>
    </div>
  );
}
