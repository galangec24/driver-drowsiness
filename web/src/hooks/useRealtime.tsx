import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createSocket, type GuardianSocket } from '../socket/socket';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { matchesFilters, type AlertFilters } from '../api/alerts';
import type { Alert, AlertsResponse, Driver, DriverLiveStatus } from '../api/types';
import { alertTitle } from '../lib/format';
import { notifyBrowser } from '../lib/notify';

interface RealtimeState {
  connected: boolean;
  /** Latest driver:status per driverId (live EAR/PERCLOS/HR). */
  live: Record<string, DriverLiveStatus>;
  /** driverIds that just raised an alert (cards pulse briefly). */
  pulsing: Set<string>;
  socket: GuardianSocket | null;
}

const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  live: {},
  pulsing: new Set(),
  socket: null,
});

function prependAlert(qc: QueryClient, alert: Alert) {
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data) continue;
    const filters = (key[1] ?? {}) as AlertFilters;
    if (!matchesFilters(alert, filters) || data.alerts.some((a) => a.id === alert.id)) continue;
    const limit = filters.limit ?? 50;
    qc.setQueryData<AlertsResponse>(key, {
      ...data,
      alerts: [alert, ...data.alerts].slice(0, limit),
      unacknowledged: data.unacknowledged + (alert.acknowledged ? 0 : 1),
      unread: (data.unread ?? 0) + (alert.read ? 0 : 1),
    });
  }
}

/** Notifications read / unread on any device: move them between the Unread and Read lists. */
export function applyRead(qc: QueryClient, alertIds: string[], read: boolean) {
  const ids = new Set(alertIds);
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data) continue;
    const filters = (key[1] ?? {}) as AlertFilters;
    const changed = data.alerts.filter((a) => ids.has(a.id) && Boolean(a.read) !== read).length;
    const alerts = data.alerts
      .map((a) => (ids.has(a.id) ? { ...a, read, readAt: read ? new Date().toISOString() : null } : a))
      .filter((a) => filters.read === undefined || Boolean(a.read) === filters.read);
    // Lists that don't hold the alert still get the right unread count from the server later.
    const unread = Math.max(0, (data.unread ?? 0) + (read ? -changed : changed));
    qc.setQueryData<AlertsResponse>(key, { ...data, alerts, unread });
  }
  // A read-list may not have the newly read items: refetch those lists.
  void qc.invalidateQueries({ queryKey: ['alerts', { read: !read }], exact: false });
}

/** Removed alerts disappear from every list on every device. */
export function applyRemoved(qc: QueryClient, alertIds: string[]) {
  const ids = new Set(alertIds);
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data || !data.alerts.some((a) => ids.has(a.id))) continue;
    const gone = data.alerts.filter((a) => ids.has(a.id));
    qc.setQueryData<AlertsResponse>(key, {
      ...data,
      alerts: data.alerts.filter((a) => !ids.has(a.id)),
      unacknowledged: Math.max(0, data.unacknowledged - gone.filter((a) => !a.acknowledged && !a.expired).length),
      unread: Math.max(0, (data.unread ?? 0) - gone.filter((a) => !a.read).length),
      expired: Math.max(0, (data.expired ?? 0) - gone.filter((a) => !a.acknowledged && a.expired).length),
    });
  }
}

export function applyAcknowledged(
  qc: QueryClient,
  alertId: string,
  acknowledgedBy: Alert['acknowledgedBy'],
  falseAlarm?: boolean | null,
) {
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data) continue;
    const target = data.alerts.find((a) => a.id === alertId);
    if (!target || target.acknowledged) continue;
    const filters = (key[1] ?? {}) as AlertFilters;
    const updated = {
      ...target,
      read: true,
      acknowledged: true,
      acknowledgedBy,
      acknowledgedAt: new Date().toISOString(),
      ...(falseAlarm !== undefined && { falseAlarm }),
    };
    qc.setQueryData<AlertsResponse>(key, {
      ...data,
      // An "unacknowledged only" or "unread" list drops it; others update in place.
      alerts:
        filters.acknowledged === false || filters.status === 'open' || filters.read === false
          ? data.alerts.filter((a) => a.id !== alertId)
          : data.alerts.map((a) => (a.id === alertId ? updated : a)),
      unacknowledged: Math.max(0, data.unacknowledged - 1),
      unread: Math.max(0, (data.unread ?? 0) - (target.read ? 0 : 1)),
    });
  }
}

