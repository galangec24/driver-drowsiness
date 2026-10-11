import { useEffect, useRef, useState } from 'react';
import { authConfig, newHandoffId, pollHandoff, type AuthResponse } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { DepthButton } from '../ui/DepthButton';
import { Spinner } from '../ui/Spinner';

export interface DesktopUpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'dev';
  version: string | null;
  message?: string;
}

/** Bridge exposed by the Windows app (desktop/preload.js). Version/update calls need app 1.0.5+. */
export interface DesktopBridge {
  openExternal: (url: string) => Promise<void>;
  appInfo?: () => Promise<{ version: string; update: DesktopUpdateState }>;
  checkForUpdates?: () => Promise<DesktopUpdateState>;
  installUpdate?: () => Promise<DesktopUpdateState>;
}
declare global {
  interface Window {
    guardianDesktop?: DesktopBridge;
  }
}

/** Running inside the Guardian Drive Windows app (Google won't sign in inside its window). */
export function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && Boolean(window.guardianDesktop?.openExternal);
}

const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" for the Windows app: Google refuses sign-in inside embedded app windows,
 * so it opens the website's /app-login page in the user's normal browser and waits for the session
 * handed back through the server (one-time, expires in 5 minutes).
 */
export function AppGoogleButton({ onSignedIn }: { onSignedIn: (res: AuthResponse) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const done = useRef(onSignedIn);
  done.current = onSignedIn;

  useEffect(() => {
    let alive = true;
    authConfig()
      .then((c) => alive && setEnabled(Boolean(c.googleClientId)))
      .catch(() => {});
    return () => {
      alive = false;
      cancelled.current = true;
    };
  }, []);

  async function start() {
    const id = newHandoffId();
    setError('');
    cancelled.current = false;
    setWaiting(true);
    try {
      await window.guardianDesktop!.openExternal(`${window.location.origin}/app-login?handoff=${id}&app=windows`);
    } catch {
      setWaiting(false);
      setError('Could not open your browser.');
      return;
    }
    const until = Date.now() + GIVE_UP_MS;
    while (!cancelled.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled.current) return;
      try {
        const res = await pollHandoff(id);
        if (res) {
          setWaiting(false);
          done.current(res);
          return;
        }
      } catch (err) {
        setError(errorMessage(err, 'Could not check the sign-in'));
      }
    }
    if (!cancelled.current) {
      setWaiting(false);
      setError('Sign-in timed out. Try again.');
    }
  }

  if (!enabled) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="app-google-signin">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-ink-muted">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {waiting ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
          <Spinner size={22} />
          <p className="text-sm text-white">Finish signing in with Google in your browser.</p>
          <p className="text-xs text-ink-muted">This window signs you in automatically when you are done.</p>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              setWaiting(false);
            }}
            className="text-sm font-semibold text-accent-glow hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <DepthButton type="button" variant="secondary" size="lg" block icon={<GoogleG />} onClick={() => void start()}>
          Continue with Google
        </DepthButton>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
