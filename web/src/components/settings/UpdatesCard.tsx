import { useEffect, useState } from 'react';
import { GlassCard } from '../ui/GlassCard';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';
import type { DesktopUpdateState } from '../auth/AppGoogleButton';

const DESKTOP_TEXT: Record<DesktopUpdateState['status'], string> = {
  idle: '',
  checking: 'Checking for updates…',
  'up-to-date': 'You have the latest version.',
  downloading: 'Downloading the update in the background. You will be asked to restart when it is ready.',
  ready: 'The update is ready.',
  error: 'Could not check for updates. Check your internet connection.',
  dev: 'Updates are only checked in the installed app.',
};

/**
 * "Updates": the Windows app updates itself from the GitHub releases (this card shows its version
 * and a Check button); the website updates itself through its service worker.
 */
export function UpdatesCard() {
  const desktop = typeof window !== 'undefined' ? window.guardianDesktop : undefined;
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [webMsg, setWebMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    desktop
      ?.appInfo?.()
      .then((info) => {
        setAppVersion(info.version);
        if (info.update.status !== 'idle') setState(info.update);
      })
      .catch(() => {});
  }, [desktop]);

  async function checkDesktop() {
    if (!desktop?.checkForUpdates) return;
    setBusy(true);
    setState({ status: 'checking', version: null });
    try {
      setState(await desktop.checkForUpdates());
    } catch {
      setState({ status: 'error', version: null });
    } finally {
      setBusy(false);
    }
  }

  /** Ask the service worker for a newer website; if one installs, the page reloads into it. */
  async function checkWeb() {
    setBusy(true);
    setWebMsg('Checking…');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) {
        setWebMsg('Reload the page to get the latest version.');
        return;
      }
      await reg.update();
      if (reg.installing || reg.waiting) {
        setWebMsg('Updating to the latest version…');
        window.setTimeout(() => window.location.reload(), 1500);
      } else {
        setWebMsg('You have the latest version.');
      }
    } catch {
      setWebMsg('Could not check for updates. Check your internet connection.');
    } finally {
      setBusy(false);
    }
  }

  const inApp = Boolean(desktop?.checkForUpdates);
  return (
    <GlassCard interactive={false} data-testid="updates-card">
      <h2 className="mb-2 text-lg font-bold text-white">Updates</h2>
      {inApp ? (
        <>
          <p className="text-sm text-ink-muted">
            Windows app version <span className="font-semibold text-white">{appVersion ?? '…'}</span>. It checks for
            updates every few hours, downloads them in the background and asks you to restart.
          </p>
          {state && state.status !== 'idle' && (
            <p className="mt-3 text-sm text-indigo-100" role="status">
              {state.version && state.status !== 'up-to-date' ? `Version ${state.version}: ` : ''}
              {DESKTOP_TEXT[state.status]}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {state?.status === 'ready' ? (
              <DepthButton icon={<Icon name="refresh" size={18} />} onClick={() => void desktop?.installUpdate?.()}>
                Restart and update
              </DepthButton>
            ) : (
              <DepthButton
                variant="secondary"
                icon={<Icon name="refresh" size={18} />}
                loading={busy}
                disabled={state?.status === 'downloading'}
                onClick={() => void checkDesktop()}
              >
                Check for updates
              </DepthButton>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {desktop
              ? 'This Windows app is an older version without automatic updates: download the latest installer from the download page once.'
              : `Website version ${__APP_VERSION__}. The website updates itself; check now to get changes published in the last hour.`}
          </p>
          {webMsg && (
            <p className="mt-3 text-sm text-indigo-100" role="status">
              {webMsg}
            </p>
          )}
          <div className="mt-4">
            <DepthButton
              variant="secondary"
              icon={<Icon name="refresh" size={18} />}
              loading={busy}
              onClick={() => void checkWeb()}
            >
              Check for updates
            </DepthButton>
          </div>
        </>
      )}
    </GlassCard>
  );
}
