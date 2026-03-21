import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { BrandIcon } from '../components/BrandIcon';
import { PasswordInput } from '../components/Shared';

export default function LoginPage({ onLogin, sessionExpired }: { onLogin: () => void; sessionExpired?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = 'Sign In — SideLink'; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.login(username, password);
      onLogin();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--sl-bg)]">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[var(--sl-accent)]/[0.07] blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-[340px] w-[340px] rounded-full bg-[var(--sl-accent-2)]/[0.06] blur-[80px]" />

      <div className="relative z-10 w-full max-w-[400px] px-5 animate-fadeIn">
        <div className="sl-card overflow-hidden p-0">
          <div className="relative border-b border-[var(--sl-border)] bg-[linear-gradient(135deg,rgba(18,30,40,0.98),rgba(8,14,22,0.98))] px-7 pb-7 pt-8 text-center">
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[var(--sl-accent)]/[0.08] blur-2xl" />
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] shadow-lg">
              <BrandIcon className="h-9 w-9" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--sl-text)]">Welcome back</h1>
            <p className="mt-1.5 text-[13px] text-[var(--sl-muted)]">Sign in to SideLink to continue.</p>
          </div>

          <div className="px-7 py-6">
            {sessionExpired && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3.5 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                <p className="text-[13px] leading-relaxed text-amber-300">Your session has expired. Please sign in again.</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-user" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)]">Username</label>
                <input id="login-user" type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="sl-input" autoFocus required />
              </div>
              <div>
                <label htmlFor="login-pwd" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)]">Password</label>
                <PasswordInput id="login-pwd" autoComplete="current-password" value={password} onChange={setPassword} required />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-3.5 py-3">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                  <p className="text-[13px] leading-relaxed text-red-300">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="sl-btn-primary w-full !py-3 !text-[13px]">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in...
                  </span>
                ) : 'Sign In'}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-[11px] text-[var(--sl-muted)]/50">SideLink</p>
          <p className="mt-0.5 text-[10px] text-[var(--sl-muted)]/30">iOS Sideloading Manager</p>
        </div>
      </div>
    </div>
  );
}
