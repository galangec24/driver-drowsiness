import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { callReason, useCall } from '../../hooks/useCall';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="tabular-nums">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

/** "Call" on a driver: rings the in-car device, which answers hands-free. */
export function CallButton({
  driverId,
  driverName,
  autoStart = false,
}: {
  driverId: string;
  driverName: string;
  /** Opened from the Android app's "Call" button (?call=1): start right away. */
  autoStart?: boolean;
}) {
  const { state, muted, start, hangUp, toggleMute, reset, ready } = useCall();
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && ready && !started.current) {
      started.current = true;
      void start(driverId);
    }
  }, [autoStart, ready, driverId, start]);
  const open = state.phase !== 'idle';
  const first = driverName.split(' ')[0];

  const status =
    state.phase === 'starting'
      ? 'Getting the microphone…'
      : state.phase === 'ringing'
        ? `Calling ${first}'s car… it answers by itself in a few seconds`
        : state.phase === 'connecting'
          ? 'Connecting…'
          : state.phase === 'connected'
            ? 'Connected'
            : state.phase === 'ended'
              ? callReason(state.reason)
              : '';

  return (
    <>
      <DepthButton
        variant="secondary"
        icon={<Icon name="phone" size={18} />}
        onClick={() => void start(driverId)}
        data-testid="call-button"
        title="Call the car (the driver doesn't need to touch anything)"
      >
        Call
      </DepthButton>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-label={`Call with ${driverName}`}
              className="glass flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl p-6 text-center"
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              data-testid="call-dialog"
            >
              <div
                className={`flex h-20 w-20 items-center justify-center rounded-full bg-accent-primary/30 text-white shadow-glow ${state.phase === 'ringing' ? 'animate-pulse' : ''}`}
              >
                <Icon name="phone" size={36} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{driverName}</h2>
                <p className="mt-1 text-sm text-ink-muted" data-testid="call-status">
                  {status}
                </p>
                {state.phase === 'connected' && (
                  <p className="mt-1 text-lg font-semibold text-white">
                    <Timer since={state.since} />
                  </p>
                )}
              </div>
              {state.phase === 'ended' ? (
                <DepthButton onClick={reset}>Close</DepthButton>
              ) : (
                <div className="flex gap-3">
                  {state.phase === 'connected' && (
                    <DepthButton variant="secondary" onClick={toggleMute} aria-pressed={muted}>
                      {muted ? 'Unmute' : 'Mute'}
                    </DepthButton>
                  )}
                  <DepthButton variant="danger" onClick={hangUp} data-testid="hang-up">
                    Hang up
                  </DepthButton>
                </div>
              )}
              <p className="text-[11px] text-ink-muted">
                Keep it short: the driver hears you on the car speaker and answers hands-free.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
