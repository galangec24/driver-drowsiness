import { useEffect, useRef, useState } from 'react';
import { authConfig } from '../../api/auth';

/** Minimal typing for Google Identity Services (https://accounts.google.com/gsi/client). */
interface GoogleId {
  initialize(opts: {
    client_id: string;
    callback: (r: { credential?: string }) => void;
    ux_mode?: 'popup';
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiLoading: Promise<GoogleId> | null = null;

function loadGsi(): Promise<GoogleId> {
  gsiLoading ??= new Promise<GoogleId>((resolve, reject) => {
    const done = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('GSI')));
    if (window.google?.accounts?.id) return done();
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  }).catch((err: unknown) => {
    gsiLoading = null;
    throw err;
  });
  return gsiLoading;
}

export interface GoogleButtonProps {
  /** Called with Google's ID token; the caller sends it to the server. */
  onCredential: (credential: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  /** Just the button, without the "or" divider above it. */
  bare?: boolean;
}

/**
 * Google's own "Continue with Google" button. Renders nothing when the server has no Google client
 * id configured (GOOGLE_CLIENT_ID on Render), when offline, or when Google's script is blocked.
 */
export function GoogleButton({ onCredential, text = 'continue_with', bare = false }: GoogleButtonProps) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { googleClientId } = await authConfig();
        if (!googleClientId || !alive) return;
        const gid = await loadGsi();
        if (!alive || !host.current) return;
        gid.initialize({
          client_id: googleClientId,
          callback: (r) => r.credential && cb.current(r.credential),
          ux_mode: 'popup',
          use_fedcm_for_button: true,
        });
        setVisible(true);
        // Measure after it is shown (a hidden element is 0 px wide).
        await new Promise((r) => requestAnimationFrame(r));
        if (!alive || !host.current) return;
        gid.renderButton(host.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'left',
          locale: 'en',
          width: Math.min(400, Math.max(200, host.current.clientWidth || 320)),
        });
      } catch {
        // No Google sign-in: e-mail + password still works.
      }
    })();
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div className={visible ? 'flex flex-col gap-4' : 'hidden'} data-testid="google-signin">
      {!bare && (
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-ink-muted">
          <span className="h-px flex-1 bg-white/10" />
          or
          <span className="h-px flex-1 bg-white/10" />
        </div>
      )}
      {/* The page is color-scheme: dark but Google's iframe is light; when they differ the browser
          paints an opaque box behind the iframe. Matching the scheme keeps the pill's corners clear. */}
      <div ref={host} className="flex min-h-[44px] w-full justify-center" style={{ colorScheme: 'light' }} />
    </div>
  );
}
