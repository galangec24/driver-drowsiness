import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { changeTemporaryPassword, type AuthResponse } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { DepthButton } from '../ui/DepthButton';
import { FloatingInput } from '../ui/FloatingInput';
import { Icon } from '../ui/Icon';

/**
 * First sign-in of an account an admin created: the temporary password just worked, now the
 * parent chooses their own (the server gives no session until they do).
 */
export function NewPasswordForm({
  email,
  temporaryPassword,
  onDone,
  onBack,
}: {
  email: string;
  temporaryPassword: string;
  onDone: (res: AuthResponse) => void;
  onBack: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const found: typeof errors = {};
    if (password.length < 8) found.password = 'Use at least 8 characters';
    else if (password === temporaryPassword) found.password = 'Choose a password different from the temporary one';
    if (confirm !== password) found.confirm = 'The passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      onDone(await changeTemporaryPassword(email, temporaryPassword, password));
    } catch (err) {
      setError(errorMessage(err, 'Could not change the password'));
    } finally {
      setBusy(false);
    }
  }

  const eye = (
    <button
      type="button"
      onClick={() => setShow((s) => !s)}
      aria-label={show ? 'Hide password' : 'Show password'}
      aria-pressed={show}
      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-white/10 hover:text-white"
    >
      <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
    </button>
  );

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={submit}
      className="flex flex-col gap-4"
      data-testid="new-password-form"
      noValidate
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/25 text-accent-glow shadow-glow">
          <Icon name="lock" size={28} />
        </span>
        <h2 className="text-xl font-bold text-white">Choose your password</h2>
        <p className="text-sm text-ink-muted">
          Your account was set up with a temporary password. Choose your own to continue.
        </p>
      </div>
      <FloatingInput
        label="New password"
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        icon={<Icon name="lock" size={18} />}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        trailing={eye}
      />
      <FloatingInput
        label="Confirm new password"
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        icon={<Icon name="lock" size={18} />}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-center text-sm text-red-200"
        >
          {error}
        </p>
      )}
      <DepthButton type="submit" size="lg" block loading={busy}>
        Save password and sign in
      </DepthButton>
      <button type="button" onClick={onBack} className="text-sm text-ink-muted hover:text-white">
        ← Back to sign in
      </button>
    </motion.form>
  );
}
