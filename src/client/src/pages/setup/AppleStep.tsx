import { useState, useEffect } from 'react';
import { api, type Apple2FAChallenge } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import { Field, InlineNotice, StepActions } from './shared';

type HelperDoctorSnapshot = {
  appleAuthReady?: boolean;
  appleAuthError?: string | null;
};

export function AppleStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [phase, setPhase] = useState<'form' | '2fa' | 'success'>('form');
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [twoFAInfo, setTwoFAInfo] = useState<Apple2FAChallenge | null>(null);
  const [doctor, setDoctor] = useState<HelperDoctorSnapshot | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(true);
  const [addedAccounts, setAddedAccounts] = useState<string[]>([]);
  const [appleIdTouched, setAppleIdTouched] = useState(false);
  const { toast } = useToast();

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const appleIdError = appleIdTouched && appleId.length > 0 && !isValidEmail(appleId) ? 'Enter a valid email address' : '';

  useEffect(() => {
    let cancelled = false;

    const loadDoctor = async () => {
      setDoctorLoading(true);
      try {
        const res = await api.helperDoctor();
        if (!cancelled) {
          setDoctor(res.data ?? null);
        }
      } catch {
        if (!cancelled) {
          setDoctor(null);
        }
      } finally {
        if (!cancelled) {
          setDoctorLoading(false);
        }
      }
    };

    void loadDoctor();
    return () => {
      cancelled = true;
    };
  }, []);

  const packagedRuntimeBlocked = doctor?.appleAuthReady === false;

  const signIn = async () => {
    if (!isValidEmail(appleId)) { setError('Please enter a valid email address'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.appleSignIn(appleId, password);
      if (res.data && 'requires2FA' in res.data && res.data.requires2FA) {
        setTwoFAInfo(res.data as Apple2FAChallenge);
        setPhase('2fa');
      } else {
        toast('success', 'Apple ID connected');
        setAddedAccounts(prev => [...prev, appleId]);
        setPhase('success');
      }
    } catch (e: unknown) {
      const body = (e as { data?: Apple2FAChallenge })?.data ?? (e as Apple2FAChallenge);
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
      setAddedAccounts(prev => [...prev, appleId]);
      setPhase('success');
    } catch (e: unknown) {
      setError(getErrorMessage(e, '2FA failed'));
    } finally {
      setLoading(false);
    }
  };

  const addAnother = () => {
    setAppleId('');
    setPassword('');
    setCode('');
    setError('');
    setTwoFAInfo(null);
    setPhase('form');
  };

  if (phase === 'success') {
    return (
      <div>
        <div className="mb-4">
          <InlineNotice title={addedAccounts.length === 1 ? 'Signing Identity Connected' : `${addedAccounts.length} Signing Identities Connected`} tone="success">
            <div className="space-y-1">
              {addedAccounts.map((id) => (
                <p key={id} className="font-medium text-emerald-50">{id}</p>
              ))}
              <p>{addedAccounts.length === 1 ? 'This Apple ID is' : 'These Apple IDs are'} now available to the signing pipeline.</p>
            </div>
          </InlineNotice>
        </div>
        <div className="sl-card sl-card-emerald p-6 text-center mb-4">
          <svg aria-hidden="true" className="w-10 h-10 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 font-medium">{addedAccounts.length === 1 ? 'Apple ID Connected' : `${addedAccounts.length} Apple IDs Connected`}</p>
          <p className="text-emerald-400/60 text-xs mt-1">Provisioning and install requests can now use {addedAccounts.length === 1 ? 'this identity' : 'these identities'}.</p>
        </div>
        <button
          onClick={addAnother}
          className="sl-btn-ghost w-full mb-4 flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Add Another Apple ID
        </button>
        <StepActions onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div>
      <InlineNotice title="Runtime Expectation" tone="default">
        Apple sign-in depends on the packaged Python helper runtime. If this step is slow or fails consistently in the desktop build, treat that as a packaging/runtime defect, not just a bad password.
      </InlineNotice>

      {packagedRuntimeBlocked && (
        <div className="mt-4">
          <InlineNotice title="Packaged Runtime Blocker" tone="warning">
            {doctor?.appleAuthError ?? 'The packaged Apple auth runtime is not healthy, so sign-in is expected to fail until that runtime issue is fixed.'}
          </InlineNotice>
        </div>
      )}

      {!packagedRuntimeBlocked && !doctorLoading && (
        <div className="mt-4">
          <InlineNotice title="Packaged Runtime" tone="success">
            The local Apple auth helper runtime passed its readiness checks.
          </InlineNotice>
        </div>
      )}

      {phase === 'form' ? (
        <div className="mt-5 space-y-4">
          <Field htmlFor="wiz-apple-id" label="Apple ID" hint="Signing account">
            <input
              id="wiz-apple-id"
              type="email"
              autoComplete="email"
              aria-label="Apple ID email"
              placeholder="name@example.com"
              pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
              value={appleId}
              onChange={e => setAppleId(e.target.value)}
              onBlur={() => setAppleIdTouched(true)}
              className="sl-input w-full"
            />
            {appleIdError && <p className="mt-1.5 text-[12px] text-red-400">{appleIdError}</p>}
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
            Enter the 6-digit code from your trusted Apple device. If Apple exposes an SMS fallback for this account, you can trigger it below.
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
                    } catch (e: unknown) { setError(getErrorMessage(e, 'Failed to send SMS')); }
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 mr-3 transition-colors"
                >
                  SMS to {p.numberWithDialCode}
                </button>
              ))}
            </div>
          )}
          {(!twoFAInfo?.trustedPhoneNumbers || twoFAInfo.trustedPhoneNumbers.length === 0) && (
            <p className="text-xs text-[var(--sl-muted)] opacity-80">
              Apple is only offering trusted-device verification for this session.
            </p>
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
        nextDisabled={phase === '2fa' ? code.length !== 6 : !appleId || !password || !isValidEmail(appleId) || packagedRuntimeBlocked}
        loading={loading}
        showSkip
        onSkip={onNext}
      />
    </div>
  );
}
