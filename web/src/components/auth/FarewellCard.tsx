import { motion } from 'framer-motion';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

/** Shown on the sign-in card right after the user signs out. */
export function FarewellCard({ name, onSignInAgain }: { name: string; onSignInAgain: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      className="flex flex-col items-center gap-4 text-center"
      data-testid="farewell"
      role="status"
    >
      <div className="relative">
        <motion.span
          className="absolute inset-0 rounded-full bg-accent-ok/30 blur-xl"
          animate={{ opacity: [0.4, 0.9, 0.4], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        />
        <motion.span
          initial={{ rotate: -20, scale: 0.6 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
          className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-accent-primary to-accent-ok text-onaccent shadow-glow"
        >
          <Icon name="shield" size={40} />
        </motion.span>
      </div>
      <div>
        <h2 className="text-2xl font-extrabold text-white">
          Thanks for using Guardian Drive{name ? `, ${name}` : ''}!
        </h2>
        <p className="mt-2 text-sm text-ink-muted">You have been signed out safely.</p>
      </div>
      <div className="w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left text-sm text-ink-muted">
        <p className="font-semibold text-white">While you are away</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          <li className="flex gap-2">
            <Icon name="eye" size={16} /> The in-car monitor keeps watching for drowsiness.
          </li>
          <li className="flex gap-2">
            <Icon name="alerts" size={16} /> Sign in again to receive alerts on this device.
          </li>
        </ul>
      </div>
      <p className="text-sm font-semibold text-emerald-200">Drive safe and stay awake at the wheel.</p>
      <DepthButton size="lg" block icon={<Icon name="user" size={18} />} onClick={onSignInAgain}>
        Sign in again
      </DepthButton>
    </motion.div>
  );
}
