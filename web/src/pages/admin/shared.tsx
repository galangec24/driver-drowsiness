import type { ReactNode } from 'react';
import type { JobStatus } from '../../api/admin';
import { Spinner } from '../../components/ui/Spinner';

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'bg-white/10 text-ink-muted',
  running: 'bg-accent-primary/30 text-indigo-100',
  succeeded: 'bg-emerald-500/20 text-emerald-200',
  failed: 'bg-red-500/20 text-red-200',
  cancelled: 'bg-white/10 text-ink-muted',
};

export function JobStatusPill({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[status]}`}
    >
      {status === 'running' && <Spinner size={11} />}
      {status}
    </span>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' | 'info' }) {
  const cls = {
    muted: 'bg-white/10 text-ink-muted',
    ok: 'bg-emerald-500/20 text-emerald-200',
    warn: 'bg-amber-500/20 text-amber-200',
    info: 'bg-accent-primary/25 text-indigo-100',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>
  );
}

export function pctOrDash(v: unknown, digits = 0): string {
  return typeof v === 'number' ? `${(v * 100).toFixed(digits)}%` : '—';
}

export function numOrDash(v: unknown, digits = 2): string {
  return typeof v === 'number' ? v.toFixed(digits) : '—';
}

export function duration(from: string | null, to: string | null): string {
  if (!from) return '—';
  const s = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
