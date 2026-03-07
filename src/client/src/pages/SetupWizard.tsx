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
import { useElectron } from '../hooks/useElectron';
import { isElectron, pickIpaFile } from '../lib/electron';
import type { AppleAccount, DeviceInfo, IpaArtifact } from '../../../shared/types';
import { STORAGE_KEYS, UI_LIMITS } from '../../../shared/constants';

// ── Step definitions ─────────────────────────────────────────────────

type WizardStep = 'welcome' | 'account' | 'apple' | 'device' | 'upload' | 'done';

const STEP_ORDER: WizardStep[] = ['welcome', 'account', 'apple', 'device', 'upload', 'done'];

const STEP_META: Record<WizardStep, { title: string; subtitle: string }> = {
  welcome:  { title: 'Bring your signing stack under one roof', subtitle: 'Set up SideLink once, then manage installs, Apple sessions, and helper workflows from one desktop surface.' },
  account:  { title: 'Create the local admin account', subtitle: 'This password is created here on first run. Nothing is pre-seeded for you.' },
  apple:    { title: 'Connect a signing identity', subtitle: 'Use your Apple ID for provisioning and installs. You can skip this if you only want to inspect the UI first.' },
  device:   { title: 'Verify that device transport is live', subtitle: 'USB trust and local device discovery need to be working before installs feel reliable.' },
  upload:   { title: 'Stage the first IPA', subtitle: 'Seed the library now so the dashboard is ready for a real install path instead of an empty shell.' },
  done:     { title: 'Open the full control surface', subtitle: 'You can keep tuning helper pairing, devices, and signing settings from the main app.' },
};

const STEP_BADGES: Record<WizardStep, string> = {
  welcome: 'Launch',
  account: 'Access',
  apple: 'Signing',
  device: 'Transport',
  upload: 'Library',
  done: 'Ready',
};

const WIZARD_SIGNALS = [
  {
    title: 'Local-first control',
    detail: 'Accounts, devices, app installs, and helper pairing stay inside one desktop runtime.',
  },
  {
    title: 'No default credentials',
    detail: 'First launch requires you to create the admin account. There is no seeded username or password.',
  },
  {
    title: 'Real environment checks matter',
    detail: 'Apple auth and device discovery only feel fast when the packaged runtime and host USB stack are healthy.',
  },
];

