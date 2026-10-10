import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

export interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Lift on hover (default true). Disable for static containers like forms. */
  interactive?: boolean;
  /** Red glow + slow pulse for drowsy alerts. */
  danger?: boolean;
  padded?: boolean;
}

/**
 * The base 3D surface: glass + blur + border, depth-2 at rest, depth-3 on hover,
 * whileHover lift. Enters with fade + scale 0.98 → 1 (250 ms).
 */
export function GlassCard({
  children,
  interactive = true,
  danger = false,
  padded = true,
  className = '',
  ...rest
}: GlassCardProps) {
  return (
    <motion.div
      data-testid="glass-card"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      whileHover={interactive ? { y: -4, scale: 1.01 } : undefined}
      className={[
        'glass relative',
        interactive ? 'glass-hover' : '',
        danger ? 'border-accent-danger/50 shadow-glow-danger' : '',
        padded ? 'p-5' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {danger && (
        <span
          aria-hidden="true"
          data-testid="danger-glow"
          className="pointer-events-none absolute inset-0 rounded-2xl shadow-glow-danger animate-pulse-slow"
        />
      )}
      {children}
    </motion.div>
  );
}
