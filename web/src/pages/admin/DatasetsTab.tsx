import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDatasets, startJob, uploadRecording, type CatalogDataset, type JobType } from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { useToast } from '../../components/ui/Toast';
import { formatTime } from '../../lib/format';
import { Badge, Section } from './shared';

const TASK_LABEL: Record<CatalogDataset['task'], string> = {
  eye_state: 'Eye model',
  yawn_calibration: 'Yawn calibration',
  video: 'Verifier (video)',
  reference: 'Reference',
};

export function DatasetsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['admin', 'datasets'], queryFn: getDatasets });

  const job = useMutation({
    mutationFn: ({ type, params }: { type: JobType; params: Record<string, unknown> }) => startJob(type, params),
    onSuccess: (j) => {
      toast.show({ title: 'Job queued', body: 'Follow it on the Training tab.', tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      return j;
    },
    onError: (err) => toast.show({ title: 'Could not start', body: errorMessage(err), tone: 'danger' }),
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const results = [];
      for (const f of Array.from(files)) results.push(await uploadRecording(f.name, await f.text()));
      return results;
    },
    onSuccess: (r) => {
      toast.show({
        title: `${r.length} recording(s) uploaded`,
        body: 'Import them to use them for training.',
        tone: 'success',
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'datasets'] });
    },
    onError: (err) => toast.show({ title: 'Upload rejected', body: errorMessage(err), tone: 'danger' }),
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-16">
        <OrbitLoader size={72} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <GlassCard interactive={false} className="text-red-200">
        {errorMessage(q.error)}
      </GlassCard>
    );
  const d = q.data;

  return (
    <div className="flex flex-col gap-8" data-testid="admin-datasets">
      <Section title="Your data" subtitle="Collected by Guardian Drive itself: the most valuable training data.">
        <div className="grid gap-4 md:grid-cols-3">
          <GlassCard interactive={false} className="flex flex-col gap-1.5">
            <p className="font-semibold text-white">Parent feedback</p>
            <p className="text-3xl font-extrabold text-white">{d.feedback.labelled}</p>
            <p className="text-sm text-ink-muted">
              labelled alerts · {d.feedback.falseAlarms} false alarms · {d.feedback.realAlarms} real ·{' '}
              {d.feedback.withWindow} with signal window
            </p>
            <p className="text-xs text-ink-muted">Added automatically to every verifier training run (weight 5×).</p>
          </GlassCard>
          <GlassCard interactive={false} className="flex flex-col gap-1.5">
            <p className="font-semibold text-white">Recorded drives</p>
            {d.recordings.length ? (
              <ul className="text-sm text-ink-muted">
                {d.recordings.map((r) => (
                  <li key={r.name}>
                    <span className="font-mono text-white">{r.name}</span>
                    {r.drivers !== null && ` · ${r.drivers} drivers`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">None yet.</p>
            )}
            <p className="text-xs text-ink-muted">
              {d.uploads} uploaded file(s) waiting. Record with{' '}
              <code>python main.py --offline --record drive.jsonl</code>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <DepthButton
                size="sm"
                variant="secondary"
                icon={<Icon name="upload" size={16} />}
                loading={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Upload .jsonl
              </DepthButton>
              <DepthButton
                size="sm"
                variant="secondary"
                disabled={!d.uploads}
                onClick={() => job.mutate({ type: 'import_uploads', params: {} })}
              >
                Import uploads
              </DepthButton>
              <input
                ref={fileRef}
                type="file"
                accept=".jsonl,application/json"
                multiple
                className="hidden"
                aria-label="Upload recordings"
                onChange={(e) => {
                  if (e.target.files?.length) upload.mutate(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </GlassCard>
          <GlassCard interactive={false} className="flex flex-col gap-1.5">
            <p className="font-semibold text-white">Synthetic signals</p>
            <p className="text-sm text-ink-muted">
              {d.synthetic.main
                ? 'Generated: simulated drivers, drowsiness and look-alikes (phone glances, squinting…).'
                : 'Generated automatically on the first verifier run.'}
            </p>
            <p className="text-xs text-ink-muted">Always part of verifier training; real data is added on top.</p>
          </GlassCard>
        </div>
      </Section>

      <Section
        title="Public datasets"
        subtitle="Kaggle sets download with one click. Video datasets need access requested on their site."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {d.catalog.map((ds) => (
            <GlassCard key={ds.id} interactive={false} className="flex flex-col gap-2" data-testid={`dataset-${ds.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto font-semibold text-white">{ds.title}</p>
                <Badge tone="info">{TASK_LABEL[ds.task]}</Badge>
                <Badge>
                  {ds.source === 'kaggle'
                    ? `Kaggle${ds.sizeMb ? ` · ${ds.sizeMb >= 1000 ? `${(ds.sizeMb / 1000).toFixed(1)} GB` : `${ds.sizeMb} MB`}` : ''}`
                    : 'Request access'}
                </Badge>
              </div>
              <p className="text-sm text-ink-muted">{ds.description}</p>
              {ds.slug && (
                <a
                  className="text-xs text-accent-glow hover:underline"
                  href={`https://www.kaggle.com/datasets/${ds.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  kaggle.com/datasets/{ds.slug}
                </a>
              )}
              {ds.url && (
                <a
                  className="text-xs text-accent-glow hover:underline"
                  href={ds.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {ds.url}
                </a>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {ds.task === 'eye_state' &&
                  (ds.local.ready ? (
                    <Badge tone="ok">
                      Downloaded · {ds.local.open} open / {ds.local.closed} closed
                    </Badge>
                  ) : (
                    <DepthButton
                      size="sm"
                      icon={<Icon name="download" size={16} />}
                      onClick={() => job.mutate({ type: 'fetch_dataset', params: { datasetId: ds.id } })}
                    >
                      Download
                    </DepthButton>
                  ))}
                {ds.task === 'yawn_calibration' && (
                  <>
                    <DepthButton
                      size="sm"
                      onClick={() => job.mutate({ type: 'calibrate_yawn', params: { datasetId: ds.id } })}
                    >
                      Calibrate yawn detector
                    </DepthButton>
                    {ds.local.lastCalibrated && <Badge tone="ok">last run {formatTime(ds.local.lastCalibrated)}</Badge>}
                  </>
                )}
                {ds.task === 'video' && (
                  <>
                    <DepthButton
                      size="sm"
                      disabled={!ds.local.videos}
                      onClick={() =>
                        job.mutate({ type: 'process_videos', params: { folder: ds.id, preset: ds.preset } })
                      }
                    >
                      Process {ds.local.videos ? `${ds.local.videos} videos` : 'videos'}
                    </DepthButton>
                    {ds.local.processed && <Badge tone="ok">recordings ready</Badge>}
                    {!ds.local.videos && (
                      <span className="text-xs text-ink-muted">
                        Place videos in <code className="break-all">{ds.local.folder}</code>
                      </span>
                    )}
                  </>
                )}
                {ds.task === 'reference' && <span className="text-xs text-ink-muted">Not used automatically.</span>}
              </div>
            </GlassCard>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          Check each dataset’s licence on its page before using it beyond research. Downloaded data stays on the
          training machine (ml/data, gitignored); only the trained model is stored in the database.
        </p>
      </Section>
    </div>
  );
}
