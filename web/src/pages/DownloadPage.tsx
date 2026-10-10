import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import { useAuth } from '../store/auth';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import {
  detectPlatform,
  APK_URL,
  fetchApkInfo,
  formatBytes,
  isStandalone,
  shareableOrigin,
  type ApkInfo,
  type Platform,
} from '../lib/platform';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { ParallaxScene } from '../components/ui/ParallaxScene';
import { Spinner } from '../components/ui/Spinner';
import { TiltCard, TiltLayer } from '../components/ui/TiltCard';

const ANDROID_STEPS = [
  'Tap **Download APK** and wait for the download to finish.',
  'Open the file from the notification or your **Downloads** folder.',
  'If Android asks, allow your browser to **install unknown apps** (Settings → toggle on → back).',
  'Tap **Install**. If Play Protect warns about an unknown developer, choose **More details → Install anyway**.',
  'Open **Guardian Drive**, sign in, and allow notifications so alerts reach you.',
];

const IOS_STEPS = [
  'Open this page in **Safari**.',
  'Tap the **Share** button (square with an arrow).',
  'Scroll down and tap **Add to Home Screen**, then **Add**.',
  'Open **Guardian Drive** from your home screen and sign in.',
];

const ANDROID_WEB_STEPS = [
  'Open this page in **Chrome**.',
  'Tap **Install web app** above, or the menu **⋮** → **Add to Home screen** / **Install app**.',
  'Open **Guardian Drive** from your home screen and sign in.',
];

const DESKTOP_STEPS = [
  'In Chrome or Edge, click the **install icon** in the address bar (or the button above).',
  'Or open the browser menu **⋮** → **Install Guardian Drive**.',
  'The app opens in its own window and appears in your Start menu / Applications.',
];

/** Renders **bold** segments; the step texts are our own constants. */
function rich(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 ? <strong key={i} className="text-white">{part}</strong> : part));
}

function Steps({ steps, testId }: { steps: string[]; testId: string }) {
  return (
    <ol className="mt-4 flex flex-col gap-2.5 text-sm text-ink-muted" data-testid={testId}>
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-primary/30 text-xs font-bold text-white">
            {i + 1}
          </span>
          <span className="pt-0.5">{rich(s)}</span>
        </li>
      ))}
    </ol>
  );
}

function OptionCard({
  icon,
  title,
  subtitle,
  recommended,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  recommended?: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <motion.section
      data-testid={testId}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={[
        'glass relative flex flex-col p-6',
        recommended ? 'border-accent-glow/60 shadow-glow' : '',
      ].join(' ')}
    >
      {recommended && (
        <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-accent-glow to-accent-primary px-3 py-1 text-xs font-bold text-white shadow-glow">
          Recommended for this device
        </span>
      )}
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-accent-primary/25 text-accent-glow">
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <p className="text-sm text-ink-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </motion.section>
  );
}

