// ─── Setup Wizard ────────────────────────────────────────────────────
// Multi-step guided onboarding: Account → Apple ID → Device → First App.
// Orchestrator shell — step implementations live in ./setup/.

import { useState, useEffect } from 'react';
import { BrandIcon } from '../components/BrandIcon';
import { useElectron } from '../hooks/useElectron';
import { STORAGE_KEYS } from '../../../shared/constants';

import { WelcomeStep } from './setup/WelcomeStep';
import { AccountStep } from './setup/AccountStep';
import { AppleStep } from './setup/AppleStep';
import { DeviceStep } from './setup/DeviceStep';
import { UploadStep } from './setup/UploadStep';
import { DoneStep } from './setup/DoneStep';

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

      <aside className={`relative hidden w-[23rem] shrink-0 border-r border-white/6 bg-[linear-gradient(180deg,rgba(8,16,25,0.94),rgba(6,12,18,0.98))] px-7 py-8 lg:flex lg:flex-col ${macChromeInset ? 'lg:pt-16' : ''}`}>
        <div className="sl-card overflow-hidden p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] shadow-lg">
              <BrandIcon className="h-8 w-8" />
            </div>
            <div>
              <p className="sl-kicker">Desktop Onboarding</p>
              <h1 className="mt-1 text-[1.4rem] font-semibold tracking-tight text-[var(--sl-text)]">SideLink</h1>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/8 bg-white/[0.03] p-5">
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
              <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--sl-accent),var(--sl-info),var(--sl-accent-2))] transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-4 text-[13px] leading-6 text-[var(--sl-muted)]">
              Track your progress through each onboarding step.
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
                    ? 'border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.08)]'
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

        <p className="mt-auto pt-6 text-[11px] leading-5 text-[var(--sl-muted)]/70">
          Revisit Apple accounts, devices, helper pairing, and admin settings after onboarding.
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
            <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--sl-accent),var(--sl-info),var(--sl-accent-2))] transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-10 lg:py-8 ${macChromeInset ? 'lg:pt-12' : ''}`}>
          <div className="mx-auto flex min-h-full w-full max-w-5xl items-start justify-center">
            <div className={`w-full ${direction === 'forward' ? 'animate-slideInRight' : 'animate-slideInLeft'}`} key={step}>
              <section className="sl-card overflow-hidden">
                <div className="border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-6 py-6 sm:px-8">
                  <p className="sl-kicker">{STEP_BADGES[step]}</p>
                  <h2 className="mt-3 max-w-3xl text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-[var(--sl-text)] sm:text-[2.35rem]">{meta.title}</h2>
                  <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[var(--sl-muted)] sm:text-[15px]">{meta.subtitle}</p>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
