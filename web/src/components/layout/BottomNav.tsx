import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { navItemsFor } from './nav';
import { useAuth } from '../../store/auth';

/** Mobile navigation (< 640 px). */
export function BottomNav({ unacknowledged = 0 }: { unacknowledged?: number }) {
  const { user } = useAuth();
  return (
    <nav
      data-testid="bottom-nav"
      className="glass fixed inset-x-3 bottom-3 z-30 flex h-16 items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {navItemsFor(user?.role).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            [
              'relative flex h-12 w-16 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-all active:translate-y-px',
              isActive ? 'bg-accent-primary/25 text-white shadow-glow' : 'text-ink-muted',
            ].join(' ')
          }
        >
          <Icon name={item.icon} size={20} />
          {item.label}
          {item.to === '/alerts' && unacknowledged > 0 && (
            <span className="absolute right-2 top-0.5 rounded-full bg-accent-danger px-1.5 text-[10px] font-bold text-white">
              {unacknowledged > 9 ? '9+' : unacknowledged}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
