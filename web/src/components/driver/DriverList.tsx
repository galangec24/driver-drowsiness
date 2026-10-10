import { Link } from 'react-router-dom';
import type { Driver } from '../../api/types';
import { useRealtime } from '../../hooks/useRealtime';
import { DriverCard } from './DriverCard';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

export function DriverList({ drivers }: { drivers: Driver[] }) {
  const { live, pulsing } = useRealtime();

  if (!drivers.length) {
    return (
      <div className="glass flex flex-col items-center gap-4 px-6 py-12 text-center">
        <Icon name="drivers" size={40} className="text-accent-glow" />
        <div>
          <p className="text-lg font-semibold text-white">No drivers yet</p>
          <p className="text-sm text-ink-muted">Register a driver with three face photos to start monitoring.</p>
        </div>
        <Link to="/drivers/new">
          <DepthButton icon={<Icon name="plus" size={18} />}>Register driver</DepthButton>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4">
      {drivers.map((d) => (
        <DriverCard key={d.id} driver={d} live={live[d.id]} pulsing={pulsing.has(d.id)} />
      ))}
    </div>
  );
}
