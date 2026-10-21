import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { clearSnapshots } from '../../lib/offlineCache';
import { markFarewell } from '../../lib/farewell';
import { useTheme } from '../../lib/theme';
import { UserAvatar } from '../ui/UserAvatar';
import { Icon, type IconName } from '../ui/Icon';

/** Sign out: farewell card, offline cache and query cache cleared. */
export function useSignOut(): () => void {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  return () => {
    markFarewell(user?.name);
    clearSnapshots();
    qc.clear();
    logout();
  };
}

function Item({
  icon,
  label,
  hint,
  to,
  onClick,
  right,
  testId,
  checked,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  to?: string;
  onClick?: () => void;
  right?: React.ReactNode;
  testId?: string;
  /** A toggle item (dark mode). */
  checked?: boolean;
}) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        {hint && <span className="block truncate text-[11px] text-ink-muted">{hint}</span>}
      </span>
      {right ?? (to && <Icon name="chevronRight" size={20} className="text-ink-muted" />)}
    </>
  );
  const cls =
    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none';
  return to ? (
    <Link to={to} role="menuitem" className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      onClick={onClick}
      className={cls}
      data-testid={testId}
    >
      {body}
    </button>
  );
}

/**
 * Account menu (top right), like Facebook's: your profile at the top, then settings, help &
 * feedback and display, and "Log out" on its own at the bottom.
 */
export function AccountMenu() {
  const { user } = useAuth();
  const signOut = useSignOut();
  const { theme, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dark = theme === 'dark';
  const isAdmin = user?.role === 'admin';

  return (
    <div ref={ref} className="fixed right-[4.25rem] top-4 z-40 sm:right-[4.75rem]" data-testid="account-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="glass relative flex h-11 w-11 items-center justify-center rounded-full p-0.5 shadow-depth-2 transition-transform hover:scale-105"
      >
        <UserAvatar name={user?.name} url={user?.avatarUrl} size={38} />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-ink-900 bg-ink-800 text-white">
          <Icon name="chevronRight" size={12} className="rotate-90" />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{ transformOrigin: 'top right' }}
            className="glass absolute right-0 top-14 w-[min(22rem,calc(100vw-2rem))] bg-ink-900/95 p-2 shadow-depth-3"
          >
            {/* Profile card */}
            <Link
              to="/settings#profile"
              role="menuitem"
              data-testid="menu-profile"
              className="glass-inset mb-2 flex items-center gap-3 p-3 transition-colors hover:bg-white/5"
            >
              <UserAvatar name={user?.name} url={user?.avatarUrl} size={48} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-white">{user?.name}</span>
                <span className="block truncate text-xs text-ink-muted">{user?.email}</span>
                <span className="block text-xs font-semibold text-accent-glow">Edit profile</span>
              </span>
            </Link>

            <Item icon="settings" label="Settings" hint="Account, notifications, updates" to="/settings" />
            <Item
              icon="moon"
              label="Dark mode"
              hint={dark ? 'On' : 'Off'}
              onClick={() => setPref(dark ? 'light' : 'dark')}
              testId="menu-dark-mode"
              checked={dark}
              right={
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-10 rounded-full transition-colors ${dark ? 'bg-accent-primary' : 'bg-white/20'}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-onaccent shadow-depth-1 transition-all ${dark ? 'left-[1.125rem]' : 'left-0.5'}`}
                  />
                </span>
              }
            />
            {!isAdmin && <Item icon="poll" label="Surveys" hint="Short questions from the team" to="/surveys" />}
            <Item icon="download" label="Get the app" hint="Android, iPhone, computer" to="/download" />

            <div className="my-2 border-t border-white/10" />
            <Item icon="shield" label="About Guardian Drive" hint="What it does and how it works" to="/about" />
            <Item icon="user" label="About the developer" hint="Engr. Emmanuel Christian V. Galang" to="/about-me" />
            <Item
              icon="help"
              label="Help & feedback"
              hint="Report a problem or share an idea"
              to="/feedback"
              testId="menu-feedback"
            />

            <div className="my-2 border-t border-white/10" />
            <Item icon="logout" label="Log out" onClick={signOut} testId="menu-logout" />

            <p className="px-2 pb-1 pt-2 text-[11px] text-ink-muted">Guardian Drive · © {new Date().getFullYear()}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
