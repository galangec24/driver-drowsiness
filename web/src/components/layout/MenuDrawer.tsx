import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../ui/Icon';
import { navItemsFor } from './nav';
import { useAuth } from '../../store/auth';
import { useSignOut } from './AccountMenu';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  [
    'flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
    isActive ? 'bg-accent-primary/25 text-white' : 'text-white/90 hover:bg-white/5',
  ].join(' ');

/** Phones (< 640 px): ☰ at the top left opens a side menu with every page, help and log out. */
export function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const signOut = useSignOut();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        data-testid="drawer-toggle"
        className="glass fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-depth-2 sm:hidden"
      >
        <Icon name="menu" size={22} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm sm:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            >
              <motion.nav
                aria-label="Menu"
                data-testid="menu-drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                onClick={(e) => e.stopPropagation()}
                className="glass absolute inset-y-0 left-0 flex w-[min(19rem,85vw)] flex-col gap-1 rounded-l-none bg-ink-900/95 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-white">Guardian Drive</p>
                    <p className="truncate text-xs text-ink-muted">{user?.name}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-white/5 hover:text-white"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>
                {navItemsFor(user?.role).map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={linkCls}>
                    <Icon name={item.icon} size={20} /> {item.label}
                  </NavLink>
                ))}
                <div className="my-2 border-t border-white/10" />
                <NavLink to="/feedback" className={linkCls}>
                  <Icon name="help" size={20} /> Help &amp; feedback
                </NavLink>
                <NavLink to="/download" className={linkCls}>
                  <Icon name="download" size={20} /> Get the app
                </NavLink>
                <div className="mt-auto border-t border-white/10 pt-2">
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-white/90 hover:bg-white/5"
                  >
                    <Icon name="logout" size={20} /> Log out
                  </button>
                </div>
              </motion.nav>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
