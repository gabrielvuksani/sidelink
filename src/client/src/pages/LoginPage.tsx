import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';

export default function LoginPage({ onLogin, sessionExpired }: { onLogin: () => void; sessionExpired?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = 'Sign In — Sidelink'; }, []);

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
    <div className="flex h-screen items-center justify-center bg-[var(--sl-bg)]">
      <div className="w-full max-w-sm px-4 animate-fadeIn">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[var(--sl-accent)]/15 flex items-center justify-center">
            <svg className="w-6 h-6 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="4" y="7" width="11" height="11" rx="4.2" />
              <rect x="9" y="6" width="11" height="11" rx="4.2" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-[var(--sl-text)] mb-1">Sidelink</h1>
        <p className="text-[var(--sl-muted)] text-center text-[13px] mb-8">Sign in to continue.</p>

        {sessionExpired && (
          <div className="sl-card !border-amber-500/20 !bg-amber-500/[0.04] px-4 py-3 mb-4 text-center">
            <p className="text-amber-400 text-[13px]">Your session has expired. Please sign in again.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-user" className="block text-[12px] text-[var(--sl-muted)] mb-1.5">Username</label>
            <input id="login-user" type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="sl-input" autoFocus required />
          </div>
          <div>
            <label htmlFor="login-pwd" className="block text-[12px] text-[var(--sl-muted)] mb-1.5">Password</label>
            <input id="login-pwd" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="sl-input" required />
          </div>

          {error && (
            <div className="sl-card !border-red-500/15 !bg-red-500/[0.04] px-3 py-2">
              <p className="text-red-400 text-[13px]">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="sl-btn-primary w-full">
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
  );
}
