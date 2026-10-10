import { AnimatePresence, motion } from 'framer-motion';
import { useOnline } from '../../hooks/useOnline';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useRealtime } from '../../hooks/useRealtime';
import { readSnapshot } from '../../lib/offlineCache';
import { formatTime } from '../../lib/format';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

export function OfflineBanner() {
  const online = useOnline();
  const { connected } = useRealtime();
  const snapshot = readSnapshot<unknown>('drivers');
  const show = !online || !connected;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          role="status"
          className="glass mb-4 flex items-center gap-3 border-accent-warn/40 px-4 py-3 text-sm"
        >
          <Icon name="wifiOff" className="shrink-0 text-accent-warn" />
          <span className="text-amber-100">
            {online ? 'Live connection lost — reconnecting. Refreshing every 10 s.' : 'You are offline. Showing cached data.'}
            {snapshot && (
              <span className="text-ink-muted"> Last updated {formatTime(snapshot.savedAt)}.</span>
            )}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function InstallBanner() {
  const { canInstall, install, dismiss } = useInstallPrompt();
  return (
    <AnimatePresence>
      {canInstall && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          className="glass mb-4 flex flex-col gap-3 border-accent-glow/40 px-4 py-3 shadow-glow sm:flex-row sm:items-center"
        >
          <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
          <div className="flex-1">
            <p className="font-semibold text-white">Install Guardian Drive</p>
            <p className="text-sm text-ink-muted">Get alerts faster with the app on your home screen.</p>
          </div>
          <div className="flex gap-2">
            <DepthButton variant="ghost" size="sm" onClick={dismiss}>
              Not now
            </DepthButton>
            <DepthButton size="sm" icon={<Icon name="download" size={16} />} onClick={() => void install()}>
              Install
            </DepthButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
