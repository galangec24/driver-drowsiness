import type { DriverStatus } from '../../api/types';
import { STATUS_LABEL } from '../../lib/format';

const styles: Record<DriverStatus, string> = {
  alert: 'bg-accent-ok/15 text-emerald-300 border-accent-ok/40',
  warning: 'bg-accent-warn/15 text-amber-300 border-accent-warn/40',
  drowsy: 'bg-accent-danger/20 text-red-300 border-accent-danger/50 shadow-glow-danger',
  away: 'bg-sky-400/10 text-sky-200 border-sky-300/30',
  offline: 'bg-white/5 text-ink-muted border-white/10',
};

const dots: Record<DriverStatus, string> = {
  alert: 'bg-accent-ok',
  warning: 'bg-accent-warn',
  drowsy: 'bg-accent-danger animate-ping',
  away: 'bg-sky-300',
  offline: 'bg-slate-500',
};

export function StatusPill({ status }: { status: DriverStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dots[status]}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dots[status].split(' ')[0]}`} />
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}
