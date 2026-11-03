import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

/** "Why we ask for your mobile number": shown from the sign-up form and Settings → Profile. */
export function PhoneInfoDialog({ onClose }: { onClose: () => void }) {
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-info-title"
        data-testid="phone-info-dialog"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-md rounded-b-none bg-ink-900/95 p-6 shadow-depth-3 sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-primary/20 text-accent-glow">
            <Icon name="phone" size={22} />
          </span>
          <h2 id="phone-info-title" className="text-lg font-bold text-white">
            Why your mobile number?
          </h2>
        </div>
        <div className="flex flex-col gap-3 text-sm text-ink-muted">
          <p>
            <strong className="text-white">So you're told even when you're offline.</strong> If a driver becomes drowsy
            or briefly falls asleep at the wheel, we send a text message to this number, with the time and a map link to
            where it happened.
          </p>
          <p>
            A text arrives without mobile data or Wi-Fi, and with the app closed, so you can call the driver right away.
            Alerts in the app and notifications still work as usual.
          </p>
          <p>
            We only text for drowsiness, once per alert and at most a few times a day. We never share your number. You
            can change or remove it any time in Settings → Profile.
          </p>
        </div>
        <div className="mt-5 flex justify-end">
          <DepthButton onClick={onClose}>Got it</DepthButton>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
