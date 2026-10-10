import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { API_URL } from '../../api/client';
import { OrbitLoader } from './OrbitLoader';
import { DepthButton } from './DepthButton';

/** Show the overlay only if the server hasn't answered after this long (a warm server answers in ~0.2 s). */
const SHOW_AFTER_MS = 1500;
const GIVE_UP_MS = 75_000;

type State = 'checking' | 'waking' | 'ready' | 'failed';

/**
 * Render's free plan puts the API to sleep after ~15 idle minutes; the first request then takes up to
 * ~50 s. Instead of a frozen screen or "cannot reach the server", show a loader while it wakes up.
 * Offline (no network at all) is not treated as "waking": the app's offline mode takes over.
 */
export function ServerWake() {
  const [state, setState] = useState<State>('checking');
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!navigator.onLine) {
      setState('ready');
      return undefined;
    }
    const ctrl = new AbortController();
    const started = Date.now();
    const showTimer = window.setTimeout(() => setState((s) => (s === 'checking' ? 'waking' : s)), SHOW_AFTER_MS);
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    const giveUp = window.setTimeout(() => ctrl.abort(), GIVE_UP_MS);
    fetch(`${API_URL}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => setState(r.ok ? 'ready' : 'failed'))
      .catch(() => setState(ctrl.signal.aborted ? 'failed' : 'ready'))
      .finally(() => {
        window.clearTimeout(showTimer);
        window.clearTimeout(giveUp);
        window.clearInterval(tick);
      });
    return () => {
      ctrl.abort();
      window.clearTimeout(showTimer);
      window.clearTimeout(giveUp);
      window.clearInterval(tick);
    };
  }, [attempt]);

  const visible = state === 'waking' || state === 'failed';
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="server-wake"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-ink-950/90 px-6 text-center backdrop-blur-sm"
        >
          {state === 'waking' ? (
            <>
              <OrbitLoader size={96} label="Waking up the server…" />
              <p className="max-w-sm text-sm text-ink-muted">
                The free server sleeps when nobody uses it and takes up to a minute to start.
                {elapsed > 0 && <span className="mt-1 block font-mono text-xs text-indigo-200">{elapsed}s</span>}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-white">The server is taking too long to answer</p>
              <p className="max-w-sm text-sm text-ink-muted">Check your internet connection, then try again.</p>
              <div className="flex gap-2">
                <DepthButton
                  onClick={() => {
                    setElapsed(0);
                    setState('checking');
                    setAttempt((a) => a + 1);
                  }}
                >
                  Try again
                </DepthButton>
                <DepthButton variant="ghost" onClick={() => setState('ready')}>
                  Continue offline
                </DepthButton>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
