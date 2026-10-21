import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../api/client';
import { DepthButton } from '../components/ui/DepthButton';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { AnimatedBackground } from '../components/layout/AnimatedBackground';

function Frame({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen min-h-dvh items-center justify-center p-6">
      <AnimatedBackground />
      <ThemeToggle className="fixed right-4 top-4" />
      <main className="glass flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        <img src="/icons/icon.svg" alt="" className="h-14 w-14 drop-shadow-[0_0_14px_rgba(99,102,241,0.5)]" />
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-glow">{code}</p>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** Unknown link. */
export function NotFoundPage() {
  return (
    <Frame code="404" title="Page not found">
      <p className="text-sm text-ink-muted">
        The page you were looking for doesn't exist or was moved. Check the address, or go back to the dashboard.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/">
          <DepthButton>Go to the dashboard</DepthButton>
        </Link>
        <Link to="/download">
          <DepthButton variant="secondary">Get the app</DepthButton>
        </Link>
      </div>
    </Frame>
  );
}

/** Server in maintenance (MAINTENANCE_MODE=on on Render): checks every 30 s and comes back by itself. */
export function MaintenancePage({ message, onBack }: { message?: string; onBack: () => void }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      setChecking(true);
      try {
        const r = await fetch(`${API_URL}/api/health`, { cache: 'no-store' });
        const body = (await r.json()) as { maintenance?: boolean };
        if (!stop && r.ok && !body.maintenance) onBack();
      } catch {
        // still down: try again
      } finally {
        if (!stop) setChecking(false);
      }
    };
    const t = window.setInterval(check, 30_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [onBack]);
  return (
    <Frame code="Maintenance" title="We'll be right back">
      <p className="text-sm text-ink-muted" data-testid="maintenance-message">
        {message ||
          'Guardian Drive is being updated. The in-car alarm keeps working in the car; live updates come back in a few minutes.'}
      </p>
      <p className="text-xs text-ink-muted">
        {checking ? 'Checking…' : 'This page reloads by itself when we are back.'}
      </p>
    </Frame>
  );
}
