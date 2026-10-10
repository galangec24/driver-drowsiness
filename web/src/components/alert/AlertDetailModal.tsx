import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { Alert } from '../../api/types';
import { assetUrl } from '../../api/client';
import { ALERT_LABEL, formatTime, num, pct } from '../../lib/format';
import { LocationMap } from '../map/LocationMap';
import { Icon } from '../ui/Icon';

/** What happened, who was driving (camera snapshot) and where (map + directions). */
export function AlertDetailModal({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const snapshot = assetUrl(alert.snapshotUrl);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${ALERT_LABEL[alert.type]} details`}
        data-testid="alert-detail"
        initial={{ y: 40, opacity: 0, rotateX: 8 }}
        animate={{ y: 0, opacity: 1, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        style={{ transformPerspective: 1000 }}
        onClick={(e) => e.stopPropagation()}
        className="glass max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-b-none bg-ink-900/90 p-5 shadow-depth-3 sm:rounded-2xl"
      >
        <header className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white">
              {ALERT_LABEL[alert.type]} · {alert.driverName || 'Driver'}
            </h2>
            <p className="text-sm text-ink-muted">{formatTime(alert.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-2 text-ink-muted transition-colors hover:bg-glass-light hover:text-white"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h3 className="label mb-2">Driver at the moment of the alert</h3>
            {snapshot ? (
              <a href={snapshot} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-white/10 shadow-depth-2">
                <img src={snapshot} alt={`${alert.driverName || 'Driver'} when the alert fired`} className="w-full object-cover" />
              </a>
            ) : (
              <div className="glass-inset flex aspect-[4/3] flex-col items-center justify-center gap-2 text-center text-sm text-ink-muted">
                <Icon name="image" size={30} />
                <p>No camera snapshot for this alert.</p>
              </div>
            )}
            <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
              {[
                ['Confidence', pct(alert.confidence)],
                ['EAR', num(alert.sensorSnapshot?.ear, 3)],
                ['PERCLOS', pct(alert.sensorSnapshot?.perclos)],
                ['HR', alert.sensorSnapshot?.heartRate ? `${alert.sensorSnapshot.heartRate}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="glass-inset px-2 py-1.5">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="font-semibold text-white">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="label mb-2">Where it happened</h3>
            <LocationMap location={alert.location} mode="event" height={240} title="Alert location on Google Maps" />
          </section>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
