import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useAuth } from '../../store/auth';
import { useRealtime } from '../../hooks/useRealtime';
import type { TrainingJob } from '../../api/admin';
import { OverviewTab } from './OverviewTab';
import { DatasetsTab } from './DatasetsTab';
import { TrainingTab } from './TrainingTab';
import { ModelsTab } from './ModelsTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'datasets', label: 'Datasets' },
  { id: 'training', label: 'Training' },
  { id: 'models', label: 'Models' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Live job status + log lines from the training worker (admins' socket room). */
function useTrainingEvents() {
  const { socket } = useRealtime();
  const qc = useQueryClient();
  useEffect(() => {
    if (!socket) return undefined;
    const onJob = (job: TrainingJob) => {
      qc.setQueryData<TrainingJob>(['admin', 'job', job.id], (old) => ({ ...old, ...job, log: old?.log ?? '' }));
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      if (job.status === 'succeeded') {
        void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'datasets'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      }
    };
    const onLog = ({ jobId, text }: { jobId: string; text: string }) => {
      qc.setQueryData<TrainingJob>(['admin', 'job', jobId], (old) =>
        old ? { ...old, log: ((old.log ?? '') + text).slice(-60000) } : old,
      );
    };
    socket.on('training:job', onJob);
    socket.on('training:log', onLog);
    return () => {
      socket.off('training:job', onJob);
      socket.off('training:log', onLog);
    };
  }, [socket, qc]);
}

export function AdminPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as TabId;
  useTrainingEvents();

  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">Admin · model training</h1>
        <p className="text-sm text-ink-muted">
          Collect data, train, review the test results and promote a model to make it live, for every driver and
          in-car device.
        </p>
      </header>

      <div className="glass-inset inline-flex w-full max-w-xl p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`relative h-10 flex-1 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'text-white' : 'text-ink-muted hover:text-white'}`}
          >
            {tab === t.id && (
              <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-lg bg-accent-primary/40 shadow-glow" />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab onNavigate={(id) => setParams({ tab: id })} />}
      {tab === 'datasets' && <DatasetsTab />}
      {tab === 'training' && <TrainingTab />}
      {tab === 'models' && <ModelsTab />}
    </div>
  );
}
