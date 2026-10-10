import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelJob, getDatasets, getJob, JOB_LABEL, listJobs, startJob, type JobType, type TrainingJob } from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { useToast } from '../../components/ui/Toast';
import { formatTime } from '../../lib/format';
import { JobStatusPill, Section, duration } from './shared';

function JobLog({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin', 'job', id], queryFn: () => getJob(id) });
  const ref = useRef<HTMLPreElement>(null);
  const log = q.data?.log ?? '';
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  if (q.isLoading) return <p className="p-3 text-sm text-ink-muted">Loading log…</p>;
  return (
    <pre
      ref={ref}
      data-testid="job-log"
      className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/50 p-3 font-mono text-xs leading-relaxed text-slate-200"
    >
      {log || 'Waiting for output…'}
    </pre>
  );
}

export function TrainingTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [includeFeedback, setIncludeFeedback] = useState(true);
  const [recordings, setRecordings] = useState<string[]>([]);
  const [eyeSets, setEyeSets] = useState<string[]>(['yawn-eye']);

  const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: listJobs, refetchInterval: 10000 });
  const datasets = useQuery({ queryKey: ['admin', 'datasets'], queryFn: getDatasets });
  const eyeReady = (datasets.data?.catalog ?? []).filter((d) => d.task === 'eye_state' && d.local.ready);

  const start = useMutation({
    mutationFn: ({ type, params }: { type: JobType; params: Record<string, unknown> }) => startJob(type, params),
    onSuccess: (job) => {
      setOpen(job.id);
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
    },
    onError: (err) => toast.show({ title: 'Could not start', body: errorMessage(err), tone: 'danger' }),
  });
  const cancel = useMutation({
    mutationFn: cancelJob,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }),
  });

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="flex flex-col gap-8" data-testid="admin-training">
      <Section title="Start training" subtitle="Each run is tested on drivers/images it never saw, then saved as a candidate under Models.">
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard interactive={false} className="flex flex-col gap-3">
            <div>
              <p className="font-semibold text-white">False-alarm verifier</p>
              <p className="text-sm text-ink-muted">
                Learns which alerts are real from 30-second signal windows: synthetic drives + your data.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={includeFeedback} onChange={(e) => setIncludeFeedback(e.target.checked)} />
              Include parent feedback ({datasets.data?.feedback.labelled ?? 0} labelled alerts)
            </label>
            {(datasets.data?.recordings ?? []).map((r) => (
              <label key={r.name} className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={recordings.includes(r.name)} onChange={() => setRecordings((l) => toggle(l, r.name))} />
                Recordings: <span className="font-mono">{r.name}</span>
              </label>
            ))}
            <DepthButton
              icon={<Icon name="refresh" size={18} />}
              loading={start.isPending && start.variables?.type === 'train_verifier'}
              onClick={() => start.mutate({ type: 'train_verifier', params: { includeFeedback, recordings } })}
            >
              Train verifier
            </DepthButton>
            <p className="text-xs text-ink-muted">Takes a few minutes (longer on the first run while synthetic data is generated).</p>
          </GlassCard>

          <GlassCard interactive={false} className="flex flex-col gap-3">
            <div>
              <p className="font-semibold text-white">Eye open/closed model</p>
              <p className="text-sm text-ink-muted">Image model used by the in-car monitor. Combine several datasets for variety.</p>
            </div>
            {eyeReady.length ? (
              eyeReady.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={eyeSets.includes(d.id)} onChange={() => setEyeSets((l) => toggle(l, d.id))} />
                  {d.title} ({d.local.images} images)
                </label>
              ))
            ) : (
              <p className="text-sm text-ink-muted">Download an eye dataset on the Datasets tab first.</p>
            )}
            <DepthButton
              icon={<Icon name="eye" size={18} />}
              disabled={!eyeSets.some((id) => eyeReady.some((d) => d.id === id))}
              loading={start.isPending && start.variables?.type === 'train_eye_state'}
              onClick={() =>
                start.mutate({ type: 'train_eye_state', params: { datasets: eyeSets.filter((id) => eyeReady.some((d) => d.id === id)) } })
              }
            >
              Train eye model
            </DepthButton>
          </GlassCard>
        </div>
      </Section>

      <Section title="Jobs" subtitle="One job runs at a time; others wait in the queue. Click a job for its live log.">
        {jobs.isLoading ? (
          <div className="flex justify-center py-10"><OrbitLoader size={60} /></div>
        ) : jobs.data?.jobs.length ? (
          <div className="flex flex-col gap-2">
            {jobs.data.jobs.map((j: TrainingJob) => (
              <GlassCard key={j.id} interactive={false} padded={false} className="overflow-hidden" data-testid="job-row">
                <button type="button" onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full flex-wrap items-center gap-3 p-4 text-left">
                  <JobStatusPill status={j.status} />
                  <span className="font-semibold text-white">{JOB_LABEL[j.type]}</span>
                  {'datasetId' in j.params && <span className="font-mono text-xs text-ink-muted">{String(j.params.datasetId)}</span>}
                  <span className="ml-auto text-xs text-ink-muted">
                    {formatTime(j.createdAt)} · {duration(j.startedAt, j.finishedAt)}
                  </span>
                </button>
                {open === j.id && (
                  <div className="flex flex-col gap-2 px-4 pb-4">
                    {j.error && <p className="text-sm text-red-200">{j.error}</p>}
                    <JobLog id={j.id} />
                    {(j.status === 'queued' || j.status === 'running') && (
                      <DepthButton size="sm" variant="danger" className="self-start" loading={cancel.isPending} onClick={() => cancel.mutate(j.id)}>
                        Cancel
                      </DepthButton>
                    )}
                    {j.releaseId && <p className="text-sm text-emerald-200">Candidate model saved: review it on the Models tab.</p>}
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No jobs yet.</p>
        )}
      </Section>
    </div>
  );
}