// ── Main Wizard ──────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const { info } = useElectron();
  const [step, setStep] = useState<WizardStep>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.wizardStep);
    if (saved && STEP_ORDER.includes(saved as WizardStep) && saved !== 'done') {
      return saved as WizardStep;
    }
    return 'welcome';
  });
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  useEffect(() => { document.title = 'Setup — SideLink'; }, []);

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
  const progressPct = Math.round(((stepIndex + 1) / STEP_ORDER.length) * 100);
  const macChromeInset = info.isElectron && info.platform === 'darwin';

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[var(--sl-bg)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(45,212,191,0.16),transparent_24%),radial-gradient(circle_at_82%_12%,rgba(251,146,60,0.14),transparent_22%),radial-gradient(circle_at_60%_80%,rgba(94,234,212,0.08),transparent_26%)]" />

      <aside className={`relative hidden w-[27rem] shrink-0 border-r border-white/6 bg-[linear-gradient(180deg,rgba(8,16,25,0.94),rgba(6,12,18,0.98))] px-8 py-8 lg:flex lg:flex-col ${macChromeInset ? 'lg:pt-16' : ''}`}>
        <div className="sl-card overflow-hidden p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_18px_40px_rgba(2,10,18,0.36)]">
              <BrandIcon className="h-8 w-8" />
            </div>
            <div>
              <p className="sl-kicker">Desktop Onboarding</p>
              <h1 className="mt-1 text-[1.4rem] font-semibold tracking-tight text-[var(--sl-text)]">SideLink</h1>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--sl-muted)]">Progress</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--sl-text)]">{progressPct}%</p>
              </div>
              <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-accent)]">
                {STEP_BADGES[step]}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--sl-accent),#7dd3fc,var(--sl-accent-2))] transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-4 text-[13px] leading-6 text-[#bfd0da]">
              The setup flow should feel like the product, not a temporary admin form. Each step below pushes the runtime closer to a usable install path.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {STEP_ORDER.map((s, i) => {
            const isActive = s === step;
            const isDone = i < stepIndex;
            return (
              <div
                key={s}
                className={`rounded-2xl border px-4 py-3 transition-all duration-200 ${
                  isActive
                    ? 'border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.08)] shadow-[0_16px_40px_rgba(13,148,136,0.15)]'
                    : isDone
                      ? 'border-[rgba(74,222,128,0.22)] bg-[rgba(74,222,128,0.05)]'
                      : 'border-white/6 bg-white/[0.025]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    isActive
                      ? 'border-[rgba(45,212,191,0.4)] bg-[rgba(45,212,191,0.14)] text-[var(--sl-accent)]'
                      : isDone
                        ? 'border-[rgba(74,222,128,0.28)] bg-[rgba(74,222,128,0.12)] text-[var(--sl-success)]'
                        : 'border-white/10 bg-black/20 text-[var(--sl-muted)]'
                  }`}>
                    {isDone ? 'OK' : i + 1}
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--sl-text)]">{STEP_BADGES[s]}</p>
                    <p className="text-[12px] text-[var(--sl-muted)]">{STEP_META[s].title}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-3">
          {WIZARD_SIGNALS.map((signal) => (
            <div key={signal.title} className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">{signal.title}</p>
              <p className="mt-2 text-[13px] leading-6 text-[#c3d5de]">{signal.detail}</p>
            </div>
          ))}
        </div>

        <p className="mt-auto pt-6 text-[11px] leading-5 text-[var(--sl-muted)]/70">
          You can revisit Apple accounts, device transport, helper pairing, and admin settings after onboarding. This flow is for establishing a trustworthy first run, not hiding system problems.
        </p>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className={`border-b border-white/6 bg-black/14 px-5 py-4 lg:hidden ${macChromeInset ? 'pt-12' : ''}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandIcon className="h-9 w-9" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">SideLink Setup</p>
                <p className="text-[13px] text-[var(--sl-text)]">Step {stepIndex + 1} of {STEP_ORDER.length}</p>
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sl-accent)]">
              {STEP_BADGES[step]}
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--sl-accent),#7dd3fc,var(--sl-accent-2))] transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-10 lg:py-8 ${macChromeInset ? 'lg:pt-12' : ''}`}>
          <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center">
            <div className={`grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] ${direction === 'forward' ? 'animate-slideInRight' : 'animate-slideInLeft'}`} key={step}>
              <section className="sl-card overflow-hidden">
                <div className="border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-6 py-6 sm:px-8">
                  <p className="sl-kicker">{STEP_BADGES[step]}</p>
                  <h2 className="mt-3 max-w-3xl text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-[var(--sl-text)] sm:text-[2.35rem]">{meta.title}</h2>
                  <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#bed0da] sm:text-[15px]">{meta.subtitle}</p>
                </div>

                <div className="px-6 py-6 sm:px-8 sm:py-8">
                  {step === 'welcome'  && <WelcomeStep onNext={next} />}
                  {step === 'account'  && <AccountStep onNext={next} onBack={back} />}
                  {step === 'apple'    && <AppleStep onNext={next} onBack={back} />}
                  {step === 'device'   && <DeviceStep onNext={next} onBack={back} />}
                  {step === 'upload'   && <UploadStep onNext={next} onBack={back} />}
                  {step === 'done'     && <DoneStep onFinish={onComplete} />}
                </div>
              </section>

              <aside className="space-y-4">
                <Card className="p-5">
                  <p className="sl-section-label">Current Focus</p>
                  <p className="mt-2 text-[16px] font-semibold text-[var(--sl-text)]">{STEP_BADGES[step]}</p>
                  <p className="mt-2 text-[13px] leading-6 text-[var(--sl-muted)]">{meta.subtitle}</p>
                </Card>

                <Card className="p-5">
                  <p className="sl-section-label">Expected Outcome</p>
                  <ul className="mt-3 space-y-3 text-[13px] leading-6 text-[#c4d7e1]">
                    <li>Create a local admin account that only exists on this SideLink instance.</li>
                    <li>Verify the packaged runtime can actually support signing and device workflows.</li>
                    <li>Land on a dashboard that already reflects a real app library and device path.</li>
                  </ul>
                </Card>

                <Card className="p-5">
                  <p className="sl-section-label">Operator Note</p>
                  <p className="mt-3 text-[13px] leading-6 text-[#c4d7e1]">
                    If Apple sign-in or device scans fail here, treat that as an environment problem worth fixing, not onboarding noise to skip past.
                  </p>
                </Card>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">
          {label}
        </label>
        {hint && <span className="text-[11px] text-[var(--sl-muted)]/80">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function InlineNotice({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'border-white/8 bg-white/[0.03] text-[#c5d7e0]',
    success: 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100',
    warning: 'border-amber-400/18 bg-amber-400/[0.07] text-amber-100',
    danger: 'border-red-400/18 bg-red-400/[0.08] text-red-100',
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{title}</p>
      <div className="mt-2 text-[13px] leading-6">{children}</div>
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
    <div className="mt-8 flex items-center justify-between gap-4 border-t border-white/6 pt-5">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-text)]"
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
            className="text-sm font-medium text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-text)]"
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
    { title: 'Signing roster', desc: 'Apple sessions, team state, and 2FA pressure stay visible instead of buried in a modal.' },
    { title: 'Device bay', desc: 'USB and network devices surface as transport state you can inspect and refresh on demand.' },
    { title: 'Helper loop', desc: 'The iPhone helper belongs to the release surface, not to a forgotten build step.' },
    { title: 'Release discipline', desc: 'Desktop packaging, helper export, and onboarding should expose problems early instead of shipping ambiguity.' },
  ];

  return (
    <div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {features.map(f => (
          <Card key={f.title} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-accent)]">Signal</p>
            <p className="mt-3 text-[15px] font-semibold text-[var(--sl-text)]">{f.title}</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--sl-muted)]">{f.desc}</p>
          </Card>
        ))}
      </div>

      <InlineNotice title="What this setup should prove">
        By the time you finish, you should know whether this machine can authenticate Apple sessions, discover devices, and carry a real install workflow. If it cannot, the issue is environmental and worth fixing immediately.
      </InlineNotice>

      <StepActions onNext={onNext} nextLabel="Get Started" />
    </div>
  );
}

