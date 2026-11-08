/**
 * TESTING PHASE: phone-browser driver monitor (backend: routes/monitor.routes.js).
 * Parent calls use the normal login; device calls use the monitor link's secret instead.
 */
import { API_URL, api } from './client';

export interface MonitorLink {
  id: string;
  driverId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
}

export async function createMonitorLink(driverId: string, days = 7): Promise<{ link: MonitorLink; token: string }> {
  const { data } = await api.post<{ link: MonitorLink; token: string }>('/monitor/links', { driverId, days });
  return data;
}

export async function listMonitorLinks(driverId: string): Promise<MonitorLink[]> {
  const { data } = await api.get<{ links: MonitorLink[] }>('/monitor/links', { params: { driverId } });
  return data.links;
}

export async function revokeMonitorLink(id: string): Promise<MonitorLink> {
  const { data } = await api.delete<{ link: MonitorLink }>(`/monitor/links/${id}`);
  return data.link;
}

/** The page a test driver opens on their phone. */
export function monitorUrl(token: string): string {
  return `${window.location.origin}/monitor/${token}`;
}

// ------------------------------------------------------------------ device side (the link)

export interface MonitorSession {
  driver: { id: string; name: string };
  expiresAt: string;
  personalThresholds: { drowsyDurationMs?: number; perclosThreshold?: number; yawnThreshold?: number };
  device: { yawnMar?: number | null };
}

export class MonitorLinkError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const res = await fetch(`${API_URL}/api/monitor/device${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-monitor-token': token, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new MonitorLinkError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

export const monitorDevice = {
  session: (token: string) => call<MonitorSession>(token, '/session', undefined, 60000),
  ingest: (token: string, payload: unknown) =>
    call<{ classification: string; fusionScore: number; alertTriggered: boolean; alertId: string | null }>(
      token,
      '/ingest',
      payload,
    ),
  snapshot: (token: string, alertId: string, image: string) =>
    call<{ snapshotUrl: string }>(token, '/snapshot', { alertId, image }, 20000),
  away: (token: string) => call<{ status: string }>(token, '/away', {}),
};
