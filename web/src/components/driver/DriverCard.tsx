import { Link } from 'react-router-dom';
import type { Driver, DriverLiveStatus, DriverStatus } from '../../api/types';
import { GlassCard } from '../ui/GlassCard';
import { StatusPill } from '../ui/StatusPill';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { num, pct, timeAgo } from '../../lib/format';
import { useNow } from '../../hooks/useNow';

export interface DriverCardProps {
  driver: Driver;
  live?: DriverLiveStatus;
  pulsing?: boolean;
}

function effectiveStatus(driver: Driver, live: DriverLiveStatus | undefined, now: number): DriverStatus {
  const last = live?.lastUpdate ?? driver.lastUpdate;
  // No data for 30 s → offline.
  if (!last || now - new Date(last).getTime() > 30000) return 'offline';
  return live?.status ?? driver.status;
}

export function DriverCard({ driver, live, pulsing }: DriverCardProps) {
  const now = useNow(5000);
  const status = effectiveStatus(driver, live, now);
  const s = live?.signals;
  const score = live?.fusionScore;

  return (
    <Link to={`/drivers/${driver.id}`} className="block rounded-2xl" data-testid="driver-card">
      <GlassCard danger={pulsing || status === 'drowsy'} className="h-full">
        <div className="flex items-center gap-4">
          <Avatar name={driver.name} url={driver.referencePhotoUrl} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold text-white">{driver.name}</h3>
            <p className="truncate text-sm capitalize text-ink-muted">{driver.relationship || 'Driver'}</p>
          </div>
          <StatusPill status={status} />
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-ink-muted">
            <span>Drowsiness score</span>
            <span className="font-semibold text-white">{status === 'offline' ? '—' : pct(score)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/30 shadow-inner">
            <div
              className={[
                'h-full rounded-full transition-all duration-300',
                (score ?? 0) > 0.7 ? 'bg-accent-danger shadow-glow-danger' : (score ?? 0) > 0.4 ? 'bg-accent-warn' : 'bg-accent-ok',
              ].join(' ')}
              style={{ width: status === 'offline' ? '0%' : `${Math.round((score ?? 0) * 100)}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ['EAR', num(s?.ear, 3)],
            ['PERCLOS', pct(s?.perclos)],
            ['HR', s?.heartRate ? `${s.heartRate}` : '—'],
            ['Yawn·Nod', typeof s?.yawnCount === 'number' ? `${s.yawnCount}·${s.nodCount ?? 0}` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="glass-inset py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{k}</dt>
              <dd className="text-sm font-bold text-white">{status === 'offline' ? '—' : v}</dd>
            </div>
          ))}
        </dl>

        {status !== 'offline' && live?.wearable && (
          <p className="mt-3 flex items-center gap-1.5 text-xs" data-testid="wearable-status">
            <Icon name="heart" size={13} className={live.wearable.connected ? 'text-pink-400' : 'text-ink-muted'} />
            {live.wearable.connected
              ? `Watch connected${live.wearable.contact === false ? ' · not on wrist' : ''}${
                  typeof live.wearable.battery === 'number' ? ` · ${live.wearable.battery}%` : ''
                }`
              : 'Watch not connected'}
          </p>
        )}
        {status !== 'offline' && live?.radar && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted" data-testid="radar-status">
            <Icon name="eye" size={13} className={live.radar.connected ? 'text-emerald-300' : 'text-ink-muted'} />
            {!live.radar.connected
              ? 'Dashboard radar offline'
              : live.radar.present === false
                ? 'Radar: driver not in range'
                : `Radar · ${typeof s?.breathingRate === 'number' ? `${s.breathingRate} breaths/min` : 'measuring…'}`}
          </p>
        )}
        <p className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span>Last update {timeAgo(live?.lastUpdate ?? driver.lastUpdate, now)}</span>
          {(live?.location ?? driver.lastLocation) && (
            <span className="inline-flex items-center gap-1 text-accent-glow" data-testid="has-location">
              <Icon name="pin" size={13} />
              {typeof (live?.location ?? driver.lastLocation)?.speed === 'number'
                ? `${Math.round((live?.location ?? driver.lastLocation)!.speed!)} km/h`
                : 'On map'}
            </span>
          )}
        </p>
      </GlassCard>
    </Link>
  );
}
