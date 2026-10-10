import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listDrivers } from '../api/drivers';
import { errorMessage } from '../api/client';
import { usePollingFallback } from '../hooks/useRealtime';
import { DriverList } from '../components/driver/DriverList';
import { DepthButton } from '../components/ui/DepthButton';
import { GlassCard } from '../components/ui/GlassCard';
import { Icon } from '../components/ui/Icon';
import { OrbitLoader } from '../components/ui/OrbitLoader';

export function DriversPage() {
  const refetchInterval = usePollingFallback();
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers, refetchInterval });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Drivers</h1>
          <p className="text-sm text-ink-muted">Each driver has personal, self-tuning drowsiness thresholds.</p>
        </div>
        <Link to="/drivers/new">
          <DepthButton icon={<Icon name="plus" size={18} />}>Register driver</DepthButton>
        </Link>
      </header>
      {drivers.isLoading ? (
        <div className="flex justify-center py-16"><OrbitLoader size={72} /></div>
      ) : drivers.isError ? (
        <GlassCard interactive={false} className="text-red-200">{errorMessage(drivers.error)}</GlassCard>
      ) : (
        <DriverList drivers={drivers.data ?? []} />
      )}
    </div>
  );
}
