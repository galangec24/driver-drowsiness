import { api } from './client';
import { withOfflineFallback } from '../lib/offlineCache';
import type { Alert, AlertsResponse, AlertType } from './types';

export interface AlertFilters {
  driverId?: string;
  from?: string;
  to?: string;
  type?: AlertType;
  acknowledged?: boolean;
  limit?: number;
}

function cacheKey(f: AlertFilters): string {
  return `alerts:${f.driverId ?? '*'}:${f.type ?? '*'}:${f.acknowledged ?? '*'}:${f.from ?? ''}:${f.to ?? ''}`;
}

export function listAlerts(filters: AlertFilters = {}): Promise<AlertsResponse> {
  const params = {
    ...filters,
    limit: filters.limit ?? 50,
    acknowledged: filters.acknowledged === undefined ? undefined : String(filters.acknowledged),
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
  const { data } = await api.patch<{ alert: Alert; alreadyAcknowledged: boolean }>(
    `/alerts/${id}/ack`,
    { acknowledgedBy: 'web', ...(falseAlarm !== undefined && { falseAlarm }) },
  );
  return data;
}

/** Label an alert as a false alarm (or a real one) — training data for the false-positive model. */
export async function sendFeedback({ id, falseAlarm }: { id: string; falseAlarm: boolean }): Promise<Alert> {
  const { data } = await api.patch<{ alert: Alert }>(`/alerts/${id}/feedback`, { falseAlarm, by: 'web' });
  return data.alert;
}

/** Does an alert belong in a list fetched with these filters? (for live cache updates) */
export function matchesFilters(alert: Alert, f: AlertFilters): boolean {
  if (f.driverId && alert.driverId !== f.driverId) return false;
  if (f.type && alert.type !== f.type) return false;
  if (f.acknowledged !== undefined && alert.acknowledged !== f.acknowledged) return false;
  if (f.to && new Date(alert.createdAt) > new Date(f.to)) return false;
  if (f.from && new Date(alert.createdAt) < new Date(f.from)) return false;
  return true;
}
