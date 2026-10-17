import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Alert } from '../../api/types';
import { assetUrl } from '../../api/client';
import { AlertDetailModal } from './AlertDetailModal';
import { ALERT_LABEL, formatTime, isSevere, num, pct, timeAgo } from '../../lib/format';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

export interface AlertCardProps {
  alert: Alert;
  onAcknowledge?: (id: string) => void;
  /** Acknowledge and label as a false alarm in one step. */
  onFalseAlarm?: (id: string) => void;
  /** Label an already-acknowledged alert. */
  onFeedback?: (id: string, falseAlarm: boolean) => void;
  acknowledging?: boolean;
  /** Remove from every list (any alert; the only option once an alert has expired). */
  onRemove?: (id: string) => void;
  removing?: boolean;
  compact?: boolean;
}

const ACK_BY: Record<string, string> = { apk: 'Android app', web: 'Web', unknown: 'another device' };

/**
 * Drowsy/microsleep: red glow + slow pulse + red gradient leading edge (until acknowledged).
 * Appears with slide-x + glow, 400 ms.
 */
export function AlertCard({
  alert,
  onAcknowledge,
  onFalseAlarm,
  onFeedback,
  acknowledging,
  onRemove,
  removing,
  compact,
}: AlertCardProps) {
  const severe = isSevere(alert.type);
  const expired = !alert.acknowledged && Boolean(alert.expired);
  const active = !alert.acknowledged && !expired;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const tone = severe ? 'danger' : alert.type === 'warning' ? 'warn' : 'info';
  const [detailOpen, setDetailOpen] = useState(false);
  const snapshot = assetUrl(alert.snapshotUrl);
  const hasDetail = Boolean(snapshot || alert.location);

  // Delivered late (car was offline): show when it happened, not when it arrived.
  const happenedAt = (alert.delayedS && alert.sensorSnapshot?.timestamp) || alert.createdAt;

  return (
    <>
      <motion.article
        layout
        data-testid="alert-card"
        data-severity={tone}
        initial={{ opacity: 0, x: -24, boxShadow: '0 0 0 rgba(239,68,68,0)' }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        whileHover={{ x: 4 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className={[
          'glass relative overflow-hidden border-l-4',
          compact ? 'p-3' : 'p-4',
          severe ? 'border-l-accent-danger' : tone === 'warn' ? 'border-l-accent-warn' : 'border-l-accent-glow',
          severe && active ? 'edge-danger shadow-glow-danger' : '',
          !severe && active && tone === 'warn' ? 'edge-warn' : '',
          !active ? 'opacity-70' : '',
        ].join(' ')}
      >
        {severe && active && (
          <span
            aria-hidden="true"
            data-testid="danger-glow"
            className="pointer-events-none absolute inset-0 rounded-2xl shadow-glow-danger animate-pulse-slow"
          />
        )}
        <div className="relative flex items-start gap-3">
          {snapshot ? (
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              data-testid="alert-snapshot"
              aria-label="View driver snapshot"
              className="relative mt-0.5 h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/15 shadow-depth-2 transition-transform hover:scale-105"
            >
              <img src={snapshot} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <div
              className={[
                'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                severe
                  ? 'bg-accent-danger/25 text-red-300'
                  : tone === 'warn'
                    ? 'bg-accent-warn/20 text-amber-300'
                    : 'bg-accent-primary/25 text-indigo-200',
              ].join(' ')}
            >
              <Icon name={alert.type === 'face_match' ? 'eye' : 'alerts'} size={20} />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="font-semibold text-white">{ALERT_LABEL[alert.type]}</h3>
              <span className="text-sm text-ink-muted">{alert.driverName || 'Driver'}</span>
              <span className="ml-auto text-xs text-ink-muted" title={formatTime(happenedAt)}>
                {timeAgo(happenedAt)}
              </span>
            </div>
            {alert.delayedS ? (
              <p
                data-testid="alert-delayed"
                className="mt-1 inline-flex rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-200"
              >
                Sent {Math.max(1, Math.round(alert.delayedS / 60))} min late: the car was offline
              </p>
            ) : null}

            {alert.sensorSnapshot?.fatigueReason && (
              <p className="mt-1 text-sm text-amber-100/90" data-testid="fatigue-reason">
                {alert.sensorSnapshot.fatigueReason}
              </p>
            )}

            {!compact && (
              <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(70px,1fr))] gap-2 text-xs">
                <div>
                  <dt className="text-ink-muted">Confidence</dt>
                  <dd className="font-semibold text-white">{pct(alert.confidence)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">EAR</dt>
                  <dd className="font-semibold text-white">{num(alert.sensorSnapshot?.ear, 3)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">PERCLOS</dt>
                  <dd className="font-semibold text-white">{pct(alert.sensorSnapshot?.perclos)}</dd>
                </div>
                {typeof alert.sensorSnapshot?.nodCount === 'number' && alert.sensorSnapshot.nodCount > 0 && (
                  <div>
                    <dt className="text-ink-muted">Nods / 5 min</dt>
                    <dd className="font-semibold text-white">{alert.sensorSnapshot.nodCount}</dd>
                  </div>
                )}
                {typeof alert.sensorSnapshot?.yawnCount === 'number' && alert.sensorSnapshot.yawnCount > 0 && (
                  <div>
                    <dt className="text-ink-muted">Yawns / 10 min</dt>
                    <dd className="font-semibold text-white">{alert.sensorSnapshot.yawnCount}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-ink-muted">Heart rate</dt>
                  <dd className="font-semibold text-white">
                    {alert.sensorSnapshot?.heartRate ? `${alert.sensorSnapshot.heartRate} bpm` : '—'}
                  </dd>
                </div>
              </dl>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {hasDetail && (
                <DepthButton
                  size="sm"
                  variant="secondary"
                  icon={<Icon name={alert.location ? 'pin' : 'image'} size={16} />}
                  onClick={() => setDetailOpen(true)}
                  data-testid="alert-detail-button"
                >
                  {snapshot && alert.location ? 'Snapshot & map' : alert.location ? 'Map' : 'Snapshot'}
                </DepthButton>
              )}
              {expired ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-ink-muted"
                  data-testid="expired-label"
                  title="Alerts can only be acknowledged on the day they happen"
                >
                  Unacknowledged · from a previous day
                </span>
              ) : active ? (
                <>
                  {onAcknowledge && (
                    <DepthButton
                      size="sm"
                      variant={severe ? 'danger' : 'primary'}
                      loading={acknowledging}
                      icon={<Icon name="check" size={16} />}
                      onClick={() => onAcknowledge(alert.id)}
                    >
                      Acknowledge
                    </DepthButton>
                  )}
                  {onFalseAlarm && (
                    <DepthButton
                      size="sm"
                      variant="ghost"
                      disabled={acknowledging}
                      onClick={() => onFalseAlarm(alert.id)}
                      title="Acknowledge and report that the driver was not actually drowsy"
                    >
                      False alarm
                    </DepthButton>
                  )}
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300" data-testid="ack-label">
                    <Icon name="check" size={14} />
                    Acknowledged via {ACK_BY[alert.acknowledgedBy ?? 'unknown']}
                    {alert.acknowledgedAt && ` · ${timeAgo(alert.acknowledgedAt)}`}
                  </span>
                  {alert.falseAlarm === true ? (
                    <span className="text-xs text-ink-muted" data-testid="fa-label">
                      · reported as false alarm
                    </span>
                  ) : (
                    onFeedback &&
                    alert.falseAlarm !== false && (
                      <button
                        type="button"
                        className="text-xs text-accent-glow hover:underline"
                        onClick={() => onFeedback(alert.id, true)}
                      >
                        Report false alarm
                      </button>
                    )
                  )}
                </>
              )}
              {onRemove &&
                (confirmRemove ? (
                  <span className="ml-auto inline-flex items-center gap-2 text-xs" data-testid="remove-confirm">
                    <span className="text-ink-muted">Remove this alert?</span>
                    <DepthButton size="sm" variant="danger" loading={removing} onClick={() => onRemove(alert.id)}>
                      Remove
                    </DepthButton>
                    <DepthButton size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Keep
                    </DepthButton>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-white/10 hover:text-white"
                    aria-label="Remove alert"
                    data-testid="remove-alert"
                  >
                    <Icon name="trash" size={14} /> Remove
                  </button>
                ))}
            </div>
          </div>
        </div>
      </motion.article>
      <AnimatePresence>
        {detailOpen && <AlertDetailModal alert={alert} onClose={() => setDetailOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