export function DownloadPage() {
  const { token } = useAuth();
  const { available: canPromptInstall, install } = useInstallPrompt();
  const [platform] = useState<Platform>(() => detectPlatform());
  const [installed] = useState(isStandalone);
  const [apk, setApk] = useState<ApkInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const pageUrl = `${shareableOrigin()}/download`;
  const secure = window.isSecureContext;

  useEffect(() => {
    let alive = true;
    void fetchApkInfo().then((info) => alive && setApk(info));
    QRCode.toString(pageUrl, { type: 'svg', margin: 1, color: { dark: '#0b0d1f', light: '#ffffff' } })
      .then((svg) => alive && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [pageUrl]);

  const androidCard = (
    <OptionCard
      key="android"
      testId="option-android"
      recommended={platform === 'android'}
      icon={<Icon name="download" size={24} />}
      title="Android app"
      subtitle="Full app with alert notifications, camera enrollment and maps"
    >
      <div className="mt-5">
        {apk === null ? (
          <div className="flex h-12 items-center text-accent-glow">
            <Spinner size={22} />
          </div>
        ) : apk.available ? (
          <>
            <a href={APK_URL} download="GuardianDrive.apk" className="block">
              <DepthButton size="lg" block icon={<Icon name="download" size={20} />}>
                Download APK
              </DepthButton>
            </a>
            <p className="mt-2 text-xs text-ink-muted" data-testid="apk-meta">
              Version {__APP_VERSION__}
              {apk.sizeBytes ? ` · ${formatBytes(apk.sizeBytes)}` : ''}
              {apk.updatedAt ? ` · updated ${new Date(apk.updatedAt).toLocaleDateString()}` : ''} · Android 64-bit
              (most phones from 2017 on)
            </p>
          </>
        ) : (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" data-testid="apk-missing">
            The Android app isn’t published on this server yet. Use the web app below meanwhile.
          </p>
        )}
      </div>
      <Steps steps={ANDROID_STEPS} testId="steps-android" />
      {platform !== 'android' && (
        <p className="mt-4 text-xs text-ink-muted">On a computer? Scan the QR code with your Android phone instead.</p>
      )}
    </OptionCard>
  );

  const webCard = (
    <OptionCard
      key="web"
      testId="option-web"
      recommended={platform !== 'android'}
      icon={<Icon name="dashboard" size={24} />}
      title={platform === 'ios' ? 'iPhone & iPad' : 'Web app'}
      subtitle="Installs from the browser, with no app store, and updates itself"
    >
      <div className="mt-5">
        {installed ? (
          <p className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
            <Icon name="check" size={18} /> Guardian Drive is already installed on this device.
          </p>
        ) : canPromptInstall ? (
          <DepthButton size="lg" block icon={<Icon name="plus" size={20} />} onClick={() => void install()}>
            Install web app
          </DepthButton>
        ) : !secure ? (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" data-testid="needs-https">
            Installing the web app needs a secure (https) address. It works once the site is deployed; on this
            local test address use the Android app, or open the site in the browser.
          </p>
        ) : null}
      </div>
      <Steps
        steps={platform === 'ios' ? IOS_STEPS : platform === 'android' ? ANDROID_WEB_STEPS : DESKTOP_STEPS}
        testId="steps-web"
      />
    </OptionCard>
  );

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 sm:py-14">
      <div className="mesh-bg animate-mesh" aria-hidden="true" />
      <ParallaxScene />

      <div className="relative mx-auto flex max-w-content flex-col gap-10">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
            <span className="text-lg font-extrabold text-white">Guardian Drive</span>
          </Link>
          <Link to={token ? '/' : '/login'} className="text-sm font-semibold text-accent-glow hover:underline">
            {token ? 'Open dashboard →' : 'Sign in →'}
          </Link>
        </header>

        <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
              Get Guardian Drive on{' '}
              <span className="bg-gradient-to-r from-accent-glow to-accent-ok bg-clip-text text-transparent">your phone</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-muted">
              Live drowsiness alerts, the driver’s location with directions, and a snapshot when something happens, on
              Android, iPhone or your computer. Free, and no app store needed.
            </p>
          </motion.div>

          <TiltCard className="mx-auto w-full max-w-xs">
            <div className="glass flex flex-col items-center p-6 text-center" data-testid="qr-card">
              <TiltLayer depth={30}>
                <div className="rounded-2xl bg-white p-3 shadow-depth-3">
                  {qr ? (
                    <img src={qr} alt={`QR code for ${pageUrl}`} className="h-44 w-44" data-testid="qr-code" />
                  ) : (
                    <div className="flex h-44 w-44 items-center justify-center text-ink-900">
                      <Spinner size={28} />
                    </div>
                  )}
                </div>
              </TiltLayer>
              <p className="mt-4 font-semibold text-white">Scan with your phone</p>
              <p className="mt-1 break-all text-xs text-ink-muted">{pageUrl}</p>
            </div>
          </TiltCard>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {platform === 'android' ? [androidCard, webCard] : [webCard, androidCard]}
        </div>

        <p className="text-center text-xs text-ink-muted">
          The app only shows information for your own account. Sign in with the parent account you created on this site.
        </p>
      </div>
    </div>
  );
}
