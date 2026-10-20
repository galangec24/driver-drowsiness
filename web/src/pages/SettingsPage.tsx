import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APK_URL } from '../lib/platform';
import { pushConfig } from '../api/auth';
import { useAuth } from '../store/auth';
import { useRealtime } from '../hooks/useRealtime';
import { GlassCard } from '../components/ui/GlassCard';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';
import { clearSnapshots } from '../lib/offlineCache';
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported } from '../lib/notify';
import { markFarewell } from '../lib/farewell';
import { UpdatesCard } from '../components/settings/UpdatesCard';
import { AboutCard } from '../components/settings/AboutCard';
import { RateAppCard } from '../components/settings/RateAppCard';
import { AppearanceCard } from '../components/ui/ThemeToggle';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-3 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-white">{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { connected } = useRealtime();
  const qc = useQueryClient();
  const toast = useToast();
  const [notify, setNotify] = useState(notificationsEnabled);
  const push = useQuery({ queryKey: ['pushConfig'], queryFn: pushConfig, staleTime: 5 * 60e3 });

  async function toggleNotifications() {
    if (notify) {
      disableNotifications();
      setNotify(false);
      return;
    }
    const ok = await enableNotifications();
    setNotify(ok);
    toast.show(
      ok
        ? {
            title: 'Notifications on',
            body: 'You will be notified of alerts while this tab is in the background.',
            tone: 'success',
          }
        : {
            title: 'Notifications blocked',
            body: 'Allow notifications for this site in your browser settings.',
            tone: 'warn',
          },
    );
  }

  function signOut() {
    markFarewell(user?.name);
    clearSnapshots();
    qc.clear();
    logout();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Settings</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard interactive={false}>
          <h2 className="mb-2 text-lg font-bold text-white">Account</h2>
          <Row label="Name">{user?.name}</Row>
          <Row label="Email">{user?.email}</Row>
          <Row label="Role">
            <span className="capitalize">{user?.role}</span>
          </Row>
          <div className="mt-4">
            <DepthButton variant="secondary" icon={<Icon name="logout" size={18} />} onClick={signOut}>
              Sign out
            </DepthButton>
          </div>
        </GlassCard>

        <GlassCard interactive={false}>
          <h2 className="mb-2 text-lg font-bold text-white">Notifications</h2>
          <Row label="Live connection">
            <span className={connected ? 'text-emerald-300' : 'text-amber-300'}>
              {connected ? 'Connected' : 'Reconnecting…'}
            </span>
          </Row>
          <Row label="Browser notifications">
            {notificationsSupported() ? (
              <button
                role="switch"
                aria-checked={notify}
                onClick={() => void toggleNotifications()}
                className={`relative h-7 w-12 rounded-full border border-white/15 shadow-inner transition-colors ${notify ? 'bg-accent-primary shadow-glow' : 'bg-black/30'}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-depth-1 transition-all ${notify ? 'left-6' : 'left-0.5'}`}
                />
              </button>
            ) : (
              'Not supported'
            )}
          </Row>
          <Row label="Web Push (FCM)">
            {push.isLoading ? '…' : push.data?.enabled ? 'Enabled by server' : 'Not configured on server'}
          </Row>
        </GlassCard>

        <UpdatesCard />

        <AppearanceCard />

        <RateAppCard />

        <GlassCard interactive={false} data-testid="surveys-card">
          <h2 className="mb-2 text-lg font-bold text-white">Surveys</h2>
          <p className="mb-4 text-sm text-ink-muted">Answer short surveys from the Guardian Drive team.</p>
          <Link to="/surveys">
            <DepthButton variant="secondary">Open surveys</DepthButton>
          </Link>
        </GlassCard>

        <GlassCard interactive={false} data-testid="feedback-card">
          <h2 className="mb-2 text-lg font-bold text-white">Feedback</h2>
          <p className="mb-4 text-sm text-ink-muted">
            Found a problem or have an idea? Send it to the team, with screenshots or files. You will see the reply
            here.
          </p>
          <Link to="/feedback">
            <DepthButton icon={<Icon name="mail" size={18} />}>Send feedback</DepthButton>
          </Link>
        </GlassCard>

        <GlassCard interactive={false}>
          <h2 className="mb-2 text-lg font-bold text-white">Get the app</h2>
          <p className="mb-4 text-sm text-ink-muted">
            Install Guardian Drive on Android (APK), iPhone or your computer. The download page has a QR code and
            step-by-step instructions for each device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/download">
              <DepthButton icon={<Icon name="download" size={18} />}>Download page</DepthButton>
            </Link>
            <a href={APK_URL} download="GuardianDrive.apk">
              <DepthButton variant="secondary">Download APK directly</DepthButton>
            </a>
          </div>
        </GlassCard>

        <AboutCard
          footer={
            <Row label="Offline cache">
              <button
                className="text-accent-glow hover:underline"
                onClick={() => {
                  clearSnapshots();
                  toast.show({ title: 'Offline cache cleared', tone: 'info' });
                }}
              >
                Clear
              </button>
            </Row>
          }
        />
      </div>
    </div>
  );
}
