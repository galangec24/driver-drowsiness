import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const VISITS_KEY = 'gd:visits';
const DISMISSED_KEY = 'gd:install-dismissed';

function bumpVisits(): number {
  try {
    // Count once per browser session, not per render/route.
    if (sessionStorage.getItem('gd:counted')) return Number(localStorage.getItem(VISITS_KEY) || 0);
    sessionStorage.setItem('gd:counted', '1');
    const n = Number(localStorage.getItem(VISITS_KEY) || 0) + 1;
    localStorage.setItem(VISITS_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}

/** Custom "Install Guardian Drive" banner — offered from the 2nd visit on. */
export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visits] = useState(bumpVisits);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const installed = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    setEvent(null);
  }, [event]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  }, []);

  return {
    canInstall: Boolean(event) && visits >= 2 && !dismissed,
    /** The browser offers installation right now (ignores the visit count / dismissal; download page). */
    available: Boolean(event),
    install,
    dismiss,
  };
}
