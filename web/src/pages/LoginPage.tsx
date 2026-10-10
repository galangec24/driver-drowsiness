import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { login, register, unverifiedFromError, type AuthResponse } from '../api/auth';
import { OtpForm } from '../components/auth/OtpForm';
import { errorMessage } from '../api/client';
import { useAuth } from '../store/auth';
import { FloatingInput } from '../components/ui/FloatingInput';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { OrbitLoader } from '../components/ui/OrbitLoader';
import { ParallaxScene } from '../components/ui/ParallaxScene';
import { TiltCard, TiltLayer } from '../components/ui/TiltCard';

type Mode = 'login' | 'register';

export function validateAuthForm(
  mode: Mode,
  v: { name: string; email: string; password: string },
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mode === 'register' && !v.name.trim()) errors.name = 'Enter your name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = 'Enter a valid email';
  if (mode === 'register' ? v.password.length < 8 : !v.password) {
    errors.password = mode === 'register' ? 'Use at least 8 characters' : 'Enter your password';
  }
  return errors;
}

const FEATURES = [
  { icon: 'eye', text: 'Eye closure & PERCLOS per driver' },
  { icon: 'pin', text: 'Live location & directions' },
  { icon: 'shield', text: 'False-alarm filtering' },
] as const;

export function LoginPage() {
  const { token, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Waiting for the e-mailed 6-digit code (new account, or sign-in before verifying).
  const [pending, setPending] = useState<{ email: string; retryAfterS: number } | null>(null);

  if (token) {
    const to = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={to} replace />;
  }

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  function finish(res: AuthResponse) {
    setSession(res.token, res.user);
    navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const found = validateAuthForm(mode, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await login(values.email.trim(), values.password)
          : await register(values.name.trim(), values.email.trim(), values.password);
      if ('verificationRequired' in res) {
        setPending({ email: res.email, retryAfterS: res.retryAfterS });
        return;
      }
      finish(res);
    } catch (err) {
      const unverified = unverifiedFromError(err);
      if (unverified) setPending(unverified);
      else setFormError(errorMessage(err, 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="mesh-bg animate-mesh" aria-hidden="true" />
      <ParallaxScene />
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="hidden text-center lg:block lg:text-left"
        >
          <motion.img
            src="/icons/icon.svg"
            alt=""
            className="mx-auto mb-8 h-28 w-28 animate-float drop-shadow-[0_0_40px_rgba(99,102,241,0.7)] lg:mx-0"
            whileHover={{ rotateY: 360, scale: 1.08 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
            style={{ transformPerspective: 600 }}
          />
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight text-white">
            Know they're <span className="bg-gradient-to-r from-accent-glow to-accent-ok bg-clip-text text-transparent">awake</span> at the wheel.
          </h1>
          <p className="mt-4 max-w-md text-lg text-ink-muted">
            Guardian Drive fuses eye closure, PERCLOS and heart rate against each driver's personal baseline — and alerts you
            the instant fatigue sets in.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {FEATURES.map((f, i) => (
              <motion.li
                key={f.text}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12 }}
                className="flex items-center gap-3 text-slate-200"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-accent-primary/25 text-accent-glow shadow-glow">
                  <Icon name={f.icon} size={18} />
                </span>
                {f.text}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <TiltCard className="mx-auto w-full max-w-md">
          <div className="glass relative bg-ink-900/40 p-8 shadow-depth-3" style={{ transformStyle: 'preserve-3d' }}>
            {pending ? (
              <TiltLayer depth={30}>
                <OtpForm
                  email={pending.email}
                  retryAfterS={pending.retryAfterS}
                  onVerified={finish}
                  onBack={() => {
                    setPending(null);
                    setMode('login');
                  }}
                />
              </TiltLayer>
            ) : (
              <>
            <TiltLayer depth={40}>
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <img src="/icons/icon.svg" alt="" className="h-11 w-11 animate-float" />
                <p className="text-xl font-extrabold text-white">Guardian Drive</p>
              </div>

              <div className="glass-inset mb-6 grid grid-cols-2 p-1" role="tablist">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    aria-selected={mode === m}
                    onClick={() => {
                      setMode(m);
                      setErrors({});
                      setFormError('');
                    }}
                    className={`relative h-10 rounded-lg text-sm font-semibold transition-colors ${mode === m ? 'text-white' : 'text-ink-muted'}`}
                  >
                    {mode === m && (
                      <motion.span
                        layoutId="auth-tab"
                        className="absolute inset-0 rounded-lg bg-accent-primary/40 shadow-glow"
                        transition={{ duration: 0.2 }}
                      />
                    )}
                    <span className="relative">{m === 'login' ? 'Sign in' : 'Create account'}</span>
                  </button>
                ))}
              </div>
            </TiltLayer>

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-busy={loading}>
              <AnimatePresence initial={false}>
                {mode === 'register' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <TiltLayer depth={24}>
                      <FloatingInput
                        label="Your name"
                        autoComplete="name"
                        icon={<Icon name="user" size={18} />}
                        value={values.name}
                        onChange={set('name')}
                        error={errors.name}
                      />
                    </TiltLayer>
                  </motion.div>
                )}
              </AnimatePresence>
              <TiltLayer depth={24}>
                <FloatingInput
                  label="Email"
                  type="email"
                  autoComplete="email"
                  icon={<Icon name="mail" size={18} />}
                  value={values.email}
                  onChange={set('email')}
                  error={errors.email}
                />
              </TiltLayer>
              <TiltLayer depth={24}>
                <FloatingInput
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  icon={<Icon name="lock" size={18} />}
                  value={values.password}
                  onChange={set('password')}
                  error={errors.password}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                    </button>
                  }
                />
              </TiltLayer>
              {formError && (
                <motion.p
                  role="alert"
                  initial={{ x: 0 }}
                  animate={{ x: [0, -8, 8, -5, 5, 0] }}
                  transition={{ duration: 0.4 }}
                  className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-sm text-red-200"
                >
                  {formError}
                </motion.p>
              )}
              <TiltLayer depth={36}>
                <DepthButton type="submit" size="lg" block loading={loading}>
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                </DepthButton>
              </TiltLayer>
            </form>
              </>
            )}

            <p className="mt-5 text-center text-sm text-ink-muted">
              <Link to="/download" className="inline-flex items-center gap-1.5 font-semibold text-accent-glow hover:underline">
                <Icon name="download" size={16} /> Get the app for Android, iPhone or computer
              </Link>
            </p>

            <AnimatePresence>
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-ink-950/75 backdrop-blur-sm"
                  style={{ transform: 'translateZ(60px)' }}
                >
                  <OrbitLoader label={mode === 'login' ? 'Signing you in…' : 'Creating your account…'} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </TiltCard>
      </div>
    </div>
  );
}
