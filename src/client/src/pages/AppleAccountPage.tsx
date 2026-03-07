import { useState, useEffect, useCallback } from 'react';
import { api, type AppleAppIdRecord, type AppleAppIdUsageRecord, type AppleCertificateRecord } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { StatusBadge, PageLoader, EmptyState } from '../components/Shared';
import type { AppleAccount, DashboardState } from '../../../shared/types';

export default function AppleAccountPage() {
  const [accounts, setAccounts] = useState<AppleAccount[]>([]);
  const [usageByAccount, setUsageByAccount] = useState<DashboardState['weeklyAppIdUsage']>({});
  const [appIds, setAppIds] = useState<AppleAppIdRecord[]>([]);
  const [appIdUsage, setAppIdUsage] = useState<AppleAppIdUsageRecord[]>([]);
  const [certificates, setCertificates] = useState<AppleCertificateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => { document.title = 'Apple ID — Sidelink'; }, []);

  const reload = useCallback(() => {
    Promise.all([
      api.listAppleAccounts(),
      api.dashboard().catch(() => ({ data: { weeklyAppIdUsage: {} } as DashboardState })),
      api.listAppleAppIds().catch(() => ({ data: [] as AppleAppIdRecord[] })),
      api.listAppleAppIdUsage().catch(() => ({ data: [] as AppleAppIdUsageRecord[] })),
      api.listAppleCertificates().catch(() => ({ data: [] as AppleCertificateRecord[] })),
    ])
      .then(([accountsResponse, dashboardResponse, appIdsResponse, appIdUsageResponse, certificatesResponse]) => {
        setAccounts(accountsResponse.data ?? []);
        setUsageByAccount(dashboardResponse.data?.weeklyAppIdUsage ?? {});
        setAppIds(appIdsResponse.data ?? []);
        setAppIdUsage(appIdUsageResponse.data ?? []);
        setCertificates(certificatesResponse.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  usePageRefresh(reload);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--sl-text)]">Apple ID</h2>
          <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Manage accounts used for signing</p>
        </div>
        <button onClick={() => setShowSignIn(true)} className="sl-btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Add Account
        </button>
      </div>

      {showSignIn && <SignInForm onDone={() => { setShowSignIn(false); reload(); }} />}

      {loading ? (
        <PageLoader message="Loading accounts..." />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No Apple ID added"
          description="Add your Apple ID to sign and install apps on your devices."
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>}
        />
      ) : (
        <div className="space-y-6 stagger-children">
          <div className="space-y-2">
            {accounts.map(a => (
              <AccountCard key={a.id} account={a} usageByAccount={usageByAccount} onRemove={reload} />
            ))}
          </div>

          <section className="sl-card p-5 space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">App IDs</h3>
              <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Track active identifiers and weekly free-account consumption.</p>
            </div>

            {appIdUsage.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {appIdUsage.map(entry => (
                  <div key={entry.accountId} className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3 text-xs">
                    <p className="font-semibold text-[var(--sl-text)]">{entry.appleId}</p>
                    <p className="mt-1 text-[var(--sl-muted)]">Active: {entry.active}/{entry.maxActive}</p>
                    <p className="text-[var(--sl-muted)]">This week: {entry.weeklyCreated}/{entry.maxWeekly}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {appIds.length === 0 ? (
                <p className="text-[12px] text-[var(--sl-muted)]">No tracked App IDs yet.</p>
              ) : appIds.map(appId => (
                <AppIdRow key={appId.id} appId={appId} onChanged={reload} />
              ))}
            </div>
          </section>

          <section className="sl-card p-5 space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Certificates</h3>
              <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Current signing certificates tracked for your Apple IDs.</p>
            </div>

            {certificates.length === 0 ? (
              <p className="text-[12px] text-[var(--sl-muted)]">No signing certificates tracked yet.</p>
            ) : (
              <div className="space-y-2">
                {certificates.map((certificate) => (
                  <div key={certificate.id} className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-[var(--sl-text)] truncate">{certificate.commonName}</p>
                        <p className="mt-1 font-mono text-[11px] text-[var(--sl-muted)] truncate">{certificate.serialNumber}</p>
                        <p className="mt-1 text-[11px] text-[var(--sl-muted)]">
                          Expires {new Date(certificate.expiresAt).toLocaleString()}
                        </p>
                        <p className="mt-1 text-[11px] text-[var(--sl-muted)]">{certificate.accountAppleId ?? certificate.teamName ?? certificate.teamId}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function AppIdRow({ appId, onChanged }: { appId: AppleAppIdRecord; onChanged: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete App ID',
      message: `Delete ${appId.bundleId}? This will free the identifier for future installs if Apple allows deletion.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.deleteAppleAppId(appId.id);
      toast('success', 'App ID deleted');
      onChanged();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to delete App ID'));
    }
  };

  return (
    <div className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--sl-text)] truncate">{appId.name}</p>
          <p className="mt-1 font-mono text-[11px] text-[var(--sl-muted)] truncate">{appId.bundleId}</p>
          <p className="mt-1 text-[11px] text-[var(--sl-muted)]">{appId.accountAppleId ?? appId.teamName ?? appId.teamId}</p>
        </div>
        <button onClick={remove} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">Delete</button>
      </div>
    </div>
  );
}

function AccountCard({ account, usageByAccount, onRemove }: { account: AppleAccount; usageByAccount: DashboardState['weeklyAppIdUsage']; onRemove: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [reAuthState, setReAuthState] = useState<'idle' | 'loading' | '2fa' | '2fa-submitting'>('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { toast } = useToast();
  const confirm = useConfirm();

  const needsReAuth = account.status === 'requires_2fa' || account.status === 'session_expired';
  const weeklyUsage = usageByAccount?.[account.id];
  const usageLabel = weeklyUsage ? `${weeklyUsage.used}/${weeklyUsage.limit} App IDs this week` : null;

  const startReAuth = async () => {
    setError('');
    setReAuthState('loading');
    try {
      const res = await api.reAuthAccount(account.id);
      if (res.data && 'requires2FA' in res.data && res.data.requires2FA) {
        setReAuthState('2fa');
      } else {
        toast('success', `Re-authenticated ${account.appleId}`);
        onRemove();
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Re-authentication failed'));
      setReAuthState('idle');
    }
  };

  const submitReAuth2FA = async () => {
    setError('');
    setReAuthState('2fa-submitting');
    try {
      await api.reAuthSubmit2FA(account.id, code);
      toast('success', `Re-authenticated ${account.appleId}`);
      setCode('');
      setReAuthState('idle');
      onRemove();
    } catch (e: unknown) {
      setError(getErrorMessage(e, '2FA verification failed'));
      setReAuthState('2fa');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove Apple ID',
      message: `Are you sure you want to remove ${account.appleId}? Apps signed with this account will still work until they expire.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await api.removeAppleAccount(account.id);
      toast('success', `Removed ${account.appleId}`);
      onRemove();
    } catch {
      toast('error', 'Failed to remove account');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="sl-card overflow-hidden animate-fadeInUp">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${needsReAuth ? 'bg-amber-500/10' : 'bg-indigo-500/10'}`}>
            <svg className={`w-4.5 h-4.5 ${needsReAuth ? 'text-amber-400' : 'text-indigo-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--sl-text)]">{account.appleId}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={account.status} />
              <span className="text-[11px] text-[var(--sl-muted)]">
                {account.teamName ?? 'Unknown Team'} · {account.accountType ?? 'free'}
              </span>
                      {usageLabel && (
                        <span className="text-[11px] text-amber-300/90">{usageLabel}</span>
                      )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {needsReAuth && reAuthState === 'idle' && (
            <button onClick={startReAuth} className="text-[12px] font-semibold text-amber-400 hover:text-amber-300 px-2.5 py-1.5 rounded-lg hover:bg-amber-500/8 transition-all">
              Re-authenticate
            </button>
          )}
          {reAuthState === 'loading' && (
            <span className="text-[12px] text-[var(--sl-muted)] flex items-center gap-1.5 px-2.5 py-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
              Authenticating...
            </span>
          )}
          <button
            onClick={remove}
            disabled={removing || reAuthState === 'loading' || reAuthState === '2fa-submitting'}
            className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5 disabled:opacity-50"
          >
            {removing ? 'Removing...' : 'Remove'}
          </button>
        </div>
      </div>

      {/* Inline 2FA prompt for re-auth */}
      {(reAuthState === '2fa' || reAuthState === '2fa-submitting') && (
        <div className="border-t border-[var(--sl-border)] px-4 py-3.5 bg-amber-500/[0.02]">
          {error && (
            <div className="sl-card !border-red-500/15 !bg-red-500/[0.04] p-2.5 mb-3">
              <p className="text-red-400 text-[12px]">{error}</p>
            </div>
          )}
          <p className="text-[12px] text-[var(--sl-muted)] mb-2.5">Enter the 6-digit code from your trusted Apple device.</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="sl-input !w-32 text-center tracking-[0.3em] font-mono"
              autoFocus
            />
            <button
              onClick={submitReAuth2FA}
              disabled={reAuthState === '2fa-submitting' || code.length !== 6}
              className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500 disabled:opacity-50"
            >
              {reAuthState === '2fa-submitting' ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Verifying
                </span>
              ) : 'Verify'}
            </button>
            <button onClick={() => { setReAuthState('idle'); setCode(''); setError(''); }} className="sl-btn-ghost !text-[12px]">Cancel</button>
          </div>
        </div>
      )}

      {/* Error banner (non-2FA) */}
      {error && reAuthState === 'idle' && (
        <div className="border-t border-[var(--sl-border)] px-4 py-2.5">
          <p className="text-red-400 text-[12px]">{error}</p>
        </div>
      )}
    </div>
  );
}

interface TwoFAInfo {
  requires2FA: boolean;
  authType?: string;
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
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
        setStep('2fa');
      } else {
        toast('success', 'Apple ID signed in successfully');
        onDone();
      }
    } catch (e: unknown) {
      const body = (e as { data?: TwoFAInfo })?.data ?? (e as TwoFAInfo);
      if (body?.requires2FA) {
        setTwoFAInfo(body);
        setStep('2fa');
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
      toast('success', 'Apple ID verified successfully');
      onDone();
    } catch (e: unknown) {
      setError(getErrorMessage(e, '2FA verification failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sl-card p-6 animate-scaleIn">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">
          {step === 'credentials' ? 'Apple ID Sign In' : 'Two-Factor Authentication'}
        </h3>
        <button onClick={onDone} className="sl-btn-ghost !text-[12px] !px-2.5 !py-1">Cancel</button>
      </div>

      {error && (
        <div className="sl-card !border-red-500/15 !bg-red-500/[0.04] p-3 mb-4">
          <p className="text-red-400 text-[12px]">{error}</p>
        </div>
      )}

      {step === 'credentials' ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="apple-id" className="text-[12px] text-[var(--sl-muted)] block mb-1.5">Apple ID</label>
            <input id="apple-id" type="text" autoComplete="email" placeholder="name@example.com" value={appleId} onChange={e => setAppleId(e.target.value)} className="sl-input" />
          </div>
          <div>
            <label htmlFor="apple-pwd" className="text-[12px] text-[var(--sl-muted)] block mb-1.5">Password</label>
            <input id="apple-pwd" type="password" autoComplete="off" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="sl-input" />
          </div>
          <p className="text-[11px] text-[var(--sl-muted)] opacity-60">Your Apple ID is used to sign apps. Credentials are encrypted at rest.</p>
          <button onClick={signIn} disabled={loading || !appleId || !password} className="sl-btn-primary w-full">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Signing in...
              </span>
            ) : 'Sign In'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--sl-muted)]">Enter the 6-digit code from your trusted Apple device.</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="sl-input text-center tracking-[0.5em] font-mono"
            autoFocus
          />
          <button onClick={submit2FA} disabled={loading || code.length !== 6} className="sl-btn-primary w-full">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Verifying...
              </span>
            ) : 'Verify'}
          </button>

          <div className="pt-2 border-t border-[var(--sl-border)]">
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <p className="text-[12px] text-amber-400/90">
                <span className="font-semibold">SMS 2FA is not supported.</span>{' '}
                Sidelink uses trusted-device verification only. Make sure you have a trusted Apple device nearby to receive the 6-digit code.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
