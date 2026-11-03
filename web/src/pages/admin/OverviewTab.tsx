import { useQuery } from '@tanstack/react-query';
import { getDailyReport, getOverview, MODEL_LABEL, type ModelKind } from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { formatTime } from '../../lib/format';
import { Badge, JobStatusPill, Section, pctOrDash } from './shared';

const STEPS = [
  {
    icon: 'drivers',
    title: '1 · Collect data',
    text: 'Parents tap "False alarm"; record drives; download public datasets.',
  },
  {
    icon: 'refresh',
    title: '2 · Train',
    text: 'The worker runs the ML scripts in the background and streams the log.',
  },
  {
    icon: 'eye',
    title: '3 · Review',
    text: 'Every run is tested on drivers it never saw: compare it with the live model.',
  },
  {
    icon: 'check',
    title: '4 · Promote',
    text: 'One click makes it live for every driver and in-car device; rollback any time.',
  },
] as const;

const hours = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;

/** Last 14 days from the database views (alerts per day, minutes monitored and drowsy). */
function DailyReport() {
  const q = useQuery({
    queryKey: ['admin', 'reports', 'daily'],
    queryFn: () => getDailyReport(14),
    refetchInterval: 60000,
  });
  const rows = q.data?.rows ?? [];
  return (
    <Section title="Last 14 days" subtitle="Alerts, false alarms and how long drivers were monitored, per day.">
      {q.isError ? (
        <GlassCard interactive={false} className="text-red-200">
          {errorMessage(q.error)}
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard interactive={false} className="text-sm text-ink-muted" data-testid="daily-report-empty">
          {q.isLoading ? 'Loading…' : 'No readings or alerts in the last 14 days.'}
        </GlassCard>
      ) : (
        <GlassCard interactive={false} className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" data-testid="daily-report">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Day</th>
                <th className="px-4 py-3 text-center font-semibold">Alerts</th>
                <th className="px-4 py-3 text-center font-semibold">False alarms</th>
                <th className="px-4 py-3 text-center font-semibold">Drivers</th>
                <th className="px-4 py-3 font-semibold">Monitored</th>
                <th className="px-4 py-3 font-semibold">Drowsy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-b border-white/5">
                  <td className="px-4 py-3 font-semibold text-white">{r.day}</td>
                  <td className="px-4 py-3 text-center text-white">{r.alerts}</td>
                  <td className="px-4 py-3 text-center text-ink-muted">{r.falseAlarms}</td>
                  <td className="px-4 py-3 text-center text-ink-muted">{r.drivers}</td>
                  <td className="px-4 py-3 text-ink-muted">{hours(r.minutesMonitored)}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.drowsyMinutes ? hours(r.drowsyMinutes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}
    </Section>
  );
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: 'datasets' | 'training' | 'models') => void }) {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: getOverview, refetchInterval: 30000 });
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
  const o = q.data;

  return (
    <div className="flex flex-col gap-8" data-testid="admin-overview">
      {o.worker.enabled ? (
        <p
          data-testid="worker-online"
          className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent-ok shadow-[0_0_8px_#10b981]" />
          {o.worker.mode === 'remote'
            ? `Training worker online on ${o.worker.host ?? 'your laptop'}: jobs you start here run there.`
            : 'Training runs on this server.'}
        </p>
      ) : (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <p>
            <strong>No training worker online.</strong> Training needs the ml/ Python environment, which the cloud
            server doesn't have. Start the worker on your laptop and leave it running while you train:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-amber-50">
            cd guardian-drive\backend{'\n'}npm run worker
          </pre>
          <p className="mt-2 text-xs text-amber-200/80">
            Models can still be reviewed and promoted without it. Details: docs/ADMIN.md.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Parents', o.counts.parents],
          ['Drivers', o.counts.drivers],
          ['Alerts (7 days)', o.counts.alerts7d],
          [
            'Labelled alerts',
            `${o.feedback.labelled}${o.feedback.falseAlarmRate !== null ? ` · ${pctOrDash(o.feedback.falseAlarmRate)} false` : ''}`,
          ],
        ].map(([label, value]) => (
          <GlassCard key={label} interactive={false}>
            <p className="label">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-white">{value}</p>
          </GlassCard>
        ))}
      </div>

      <DailyReport />

      <Section title="Live models" subtitle="What every driver and in-car device uses right now.">
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(MODEL_LABEL) as ModelKind[]).map((kind) => {
            const m = o.models[kind] as {
              bundled?: boolean;
              summary?: Record<string, unknown>;
              promotedAt?: string | null;
            };
            return (
              <GlassCard key={kind} interactive={false} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{MODEL_LABEL[kind]}</p>
                  {m.bundled ? <Badge>bundled</Badge> : <Badge tone="ok">promoted</Badge>}
                </div>
                <p className="text-sm text-ink-muted">
                  {m.bundled
                    ? 'The version shipped with the code.'
                    : `Promoted ${m.promotedAt ? formatTime(m.promotedAt) : ''}`}
                </p>
              </GlassCard>
            );
          })}
        </div>
      </Section>

      <Section title="How training works">
        <div className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s) => (
            <GlassCard key={s.title} interactive={false} className="flex flex-col gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/25 text-accent-glow">
                <Icon name={s.icon} size={20} />
              </span>
              <p className="font-semibold text-white">{s.title}</p>
              <p className="text-sm text-ink-muted">{s.text}</p>
            </GlassCard>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <DepthButton variant="secondary" onClick={() => onNavigate('datasets')}>
            Datasets
          </DepthButton>
          <DepthButton variant="secondary" onClick={() => onNavigate('training')}>
            Start training
          </DepthButton>
          <DepthButton variant="secondary" onClick={() => onNavigate('models')}>
            Review models
          </DepthButton>
        </div>
      </Section>

      {o.lastJob && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          Last job: {o.lastJob.type.replace('_', ' ')} <JobStatusPill status={o.lastJob.status} />{' '}
          {formatTime(o.lastJob.createdAt)}
        </p>
      )}
    </div>
  );
}
