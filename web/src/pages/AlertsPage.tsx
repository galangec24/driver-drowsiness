import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAlerts, type AlertFilters } from '../api/alerts';
import { listDrivers } from '../api/drivers';
import { errorMessage } from '../api/client';
import type { AlertType } from '../api/types';
import { usePollingFallback } from '../hooks/useRealtime';
import { AlertFeed } from '../components/alert/AlertFeed';
import { GlassCard } from '../components/ui/GlassCard';
import { OrbitLoader } from '../components/ui/OrbitLoader';
import { ALERT_LABEL } from '../lib/format';

type StatusFilter = 'all' | 'open' | 'acknowledged';
type RangeFilter = 'all' | '1h' | '24h' | '7d';

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '1h': 3600e3,
  '24h': 24 * 3600e3,
  '7d': 7 * 24 * 3600e3,
};

const selectClass =
  'h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white shadow-inner outline-none focus:border-accent-glow/70';

export function AlertsPage() {
  const refetchInterval = usePollingFallback();
  const [driverId, setDriverId] = useState('');
  const [type, setType] = useState<AlertType | ''>('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [range, setRange] = useState<RangeFilter>('all');
  // Recompute "from" only when the range selection changes so the query key is stable.
  const from = useMemo(
    () => (range === 'all' ? undefined : new Date(Date.now() - RANGE_MS[range]).toISOString()),
    [range],
  );

  const filters: AlertFilters = {
    limit: 50,
    ...(driverId && { driverId }),
    ...(type && { type }),
    ...(status !== 'all' && { acknowledged: status === 'acknowledged' }),
    ...(from && { from }),
  };

  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers });
  const alerts = useQuery({ queryKey: ['alerts', filters], queryFn: () => listAlerts(filters), refetchInterval });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">Alerts</h1>
        <p className="text-sm text-ink-muted">
          {alerts.data ? `${alerts.data.unacknowledged} unacknowledged across all drivers.` : 'Chronological feed.'}{' '}
          Acknowledging here clears it on every device.
        </p>
      </header>

      <GlassCard interactive={false} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="label">Driver</span>
          <select
            className={selectClass}
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            aria-label="Filter by driver"
          >
            <option value="" className="bg-ink-900">
              All drivers
            </option>
            {drivers.data?.map((d) => (
              <option key={d.id} value={d.id} className="bg-ink-900">
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Type</span>
          <select
            className={selectClass}
            value={type}
            onChange={(e) => setType(e.target.value as AlertType | '')}
            aria-label="Filter by type"
          >
            <option value="" className="bg-ink-900">
              All types
            </option>
            {(Object.keys(ALERT_LABEL) as AlertType[]).map((t) => (
              <option key={t} value={t} className="bg-ink-900">
                {ALERT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Status</span>
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all" className="bg-ink-900">
              All
            </option>
            <option value="open" className="bg-ink-900">
              Unacknowledged
            </option>
            <option value="acknowledged" className="bg-ink-900">
              Acknowledged
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Time</span>
          <select
            className={selectClass}
            value={range}
            onChange={(e) => setRange(e.target.value as RangeFilter)}
            aria-label="Filter by time"
          >
            <option value="all" className="bg-ink-900">
              Any time
            </option>
            <option value="1h" className="bg-ink-900">
              Last hour
            </option>
            <option value="24h" className="bg-ink-900">
              Last 24 hours
            </option>
            <option value="7d" className="bg-ink-900">
              Last 7 days
            </option>
          </select>
        </label>
      </GlassCard>

      {alerts.isLoading ? (
        <div className="flex justify-center py-16">
          <OrbitLoader size={72} />
        </div>
      ) : alerts.isError ? (
        <GlassCard interactive={false} className="text-red-200">
          {errorMessage(alerts.error)}
        </GlassCard>
      ) : (
        <AlertFeed alerts={alerts.data?.alerts ?? []} emptyText="No alerts match these filters." />
      )}
    </div>
  );
}
