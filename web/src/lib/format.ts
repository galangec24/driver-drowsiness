import type { Alert, AlertType, DriverStatus } from '../api/types';

export const ALERT_LABEL: Record<AlertType, string> = {
  drowsy: 'Drowsy',
  microsleep: 'Microsleep',
  distraction: 'Distraction',
  face_match: 'Unrecognized driver',
  warning: 'Fatigue warning',
  yawning: 'Frequent yawning',
  nodding: 'Head nodding',
};

export const STATUS_LABEL: Record<DriverStatus, string> = {
  alert: 'Alert',
  warning: 'Warning',
  drowsy: 'Drowsy',
  offline: 'Offline',
};

export function alertTitle(a: Pick<Alert, 'type' | 'driverName'>): string {
  return `${a.driverName || 'Driver'}: ${ALERT_LABEL[a.type]}`;
}

export function isSevere(type: AlertType): boolean {
  return type === 'drowsy' || type === 'microsleep' || type === 'nodding';
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function pct(v: number | undefined): string {
  return v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function num(v: number | undefined, digits = 2): string {
  return v === undefined || v === null ? '—' : v.toFixed(digits);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
