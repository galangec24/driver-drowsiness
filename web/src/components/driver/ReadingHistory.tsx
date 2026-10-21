import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { driverHistory, type HistoryRow } from '../../api/drivers';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../ui/GlassCard';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';
import { formatTime, timeAgo } from '../../lib/format';

type Range = 'today' | '24h' | '7d';
const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '24h', label: 'Last 24 h' },
  { value: '7d', label: '7 days' },
];

function rangeFor(r: Range, now = new Date()): { from: string; to: string } {
  const to = now.toISOString();
  if (r === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to };
  }
  const hours = r === '24h' ? 24 : 7 * 24;
  return { from: new Date(now.getTime() - hours * 3600e3).toISOString(), to };
}

export const km = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v < 10 ? `${v.toFixed(2)} km` : `${v.toFixed(1)} km`;

const fixed = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));

function toCsv(rows: HistoryRow[]): string {
  const head = 'time,readings,state,ear,perclos,heart_rate,score,lat,lng,km,total_km';
  const lines = rows.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.readings,
      r.classification,
      r.ear ?? '',
      r.perclos ?? '',
      r.heartRate ?? '',
      r.fusionScore ?? '',
      r.location?.lat ?? '',
      r.location?.lng ?? '',
      r.km,
      r.totalKm,
    ].join(','),
  );
  return [head, ...lines].join('\n');
}

const PAGE = 25;

/** Reading history: the last reading, distance driven and one row per minute of driving. */
export function ReadingHistory({ driverId, driverName }: { driverId: string; driverName: string }) {
  const [range, setRange] = useState<Range>('today');
  const [shown, setShown] = useState(PAGE);
  const [onlyEvents, setOnlyEvents] = useState(false);
  const q = useQuery({
    queryKey: ['driverHistory', driverId, range],
    queryFn: () => driverHistory(driverId, rangeFor(range)),
    refetchInterval: 60_000,
  });
  const rows = useMemo(
    () => (q.data?.rows ?? []).filter((r) => !onlyEvents || r.classification !== 'alert'),
    [q.data, onlyEvents],
  );
  const last = q.data?.lastReading;
  const minutes = q.data?.rows.length ?? 0;

  function download() {
    const blob = new Blob([toCsv(q.data?.rows ?? [])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${driverName.replace(/\s+/g, '_')}_readings_${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <GlassCard interactive={false} className="flex flex-col gap-4" data-testid="reading-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Icon name="refresh" size={20} className="text-accent-glow" /> Reading history
        </h2>
        <div role="tablist" aria-label="Period" className="flex gap-1 rounded-xl bg-black/20 p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              role="tab"
              aria-selected={range === r.value}
              onClick={() => {
                setRange(r.value);
                setShown(PAGE);
              }}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                range === r.value ? 'bg-accent-primary/30 text-white' : 'text-ink-muted hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="glass-inset p-3" data-testid="last-reading">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">Last reading</p>
          <p className="mt-1 font-bold text-white">{last ? timeAgo(last.at) : 'None yet'}</p>
          <p className="text-[11px] text-ink-muted">{last ? formatTime(last.at) : 'The car has not sent data'}</p>
        </div>
        <div className="glass-inset p-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">State then</p>
          <div className="mt-1">{last ? <StatusPill status={last.classification} /> : '—'}</div>
        </div>
        <div className="glass-inset p-3" data-testid="distance">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">Distance</p>
          <p className="mt-1 font-bold text-white">{km(q.data?.totalKm ?? null)}</p>
          <p className="text-[11px] text-ink-muted">{RANGES.find((r) => r.value === range)?.label}</p>
        </div>
        <div className="glass-inset p-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">Time monitored</p>
          <p className="mt-1 font-bold text-white">
            {minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}
          </p>
          <p className="text-[11px] text-ink-muted">minutes with readings</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
          <input type="checkbox" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.target.checked)} />
          Only warnings and drowsy
        </label>
        <button
          onClick={download}
          disabled={!q.data?.rows.length}
          className="inline-flex items-center gap-1 text-accent-glow hover:underline disabled:text-ink-muted disabled:no-underline"
        >
          <Icon name="download" size={14} /> Download CSV
        </button>
      </div>

      {q.isLoading && <p className="text-sm text-ink-muted">Loading readings…</p>}
      {q.isError && <p className="text-sm text-red-300">{errorMessage(q.error)}</p>}
      {q.data && rows.length === 0 && <p className="text-sm text-ink-muted">No readings in this period.</p>}

      {rows.length > 0 && (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="history-table">
            <thead className="text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">Time read</th>
                <th className="px-2 py-2 font-semibold">State</th>
                <th className="px-2 py-2 font-semibold">Eyes (EAR)</th>
                <th className="px-2 py-2 font-semibold">PERCLOS</th>
                <th className="px-2 py-2 font-semibold">Heart</th>
                <th className="px-2 py-2 font-semibold">Distance</th>
                <th className="px-2 py-2 font-semibold">Total</th>
                <th className="px-2 py-2 font-semibold">Place</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => (
                <tr key={r.at} className="border-t border-white/5">
                  <td className="px-2 py-2">
                    <span className="block text-white">{formatTime(r.at)}</span>
                    <span className="text-[11px] text-ink-muted">
                      {timeAgo(r.at)} · {r.readings} reading{r.readings === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill status={r.classification} />
                  </td>
                  <td className="px-2 py-2 text-white/90">{fixed(r.ear, 3)}</td>
                  <td className="px-2 py-2 text-white/90">
                    {r.perclos === null ? '—' : `${Math.round(r.perclos * 100)}%`}
                  </td>
                  <td className="px-2 py-2 text-white/90">{r.heartRate ? `${r.heartRate} bpm` : '—'}</td>
                  <td className="px-2 py-2 text-white/90">{r.km ? `+${km(r.km)}` : '—'}</td>
                  <td className="px-2 py-2 text-white/90">{km(r.totalKm)}</td>
                  <td className="px-2 py-2">
                    {r.location ? (
                      <a
                        href={`https://www.google.com/maps?q=${r.location.lat},${r.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-accent-glow hover:underline"
                      >
                        <Icon name="pin" size={14} />
                        {r.location.speed !== undefined ? `${Math.round(r.location.speed)} km/h` : 'Map'}
                      </a>
                    ) : (
                      <span className="text-ink-muted">No GPS</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE * 2)}
          className="self-center text-sm font-semibold text-accent-glow hover:underline"
        >
          Show more ({rows.length - shown} more minutes)
        </button>
      )}
      <p className="text-[11px] text-ink-muted">
        The car sends a reading about every second; each row sums up one minute (worst state, averages). Distance comes
        from the car's GPS and skips the drift while parked.
      </p>
    </GlassCard>
  );
}
