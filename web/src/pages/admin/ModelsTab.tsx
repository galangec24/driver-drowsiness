import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getModel,
  listModels,
  MODEL_LABEL,
  promoteModel,
  resetModel,
  type ModelKind,
  type ModelRelease,
} from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatTime } from '../../lib/format';
import { Badge, Section, numOrDash, pctOrDash } from './shared';

const KIND_HELP: Record<ModelKind, string> = {
  fp_verifier: 'Lower false alerts/hour is better, as long as drowsy episodes caught stays near 100 %.',
  eye_state: 'Accuracy on held-out eye photos; "webcam" = the same photos degraded to webcam quality.',
  yawn_threshold: 'Mouth-opening level that counts as a yawn, chosen to best separate yawning from non-yawning faces.',
};

/** The two or three numbers that matter for each kind, as table columns. */
function columns(kind: ModelKind): { label: string; value: (s: Record<string, unknown>) => string }[] {
  if (kind === 'fp_verifier') {
    return [
      {
        label: 'False alerts / h',
        value: (s) => `${numOrDash(s.falseAlertsPerHour)} (fusion only ${numOrDash(s.baselineFalseAlertsPerHour)})`,
      },
      { label: 'Drowsy episodes caught', value: (s) => pctOrDash(s.episodeRecall) },
      {
        label: 'Harder population',
        value: (s) =>
          s.shiftFalseAlertsPerHour == null
            ? '—'
            : `${numOrDash(s.shiftFalseAlertsPerHour)}/h · ${pctOrDash(s.shiftRecall)}`,
      },
      {
        label: 'Trained on',
        value: (s) => `${((s.data as string[]) ?? []).join(' + ')}${s.feedback ? ' + feedback' : ''}`,
      },
    ];
  }
  if (kind === 'eye_state') {
    return [
      { label: 'Accuracy', value: (s) => pctOrDash(s.accuracy, 1) },
      { label: 'Webcam quality', value: (s) => pctOrDash(s.webcamAccuracy, 1) },
      {
        label: 'Datasets',
        value: (s) => ((s.datasets as string[]) ?? []).map((d) => d.replace('data/', '')).join(', '),
      },
    ];
  }
  return [
    { label: 'Yawn threshold (MAR)', value: (s) => numOrDash(s.yawnMar) },
    {
      label: 'Balanced accuracy',
      value: (s) => `${pctOrDash(s.balancedAccuracy)} (current ${pctOrDash(s.currentBalancedAccuracy)})`,
    },
    { label: 'Yawns caught / false', value: (s) => `${pctOrDash(s.yawnsCaught)} / ${pctOrDash(s.falseYawns)}` },
  ];
}

function ReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'model', id], queryFn: () => getModel(id) });
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Evaluation report"
        onClick={(e) => e.stopPropagation()}
        className="glass max-h-[88vh] w-full max-w-3xl overflow-y-auto bg-ink-900/95 p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Evaluation report</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-2 text-ink-muted hover:bg-white/10 hover:text-white"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {q.isLoading ? (
          <div className="flex justify-center py-10 text-accent-glow">
            <Spinner size={28} />
          </div>
        ) : (
          <pre
            className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/90"
            data-testid="model-report"
          >
            {q.data?.report || 'No report saved for this model.'}
          </pre>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ModelsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [report, setReport] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'models'], queryFn: listModels });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const promote = useMutation({
    mutationFn: promoteModel,
    onSuccess: (r) => {
      refresh();
      toast.show({
        title: `${MODEL_LABEL[r.kind]} promoted`,
        body: 'Live now for all drivers; in-car devices pick it up within 5 minutes.',
        tone: 'success',
      });
    },
    onError: (err) => toast.show({ title: 'Promotion refused', body: errorMessage(err), tone: 'danger' }),
  });
  const reset = useMutation({
    mutationFn: resetModel,
    onSuccess: () => {
      refresh();
      toast.show({ title: 'Back to the bundled model', tone: 'info' });
    },
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-16">
        <OrbitLoader size={72} />
      </div>
    );
  if (q.isError)
    return (
      <GlassCard interactive={false} className="text-red-200">
        {errorMessage(q.error)}
      </GlassCard>
    );
  const releases = q.data ?? [];

  return (
    <div className="flex flex-col gap-8" data-testid="admin-models">
      {(Object.keys(MODEL_LABEL) as ModelKind[]).map((kind) => {
        const list = releases.filter((r) => r.kind === kind);
        const active = list.find((r) => r.status === 'active');
        const cols = columns(kind);
        return (
          <Section
            key={kind}
            title={MODEL_LABEL[kind]}
            subtitle={KIND_HELP[kind]}
            action={
              active && (
                <DepthButton size="sm" variant="ghost" loading={reset.isPending} onClick={() => reset.mutate(kind)}>
                  Revert to bundled
                </DepthButton>
              )
            }
          >
            <GlassCard interactive={false} padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-ink-muted">
                  <tr>
                    <th className="p-3">Model</th>
                    {cols.map((c) => (
                      <th key={c.label} className="p-3">
                        {c.label}
                      </th>
                    ))}
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {!active && (
                    <tr className="border-t border-white/5">
                      <td className="p-3 text-white" colSpan={cols.length + 2}>
                        <Badge tone="ok">live</Badge> <span className="ml-1">Bundled with the code</span>
                      </td>
                    </tr>
                  )}
                  {list.map((r: ModelRelease) => (
                    <tr key={r.id} className="border-t border-white/5" data-testid={`release-${r.id}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {r.status === 'active' ? (
                            <Badge tone="ok">live</Badge>
                          ) : r.status === 'candidate' ? (
                            <Badge tone="info">candidate</Badge>
                          ) : (
                            <Badge>retired</Badge>
                          )}
                          <span className="text-xs text-ink-muted">{formatTime(r.createdAt)}</span>
                        </div>
                      </td>
                      {cols.map((c) => (
                        <td key={c.label} className="p-3 text-white">
                          {c.value(r.summary)}
                        </td>
                      ))}
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <DepthButton size="sm" variant="ghost" onClick={() => setReport(r.id)}>
                            Report
                          </DepthButton>
                          {r.status !== 'active' && (
                            <DepthButton
                              size="sm"
                              loading={promote.isPending && promote.variables === r.id}
                              onClick={() => promote.mutate(r.id)}
                            >
                              {r.status === 'retired' ? 'Roll back to this' : 'Promote'}
                            </DepthButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          </Section>
        );
      })}
      {report && <ReportModal id={report} onClose={() => setReport(null)} />}
    </div>
  );
}
