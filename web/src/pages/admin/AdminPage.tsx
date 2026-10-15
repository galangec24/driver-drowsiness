import { useEffect } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useAuth } from '../../store/auth';
import { useRealtime } from '../../hooks/useRealtime';
import type { TrainingJob } from '../../api/admin';
import { OverviewTab } from './OverviewTab';
import { ParentsTab } from './ParentsTab';
import { DatasetsTab } from './DatasetsTab';
import { TrainingTab } from './TrainingTab';
import { ModelsTab } from './ModelsTab';
import { FeedbackTab } from './FeedbackTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'parents', label: 'Parents' },
  { id: 'feedback', label: 'Feedback' },
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
    // New feedback from users / replies from another admin: refresh the inbox.
    const onFeedback = () => void qc.invalidateQueries({ queryKey: ['admin', 'feedback'] });
    socket.on('feedback:new', onFeedback);
    socket.on('feedback:updated', onFeedback);
    socket.on('training:job', onJob);
    socket.on('training:log', onLog);
    return () => {
      socket.off('feedback:new', onFeedback);
      socket.off('feedback:updated', onFeedback);
      socket.off('training:job', onJob);
      socket.off('training:log', onLog);
    };
  }, [socket, qc]);
}

export function AdminPage() {
  const { user } = useAuth();
  const { tab: pathTab } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // /admin/<tab>; the older /admin?tab=<tab> links still work.
  const tab = (TABS.find((t) => t.id === (pathTab ?? params.get('tab')))?.id ?? 'overview') as TabId;
  const go = (id: TabId) => navigate(id === 'overview' ? '/admin' : `/admin/${id}`);
  useTrainingEvents();

  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">{tab === 'parents' ? 'Admin · parents' : 'Admin console'}</h1>
        <p className="text-sm text-ink-muted">
          {tab === 'parents'
            ? 'Every account and the drivers registered to it. Click a row to see the drivers.'
            : 'Accounts across the system, and the models every driver and in-car device uses: collect data, train, review and promote.'}
        </p>
      </header>

      <div className="glass-inset inline-flex w-full max-w-2xl overflow-x-auto p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={`relative h-10 min-w-[84px] flex-1 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'text-white' : 'text-ink-muted hover:text-white'}`}
          >
            {tab === t.id && (
              <motion.span
                layoutId="admin-tab"
                className="absolute inset-0 rounded-lg bg-accent-primary/40 shadow-glow"
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab onNavigate={go} />}
      {tab === 'parents' && <ParentsTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'datasets' && <DatasetsTab />}
      {tab === 'training' && <TrainingTab />}
      {tab === 'models' && <ModelsTab />}
    </div>
  );
}
