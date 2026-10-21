import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { googleSignIn } from '../api/auth';
import { errorMessage } from '../api/client';
import { GoogleButton } from '../components/auth/GoogleButton';
import { GlassCard } from '../components/ui/GlassCard';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { AnimatedBackground } from '../components/layout/AnimatedBackground';

const APP_NAME: Record<string, string> = { windows: 'Windows app', android: 'Android app' };

/**
 * Opened in the user's normal browser by the Windows/Android app (?handoff=<id>), because Google
 * blocks sign-in inside embedded app browsers. After "Continue with Google" the server hands the
 * session to the waiting app; this page only says "go back to the app".
 */
export function AppLoginPage() {
  const [params] = useSearchParams();
  const handoff = params.get('handoff') ?? '';
  const app = APP_NAME[params.get('app') ?? ''] ?? 'app';
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const valid = /^[A-Za-z0-9_-]{32,128}$/.test(handoff);

  async function onCredential(credential: string) {
    setState('busy');
    setError('');
    try {
      const res = await googleSignIn(credential, handoff);
      setName(res.user.name.split(' ')[0] ?? '');
      setState('done');
    } catch (err) {
      setError(errorMessage(err, 'Google sign-in failed'));
      setState('ready');
    }
  }

  return (
    <div className="relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <AnimatedBackground />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <GlassCard
          interactive={false}
          className="flex flex-col items-center gap-4 p-8 text-center"
          data-testid="app-login"
        >
          <img src="/icons/icon.svg" alt="" className="h-14 w-14 animate-float" />
          {!valid ? (
            <>
              <h1 className="text-xl font-bold text-white">This sign-in link is incomplete</h1>
              <p className="text-sm text-ink-muted">
                Start again from “Continue with Google” in the Guardian Drive app.
              </p>
              <Link to="/login" className="text-sm font-semibold text-accent-glow hover:underline">
                Sign in on the website instead
              </Link>
            </>
          ) : state === 'done' ? (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-ok/20 text-emerald-300">
                <Icon name="check" size={30} />
              </span>
              <h1 className="text-xl font-bold text-white">You're signed in{name ? `, ${name}` : ''}!</h1>
              <p className="text-sm text-ink-muted">
                Go back to the Guardian Drive {app}: it opens your account in a moment. You can close this tab.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-white">Sign in to the Guardian Drive {app}</h1>
              <p className="text-sm text-ink-muted">
                Continue with your Google account here. The app signs you in automatically when you are done.
              </p>
              {state === 'busy' ? (
                <div className="flex h-11 items-center text-accent-glow">
                  <Spinner size={22} />
                </div>
              ) : (
                <div className="w-full">
                  <GoogleButton onCredential={(c) => void onCredential(c)} text="continue_with" bare />
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-200">
                  {error}
                </p>
              )}
            </>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}