// ── Step 2: Admin Account ────────────────────────────────────────────

function AccountStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('');
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
      <InlineNotice title="Local access only">
        This account is created on first run for this SideLink instance. There is no default admin password in development or in the packaged desktop app.
      </InlineNotice>

      <div className="mt-5 grid gap-4">
        <Field htmlFor="wiz-user" label="Username" hint="Local admin">
          <input
            id="wiz-user"
            type="text"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Choose an admin username"
            className="sl-input w-full"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="wiz-pwd" label="Password" hint="Minimum 8 chars">
          <input
            id="wiz-pwd"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="sl-input w-full"
          />
          </Field>
          <Field htmlFor="wiz-confirm" label="Confirm Password">
          <input
            id="wiz-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPwd}
            onChange={e => setConfirmPwd(e.target.value)}
            className="sl-input w-full"
          />
          </Field>
        </div>
      </div>
      {error && (
        <div className="mt-4"><InlineNotice title="Setup Error" tone="danger">{error}</InlineNotice></div>
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
        <div className="mb-4">
          <InlineNotice title="Signing Identity Connected" tone="success">
            <div className="space-y-1">
              <p className="font-medium text-emerald-50">{appleId}</p>
              <p>This Apple ID is now available to the signing pipeline.</p>
            </div>
          </InlineNotice>
        </div>
        <div className="sl-card !border-emerald-500/15 !bg-emerald-500/[0.04] p-6 text-center mb-4">
          <svg aria-hidden="true" className="w-10 h-10 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 font-medium">Apple ID Connected</p>
          <p className="text-emerald-400/60 text-xs mt-1">Provisioning and install requests can now use this identity.</p>
        </div>
        <StepActions onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div>
      <InlineNotice title="Runtime Expectation" tone="default">
        Apple sign-in depends on the packaged Python helper runtime. If this step is slow or fails consistently in the desktop build, treat that as a packaging/runtime defect, not just a bad password.
      </InlineNotice>

      {phase === 'form' ? (
        <div className="mt-5 space-y-4">
          <Field htmlFor="wiz-apple-id" label="Apple ID" hint="Signing account">
            <input
              id="wiz-apple-id"
              type="text"
              autoComplete="email"
              placeholder="name@example.com"
              value={appleId}
              onChange={e => setAppleId(e.target.value)}
              className="sl-input w-full"
            />
          </Field>
          <Field htmlFor="wiz-apple-pwd" label="Password">
            <input
              id="wiz-apple-pwd"
              type="password"
              autoComplete="off"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="sl-input w-full"
            />
          </Field>
          <p className="text-xs text-[var(--sl-muted)] opacity-60">
            Your credentials are encrypted at rest and only used for signing.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
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
        <div className="mt-4"><InlineNotice title="Apple Sign-In Error" tone="danger">{error}</InlineNotice></div>
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
      <InlineNotice title="Transport Reality Check" tone="warning">
        If you see no devices here in the packaged macOS app, first verify the machine can talk to iOS hardware at all. Trust prompts, USB transport, and the local device stack need to work before installs will.
      </InlineNotice>

      {devices.length > 0 ? (
        <div className="mt-5 space-y-3 mb-4">
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
        <div className="mt-5 sl-card p-8 text-center mb-4">
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
        className={`mt-2 border-2 border-dashed rounded-[28px] p-10 text-center transition-all mb-4 cursor-pointer ${
          uploading ? 'border-indigo-700 bg-indigo-950/10 cursor-wait'
          : dragging ? 'border-[var(--sl-accent)] bg-[rgba(45,212,191,0.08)]'
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
            <p className="text-[var(--sl-muted)] text-xs mt-1">Maximum 4 GB. Use this step to avoid landing on an empty dashboard.</p>
          </>
        )}
      </div>

      <InlineNotice title="Library Seed" tone="default">
        Uploading one IPA here makes the product feel immediately real: the dashboard, install flow, and source management all have something concrete to work with.
      </InlineNotice>

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
          The desktop shell is now through first run. If Apple auth or devices still feel broken after this, the next stop should be diagnostics, not another onboarding loop.
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
