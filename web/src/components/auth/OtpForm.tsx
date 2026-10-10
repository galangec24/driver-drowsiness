import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { resendCode, verifyEmail, type AuthResponse } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

const LENGTH = 6;

export interface OtpFormProps {
  email: string;
  /** Seconds before "Resend code" is allowed (from the server). */
  retryAfterS?: number;
  /** false: the server could not send the e-mail, so say so instead of "we sent a code". */
  emailSent?: boolean;
  onVerified: (res: AuthResponse) => void;
  onBack: () => void;
}

/** "We e-mailed you a 6-digit code": one box per digit, paste-friendly, with resend countdown. */
export function OtpForm({ email, retryAfterS = 60, emailSent = true, onVerified, onBack }: OtpFormProps) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const [error, setError] = useState(
    emailSent ? '' : 'We couldn\'t send the code e-mail just now. Tap "Resend code" to try again.',
  );
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(retryAfterS);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    boxes.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const code = digits.join('');

  async function submit(value = code) {
    if (value.length !== LENGTH) {
      setError('Enter all 6 digits');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onVerified(await verifyEmail(email, value));
    } catch (err) {
      setError(errorMessage(err, 'Verification failed'));
      setDigits(Array(LENGTH).fill(''));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = digits.map((x, j) => (j === i ? d : x));
    setDigits(next);
    if (d && i < LENGTH - 1) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) void submit(next.join(''));
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array.from({ length: LENGTH }, (_, j) => pasted[j] ?? '');
    setDigits(next);
    if (pasted.length === LENGTH) void submit(pasted);
    else boxes.current[pasted.length]?.focus();
  }

  async function resend() {
    setError('');
    try {
      const r = await resendCode(email);
      setWait(r.retryAfterS);
      setInfo('A new code is on its way. Check your inbox (and spam folder).');
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code'));
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-5"
      data-testid="otp-form"
      aria-busy={busy}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/25 text-accent-glow shadow-glow">
          <Icon name="mail" size={28} />
        </span>
        <h2 className="text-xl font-bold text-white">Check your e-mail</h2>
        <p className="text-sm text-ink-muted">
          We sent a 6-digit code to <span className="font-semibold text-white">{email}</span>. It expires in 10 minutes.
        </p>
      </div>

      <div className="flex justify-center gap-2" role="group" aria-label="Verification code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            onPaste={onPaste}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            className="h-14 w-11 rounded-xl border border-white/15 bg-black/30 text-center text-2xl font-bold text-white shadow-inner outline-none transition-all focus:border-accent-glow/70 focus:shadow-glow sm:w-12"
          />
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-center text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {info && !error && <p className="text-center text-sm text-emerald-200">{info}</p>}

      <DepthButton type="submit" size="lg" block loading={busy}>
        Verify and sign in
      </DepthButton>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-ink-muted hover:text-white">
          ← Use a different e-mail
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={wait > 0}
          className="font-semibold text-accent-glow hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
        >
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </div>
    </motion.form>
  );
}
