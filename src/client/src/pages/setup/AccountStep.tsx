import { useState } from 'react';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import { Field, InlineNotice, StepActions } from './shared';

export function AccountStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean; confirm?: boolean }>({});
  const { toast } = useToast();

  const usernameValid = username.length >= 3;
  const passwordValid = password.length >= 8;
  const confirmValid = confirmPwd.length > 0 && confirmPwd === password;
  const allValid = usernameValid && passwordValid && confirmValid;

  const usernameError = touched.username && username.length > 0 && !usernameValid ? 'Username must be at least 3 characters' : '';
  const passwordError = touched.password && password.length > 0 && !passwordValid ? 'Password must be at least 8 characters' : '';
  const confirmError = touched.confirm && confirmPwd.length > 0 && !confirmValid ? 'Passwords do not match' : '';

  const submit = async () => {
    if (!allValid) return;
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
            aria-label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onBlur={() => setTouched(t => ({ ...t, username: true }))}
            minLength={3}
            placeholder="Choose an admin username"
            className="sl-input w-full"
          />
          {usernameError && <p className="mt-1.5 text-[12px] text-red-400">{usernameError}</p>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="wiz-pwd" label="Password" hint="Minimum 8 chars">
          <input
            id="wiz-pwd"
            type="password"
            autoComplete="new-password"
            aria-label="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onBlur={() => setTouched(t => ({ ...t, password: true }))}
            minLength={8}
            placeholder="At least 8 characters"
            className="sl-input w-full"
          />
          {passwordError && <p className="mt-1.5 text-[12px] text-red-400">{passwordError}</p>}
          </Field>
          <Field htmlFor="wiz-confirm" label="Confirm Password">
          <input
            id="wiz-confirm"
            type="password"
            autoComplete="new-password"
            aria-label="Confirm password"
            value={confirmPwd}
            onChange={e => setConfirmPwd(e.target.value)}
            onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
            className="sl-input w-full"
          />
          {confirmError && <p className="mt-1.5 text-[12px] text-red-400">{confirmError}</p>}
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
        nextDisabled={!allValid}
        loading={loading}
      />
    </div>
  );
}