export function applyFeedback(qc: QueryClient, alertId: string, falseAlarm: boolean) {
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data || !data.alerts.some((a) => a.id === alertId)) continue;
    qc.setQueryData<AlertsResponse>(key, {
      ...data,
      alerts: data.alerts.map((a) => (a.id === alertId ? { ...a, falseAlarm } : a)),
    });
  }
}

/** Merge changed fields into every cached copy of an alert (e.g. the snapshot arrived). */
export function applyAlertUpdated(qc: QueryClient, alertId: string, changes: Partial<Alert>) {
  for (const [key, data] of qc.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })) {
    if (!data || !data.alerts.some((a) => a.id === alertId)) continue;
    qc.setQueryData<AlertsResponse>(key, {
      ...data,
      alerts: data.alerts.map((a) => (a.id === alertId ? { ...a, ...changes } : a)),
    });
  }
}

function applyStatus(qc: QueryClient, s: DriverLiveStatus) {
  const patch = (d: Driver): Driver => ({
    ...d,
    status: s.status,
    lastUpdate: s.lastUpdate,
    lastLocation: s.location ?? d.lastLocation,
  });
  qc.setQueryData<Driver[]>(['drivers'], (list) => list?.map((d) => (d.id === s.driverId ? patch(d) : d)));
  qc.setQueryData<Driver>(['driver', s.driverId], (d) => (d ? patch(d) : d));
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [socket, setSocket] = useState<GuardianSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState<Record<string, DriverLiveStatus>>({});
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!token) return undefined;
    const s = createSocket(token);
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      // Catch up on anything missed while disconnected.
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    s.on('alert:new', (alert) => {
      prependAlert(qc, alert);
      const severe = alert.type === 'drowsy' || alert.type === 'microsleep';
      const title = alertTitle(alert);
      toastRef.current.show({
        title,
        body: `Confidence ${Math.round(alert.confidence * 100)}%`,
        tone: severe ? 'danger' : 'warn',
        durationMs: severe ? 8000 : 5000,
      });
      notifyBrowser(title, `Confidence ${Math.round(alert.confidence * 100)}%`, alert.id);
      setPulsing((prev) => new Set(prev).add(alert.driverId));
      window.setTimeout(() => {
        setPulsing((prev) => {
          const next = new Set(prev);
          next.delete(alert.driverId);
          return next;
        });
      }, 6000);
    });

    s.on('alert:acknowledged', ({ alertId, acknowledgedBy, falseAlarm }) => {
      applyAcknowledged(qc, alertId, acknowledgedBy, falseAlarm);
    });

    s.on('alert:feedback', ({ alertId, falseAlarm }) => applyFeedback(qc, alertId, falseAlarm));

    s.on('alert:updated', ({ alertId, ...changes }) => applyAlertUpdated(qc, alertId, changes));

    s.on('alert:read', ({ alertIds, read }) => applyRead(qc, alertIds, read));

    s.on('alert:removed', ({ alertIds }) => applyRemoved(qc, alertIds));

    s.on('survey:new', ({ title }) => {
      void qc.invalidateQueries({ queryKey: ['surveys', 'open'] });
      toastRef.current.show({
        title: 'New survey from the Guardian Drive team',
        body: title,
        tone: 'info',
        durationMs: 6000,
      });
    });

    s.on('ratings:updated', (summary) => qc.setQueryData(['ratings', 'summary'], summary));

    s.on('feedback:updated', (fb) => {
      void qc.invalidateQueries({ queryKey: ['feedback', 'mine'] });
      if (fb.adminReply && fb.userId === userIdRef.current) {
        toastRef.current.show({
          title: 'Reply to your feedback',
          body: fb.adminReply.length > 120 ? `${fb.adminReply.slice(0, 120)}…` : fb.adminReply,
          tone: 'info',
          durationMs: 8000,
        });
      }
    });

    s.on('driver:status', (status) => {
      setLive((prev) => ({ ...prev, [status.driverId]: status }));
      applyStatus(qc, status);
    });

    return () => {
      s.removeAllListeners();
      s.close();
      setSocket(null);
      setConnected(false);
    };
  }, [token, qc]);

  const value = useMemo(() => ({ connected, live, pulsing, socket }), [connected, live, pulsing, socket]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}

/** React Query polling fallback: poll every 10 s only while the socket is down. */
export function usePollingFallback(): number | false {
  const { connected } = useRealtime();
  return connected ? false : 10000;
}
