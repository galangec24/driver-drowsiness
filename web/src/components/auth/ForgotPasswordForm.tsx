import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { forgotPassword, resetPassword, type AuthResponse } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { DepthButton } from '../ui/DepthButton';
import { FloatingInput } from '../ui/FloatingInput';
import { Icon } from '../ui/Icon';

export interface ForgotPasswordFormProps {
  initialEmail?: string;
  onDone: (res: AuthResponse) => void;
  onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forgot password: e-mail a 6-digit code, then enter it with a new password (signs in). */
export function ForgotPasswordForm({ initialEmail = '', onDone, onBack }: ForgotPasswordFormProps) {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email.trim())) {
      setErrors({ email: 'Enter a valid email' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await forgotPassword(email.trim());
      setWait(r.retryAfterS);
      setStep('reset');
      setInfo('If an account uses this e-mail, a 6-digit code is on its way. Check your inbox and spam folder.');
    } catch (err) {
      setError(errorMessage(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setError('');
    const found: Record<string, string> = {};
    if (!/^\d{6}$/.test(code.trim())) found.code = 'Enter the 6-digit code';
    if (password.length < 8) found.password = 'Use at least 8 characters';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      onDone(await resetPassword(email.trim(), code.trim(), password));
    } catch (err) {
      setError(errorMessage(err, 'Could not reset the password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      onSubmit={step === 'email' ? sendCode : submitReset}
      noValidate
      className="flex flex-col gap-4"
      data-testid="forgot-form"
      aria-busy={busy}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/25 text-accent-glow shadow-glow">
          <Icon name="lock" size={28} />
        </span>
        <h2 className="text-xl font-bold text-white">Reset your password</h2>
        <p className="text-sm text-ink-muted">
          {step === 'email'
            ? "Enter your account's e-mail and we'll send you a 6-digit code."
            : `Enter the code sent to ${email.trim()} and choose a new password.`}
        </p>
      </div>

      {step === 'email' ? (
        <FloatingInput
          label="Email"
          type="email"
          autoComplete="email"
          icon={<Icon name="mail" size={18} />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
      ) : (
        <>
          <FloatingInput
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            icon={<Icon name="shield" size={18} />}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            error={errors.code}
          />
          <FloatingInput
            label="New password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            icon={<Icon name="lock" size={18} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            trailing={
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-white/10 hover:text-white"
              >
                <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
              </button>
            }
          />
        </>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-center text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {info && !error && step === 'reset' && <p className="text-center text-sm text-emerald-200">{info}</p>}

      <DepthButton type="submit" size="lg" block loading={busy}>
        {step === 'email' ? 'Send code' : 'Reset password and sign in'}
      </DepthButton>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-ink-muted hover:text-white">
          ← Back to sign in
        </button>
        {step === 'reset' && (
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={wait > 0 || busy}
            className="font-semibold text-accent-glow hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
          >
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </button>
        )}
      </div>
    </motion.form>
  );
}
