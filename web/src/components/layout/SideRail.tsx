import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icon } from '../ui/Icon';
import { navItemsFor } from './nav';
import { useAuth } from '../../store/auth';
import { useRealtime } from '../../hooks/useRealtime';

/** Desktop/tablet navigation: icon rail ≥640 px, full labels ≥1024 px. */
export function SideRail({ unacknowledged = 0 }: { unacknowledged?: number }) {
  const { connected } = useRealtime();
  const { user } = useAuth();
  return (
    <aside
      data-testid="side-rail"
      className="glass fixed inset-y-4 left-4 z-30 hidden w-20 flex-col items-center gap-2 px-2 py-5 sm:flex lg:w-60 lg:items-stretch lg:px-4"
    >
      <div className="mb-6 flex items-center gap-3 lg:px-2">
        <img src="/icons/icon.svg" alt="" className="h-10 w-10 animate-float drop-shadow-[0_0_12px_rgba(99,102,241,0.6)]" />
        <div className="hidden lg:block">
          <p className="text-sm font-extrabold leading-tight text-white">Guardian Drive</p>
          <p className="text-xs text-ink-muted">Parent console</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5">
        {navItemsFor(user?.role).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} title={item.label}>
            {({ isActive }) => (
              <motion.span
                whileHover={{ x: 4 }}
                className={[
                  'relative flex h-12 items-center justify-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors lg:justify-start',
                  isActive
                    ? 'bg-accent-primary/25 text-white shadow-glow'
                    : 'text-ink-muted hover:bg-glass-hover hover:text-white',
                ].join(' ')}
              >
                <Icon name={item.icon} />
                <span className="hidden lg:inline">{item.label}</span>
                {item.to === '/alerts' && unacknowledged > 0 && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-accent-danger px-1.5 text-[10px] font-bold text-white shadow-glow-danger lg:static lg:ml-auto lg:text-xs">
                    {unacknowledged > 99 ? '99+' : unacknowledged}
                  </span>
                )}
              </motion.span>
            )}
          </NavLink>
        ))}
      </nav>

      <div
        className="flex items-center justify-center gap-2 rounded-xl bg-black/20 px-3 py-2 text-xs text-ink-muted lg:justify-start"
        title={connected ? 'Live connection' : 'Reconnecting…'}
      >
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-accent-ok shadow-[0_0_8px_#10b981]' : 'bg-accent-warn animate-pulse'}`} />
        <span className="hidden lg:inline">{connected ? 'Live' : 'Reconnecting…'}</span>
      </div>
    </aside>
  );
}
