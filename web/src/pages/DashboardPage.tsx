import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { listDrivers } from '../api/drivers';
import { listAlerts } from '../api/alerts';
import { useAuth } from '../store/auth';
import { usePollingFallback, useRealtime } from '../hooks/useRealtime';
import { DriverList } from '../components/driver/DriverList';
import { AlertFeed } from '../components/alert/AlertFeed';
import { GlassCard } from '../components/ui/GlassCard';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { OrbitLoader } from '../components/ui/OrbitLoader';
import { errorMessage } from '../api/client';
import { useNow } from '../hooks/useNow';

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <GlassCard className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className={`text-3xl font-extrabold ${tone}`}>{value}</span>
    </GlassCard>
  );
}

export function DashboardPage() {
  useNow(5000);
  const { user } = useAuth();
  const { live, connected } = useRealtime();
  const refetchInterval = usePollingFallback();
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers, refetchInterval });
  const alerts = useQuery({
    queryKey: ['alerts', { limit: 20 }],
    queryFn: () => listAlerts({ limit: 20 }),
    refetchInterval,
  });

  const list = drivers.data ?? [];
  const recentCutoff = Date.now() - 30000;
  const onlineDrivers = list.filter((d) => {
    const last = live[d.id]?.lastUpdate ?? d.lastUpdate;
    return last && new Date(last).getTime() > recentCutoff;
  });
  const online = onlineDrivers.length;
  const drowsyNow = onlineDrivers.filter((d) => (live[d.id]?.status ?? d.status) === 'drowsy').length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <h1 className="page-title">Dashboard</h1>
        </div>
        <Link to="/drivers/new">
          <DepthButton icon={<Icon name="plus" size={18} />}>Register driver</DepthButton>
        </Link>
      </header>

      <motion.section
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05 } } }}
      >
        <Stat label="Drivers" value={list.length} tone="text-white" />
        <Stat label="Driving now" value={online} tone="text-emerald-300" />
        <Stat
          label="Unacknowledged"
          value={alerts.data?.unacknowledged ?? 0}
          tone={(alerts.data?.unacknowledged ?? 0) > 0 ? 'text-amber-300' : 'text-white'}
        />
        <Stat label="Drowsy now" value={drowsyNow} tone={drowsyNow > 0 ? 'text-red-300' : 'text-white'} />
      </motion.section>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Your drivers</h2>
          {drivers.isLoading ? (
            <div className="flex justify-center py-16">
              <OrbitLoader size={72} />
            </div>
          ) : drivers.isError ? (
            <GlassCard interactive={false} className="text-red-200">
              {errorMessage(drivers.error)}
            </GlassCard>
          ) : (
            <DriverList drivers={list} />
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Live alerts</h2>
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-accent-ok animate-pulse' : 'bg-accent-warn'}`} />
              {connected ? 'Live' : 'Polling'}
            </span>
          </div>
          {alerts.isLoading ? (
            <div className="flex justify-center py-16">
              <OrbitLoader size={72} />
            </div>
          ) : (
            <AlertFeed alerts={alerts.data?.alerts ?? []} compact />
          )}
          <Link to="/alerts" className="mt-3 block text-center text-sm font-semibold text-accent-glow hover:underline">
            View all alerts →
          </Link>
        </section>
      </div>
    </div>
  );
}
