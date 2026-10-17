import { api } from './client';
import { withOfflineFallback } from '../lib/offlineCache';
import type { Alert, AlertsResponse, AlertType } from './types';

export interface AlertFilters {
  driverId?: string;
  from?: string;
  to?: string;
  type?: AlertType;
  acknowledged?: boolean;
  /** open = to acknowledge today · acknowledged · expired = never acknowledged on its day */
  status?: AlertStatus;
  /** Notifications: unread (false) / read (true). */
  read?: boolean;
  limit?: number;
}

export type AlertStatus = 'open' | 'acknowledged' | 'expired';

function cacheKey(f: AlertFilters): string {
  return [
    'alerts',
    f.driverId ?? '*',
    f.type ?? '*',
    f.acknowledged ?? '*',
    f.status ?? '*',
    f.read ?? '*',
    f.from ?? '',
    f.to ?? '',
  ].join(':');
}

export function listAlerts(filters: AlertFilters = {}): Promise<AlertsResponse> {
  const params = {
    ...filters,
    limit: filters.limit ?? 50,
    acknowledged: filters.acknowledged === undefined ? undefined : String(filters.acknowledged),
    read: filters.read === undefined ? undefined : String(filters.read),
  };
  return withOfflineFallback(cacheKey(filters), async () => {
    const { data } = await api.get<AlertsResponse>('/alerts', { params });
    return data;
  });
}

export async function acknowledgeAlert({
  id,
  falseAlarm,
}: {
  id: string;
  falseAlarm?: boolean;
}): Promise<{ alert: Alert; alreadyAcknowledged: boolean }> {
  const { data } = await api.patch<{ alert: Alert; alreadyAcknowledged: boolean }>(`/alerts/${id}/ack`, {
    acknowledgedBy: 'web',
    ...(falseAlarm !== undefined && { falseAlarm }),
  });
  return data;
}

/** Label an alert as a false alarm (or a real one) — training data for the false-positive model. */
export async function sendFeedback({ id, falseAlarm }: { id: string; falseAlarm: boolean }): Promise<Alert> {
  const { data } = await api.patch<{ alert: Alert }>(`/alerts/${id}/feedback`, { falseAlarm, by: 'web' });
  return data.alert;
}

/** Mark one notification read (or unread again). */
export async function markAlertRead({ id, read = true }: { id: string; read?: boolean }): Promise<Alert> {
  const { data } = await api.patch<{ alert: Alert }>(`/alerts/${id}/read`, { read });
  return data.alert;
}

export async function markAllAlertsRead(): Promise<number> {
  const { data } = await api.post<{ updated: number }>('/alerts/read-all', {});
  return data.updated;
}

/** Remove alerts from every list: one id, several, or all expired ones. */
export async function removeAlerts(target: { ids: string[] } | { expired: true }): Promise<string[]> {
  if ('ids' in target && target.ids.length === 1) {
    const { data } = await api.delete<{ alertIds: string[] }>(`/alerts/${target.ids[0]}`);
    return data.alertIds;
  }
  const { data } = await api.post<{ alertIds: string[] }>('/alerts/remove', target);
  return data.alertIds;
}

export function alertStatus(alert: Alert): AlertStatus {
  if (alert.acknowledged) return 'acknowledged';
  return alert.expired ? 'expired' : 'open';
}

/** Does an alert belong in a list fetched with these filters? (for live cache updates) */
export function matchesFilters(alert: Alert, f: AlertFilters): boolean {
  if (f.driverId && alert.driverId !== f.driverId) return false;
  if (f.type && alert.type !== f.type) return false;
  if (f.acknowledged !== undefined && alert.acknowledged !== f.acknowledged) return false;
  if (f.status && alertStatus(alert) !== f.status) return false;
  if (f.read !== undefined && Boolean(alert.read) !== f.read) return false;
  if (f.to && new Date(alert.createdAt) > new Date(f.to)) return false;
  if (f.from && new Date(alert.createdAt) < new Date(f.from)) return false;
  return true;
}
