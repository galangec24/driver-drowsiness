import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listAlerts } from '../../api/alerts';
import type { Alert } from '../../api/types';
import { usePollingFallback } from '../../hooks/useRealtime';
import { useMarkAllRead, useMarkRead } from '../../hooks/useAcknowledge';
import { ALERT_LABEL, formatTime, isSevere, timeAgo } from '../../lib/format';
import { Icon } from '../ui/Icon';

type Tab = 'unread' | 'read';

/**
 * Notifications, separate from acknowledging: every alert arrives as an unread notification.
 * Opening one (or "Mark all as read") moves it to Read; it can be marked unread again.
 * Acknowledging an alert also marks it read.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('unread');
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const refetchInterval = usePollingFallback();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const unread = useQuery({
    queryKey: ['alerts', { read: false, limit: 30 }],
    queryFn: () => listAlerts({ read: false, limit: 30 }),
    refetchInterval,
  });
  const read = useQuery({
    queryKey: ['alerts', { read: true, limit: 30 }],
    queryFn: () => listAlerts({ read: true, limit: 30 }),
    enabled: open && tab === 'read',
  });
  const unreadCount = unread.data?.unread ?? 0;
  const items = (tab === 'unread' ? unread.data?.alerts : read.data?.alerts) ?? [];
  const loading = tab === 'unread' ? unread.isLoading : read.isLoading;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openAlert = (a: Alert) => {
    if (!a.read) markRead.mutate({ id: a.id, read: true });
    setOpen(false);
    navigate(`/drivers/${a.driverId}`);
  };

  return (
    <div ref={ref} className="fixed right-4 top-4 z-40 sm:right-6" data-testid="notifications">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        className="glass relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-depth-2 transition-transform hover:scale-105"
      >
        <Icon name="bell" size={22} />
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-accent-danger px-1 text-center text-[11px] font-bold leading-5 text-onaccent shadow-glow-danger"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass absolute right-0 mt-2 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl shadow-depth-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <h2 className="font-bold text-white">Notifications</h2>
              {tab === 'unread' && unreadCount > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-accent-glow hover:underline disabled:opacity-50"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div role="tablist" className="flex gap-1 px-3 pt-3">
              {(['unread', 'read'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={[
                    'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                    tab === t ? 'bg-white/15 text-white' : 'text-ink-muted hover:bg-white/5',
                  ].join(' ')}
                >
                  {t === 'unread' ? `Unread${unreadCount ? ` (${unreadCount})` : ''}` : 'Read'}
                </button>
              ))}
            </div>

            <ul className="flex-1 overflow-y-auto p-3" data-testid={`notifications-${tab}`}>
              {loading ? (
                <li className="py-8 text-center text-sm text-ink-muted">Loading…</li>
              ) : items.length === 0 ? (
                <li className="py-8 text-center text-sm text-ink-muted">
                  {tab === 'unread' ? 'You are all caught up.' : 'No read notifications yet.'}
                </li>
              ) : (
                items.map((a) => (
                  <li key={a.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openAlert(a)}
                      className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left hover:bg-white/5"
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                          a.read ? 'bg-white/15' : isSevere(a.type) ? 'bg-accent-danger' : 'bg-accent-warn',
                        ].join(' ')}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={a.read ? 'text-sm text-ink-muted' : 'text-sm font-semibold text-white'}>
                            {a.driverName || 'Driver'}: {ALERT_LABEL[a.type]}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-ink-muted" title={formatTime(a.createdAt)}>
                            {timeAgo(a.createdAt)}
                          </span>
                        </span>
                        {a.sensorSnapshot?.fatigueReason && (
                          <span className="block truncate text-xs text-ink-muted">
                            {a.sensorSnapshot.fatigueReason}
                          </span>
                        )}
                        <span className="block text-[11px] text-ink-muted">
                          {a.acknowledged
                            ? 'Acknowledged'
                            : a.expired
                              ? 'Unacknowledged (previous day)'
                              : 'Needs acknowledgement'}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => markRead.mutate({ id: a.id, read: !a.read })}
                      className="absolute right-2 top-9 rounded-lg px-2 py-0.5 text-[11px] text-accent-glow opacity-0 hover:underline focus:opacity-100 group-hover:opacity-100"
                    >
                      {a.read ? 'Mark unread' : 'Mark read'}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/alerts');
              }}
              className="border-t border-white/10 px-4 py-3 text-sm font-semibold text-accent-glow hover:bg-white/5"
            >
              See all alerts
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
