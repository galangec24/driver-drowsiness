import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QUESTION_TYPE_LABEL,
  adminSurveys,
  createSurvey,
  deleteSurvey,
  downloadSurveyExcel,
  importSurveyFile,
  setSurveyStatus,
  surveyResults,
  updateSurvey,
  type QuestionResult,
  type QuestionType,
  type Survey,
  type SurveyDraft,
  type SurveyQuestion,
} from '../../api/surveys';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { BarChart, ColumnChart } from '../../components/charts/Charts';
import { formatTime } from '../../lib/format';

const input =
  'h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-accent-glow/70';
const STATUS_STYLE: Record<Survey['status'], string> = {
  draft: 'bg-white/10 text-ink-muted',
  open: 'bg-emerald-400/15 text-emerald-200',
  closed: 'bg-amber-400/15 text-amber-200',
};

const emptyQuestion = (): SurveyQuestion => ({ text: '', type: 'single', options: ['', ''], required: false });

// ------------------------------------------------------------------------------- builder
function Builder({
  initial,
  surveyId,
  locked,
  onSaved,
  onCancel,
}: {
  initial: SurveyDraft;
  surveyId?: string;
  locked: boolean;
  onSaved: (s: Survey) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<SurveyDraft>(initial);
  const setQ = (i: number, patch: Partial<SurveyQuestion>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const qs = [...d.questions];
      const j = i + dir;
      const a = qs[i];
      const b = qs[j];
      if (!a || !b) return d;
      qs[i] = b;
      qs[j] = a;
      return { ...d, questions: qs };
    });

  const clean = (): SurveyDraft => ({
    ...draft,
    questions: draft.questions.map((q) => ({
      ...q,
      options: ['single', 'multiple'].includes(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    })),
  });
  const problems = clean().questions.flatMap((q, i) => [
    ...(!q.text.trim() ? [`Question ${i + 1} has no text`] : []),
    ...(['single', 'multiple'].includes(q.type) && q.options.length < 2 ? [`Question ${i + 1} needs two options`] : []),
  ]);

  const save = useMutation({
    mutationFn: () => {
      const body = clean();
      if (!surveyId) return createSurvey(body);
      return updateSurvey(surveyId, locked ? { title: body.title, description: body.description } : body);
    },
    onSuccess: (s) => {
      toast.show({ title: 'Survey saved', tone: 'success' });
      onSaved(s);
    },
    onError: (e) => toast.show({ title: 'Could not save', body: errorMessage(e), tone: 'danger' }),
  });

  return (
    <GlassCard interactive={false} className="flex flex-col gap-4" data-testid="survey-builder">
      {draft.source && (
        <p className="text-xs text-ink-muted">
          Imported from {draft.source.fileName}: check the questions below before saving.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="label">Title</span>
        <input
          className={input}
          value={draft.title}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Description (optional)</span>
        <textarea
          className="min-h-[60px] rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none"
          value={draft.description ?? ''}
          maxLength={2000}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      {locked && (
        <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">
          This survey already has responses, so its questions are locked. You can still change the title and
          description.
        </p>
      )}
      {draft.questions.map((q, i) => (
        <div key={i} className="glass-inset flex flex-col gap-3 p-4" data-testid="question-editor">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">Q{i + 1}</span>
            <input
              className={`${input} min-w-[12rem] flex-1`}
              placeholder="Question"
              value={q.text}
              disabled={locked}
              maxLength={500}
              onChange={(e) => setQ(i, { text: e.target.value })}
              aria-label={`Question ${i + 1}`}
            />
            <select
              className={`${input} w-auto`}
              value={q.type}
              disabled={locked}
              onChange={(e) => {
                const type = e.target.value as QuestionType;
                setQ(i, {
                  type,
                  options: ['single', 'multiple'].includes(type) && q.options.length < 2 ? ['', ''] : q.options,
                });
              }}
              aria-label={`Type of question ${i + 1}`}
            >
              {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
                <option key={t} value={t} className="bg-ink-900">
                  {QUESTION_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          {['single', 'multiple'].includes(q.type) && (
            <div className="flex flex-col gap-2 pl-8">
              {q.options.map((o, k) => (
                <div key={k} className="flex gap-2">
                  <input
                    className={input}
                    placeholder={`Option ${k + 1}`}
                    value={o}
                    disabled={locked}
                    maxLength={200}
                    onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })}
                  />
                  {!locked && q.options.length > 2 && (
                    <button
                      type="button"
                      className="px-2 text-ink-muted hover:text-white"
                      aria-label="Remove option"
                      onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k) })}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
              ))}
              {!locked && (
                <button
                  type="button"
                  className="self-start text-xs font-semibold text-accent-glow hover:underline"
                  onClick={() => setQ(i, { options: [...q.options, ''] })}
                >
                  + Add option
                </button>
              )}
            </div>
          )}
          {!locked && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />
                Required
              </label>
              <button type="button" className="hover:text-white" onClick={() => move(i, -1)}>
                Move up
              </button>
              <button type="button" className="hover:text-white" onClick={() => move(i, 1)}>
                Move down
              </button>
              <button
                type="button"
                className="ml-auto hover:text-red-300"
                onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))}
              >
                Delete question
              </button>
            </div>
          )}
        </div>
      ))}
      {!locked && (
        <DepthButton
          variant="secondary"
          icon={<Icon name="plus" size={16} />}
          onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, emptyQuestion()] }))}
        >
          Add question
        </DepthButton>
      )}
      {problems.length > 0 && <p className="text-xs text-amber-200">{problems[0]}</p>}
      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
        <DepthButton
          loading={save.isPending}
          disabled={!draft.title.trim() || !draft.questions.length || problems.length > 0}
          onClick={() => save.mutate()}
        >
          Save survey
        </DepthButton>
        <DepthButton variant="ghost" onClick={onCancel}>
          Cancel
        </DepthButton>
      </div>
    </GlassCard>
  );
}

// ------------------------------------------------------------------------------- results
function QuestionChart({ q, index }: { q: QuestionResult; index: number }) {
  return (
    <div className="glass-inset flex flex-col gap-3 p-4 print:break-inside-avoid" data-testid="question-result">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold text-white">
          {index + 1}. {q.text}
        </h3>
        <span className="ml-auto text-xs text-ink-muted">
          {q.answered} answered{q.skipped ? ` · ${q.skipped} skipped` : ''}
        </span>
      </div>
      {q.type === 'rating' && q.average !== null && q.average !== undefined && (
        <p className="text-sm text-ink-muted">
          Average <span className="text-2xl font-bold text-white">{q.average.toFixed(2)}</span> / 5
        </p>
      )}
      {q.counts && (
        <BarChart
          label={q.text}
          items={(q.type === 'rating' ? [...q.counts].reverse() : q.counts).map((c) => ({
            label: c.option,
            value: c.count,
            pct: c.pct,
          }))}
        />
      )}
      {q.type === 'multiple' && (
        <p className="text-xs text-ink-muted">Percentages are the share of people who picked each option.</p>
      )}
      {q.answers &&
        (q.answers.length ? (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto print:max-h-none">
            {q.answers.map((a, k) => (
              <li key={k} className="rounded-lg bg-white/5 p-2 text-sm text-white/90">
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No written answers yet.</p>
        ))}
    </div>
  );
}

function Results({ survey, onBack }: { survey: Survey; onBack: () => void }) {
  const toast = useToast();
  const res = useQuery({
    queryKey: ['admin', 'survey-results', survey.id],
    queryFn: () => surveyResults(survey.id),
    refetchInterval: 15000,
  });
  const [downloading, setDownloading] = useState(false);
  return (
    <div className="flex flex-col gap-4" data-testid="survey-results">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DepthButton variant="ghost" icon={<Icon name="back" size={16} />} onClick={onBack}>
          All surveys
        </DepthButton>
        <span className="ml-auto" />
        <DepthButton
          variant="secondary"
          icon={<Icon name="download" size={16} />}
          loading={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadSurveyExcel(survey.id, survey.title);
            } catch (e) {
              toast.show({ title: 'Download failed', body: errorMessage(e), tone: 'danger' });
            } finally {
              setDownloading(false);
            }
          }}
        >
          Excel
        </DepthButton>
        <DepthButton variant="secondary" onClick={() => window.print()}>
          Print / save as PDF
        </DepthButton>
      </div>
      <GlassCard interactive={false} className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{survey.title}</h2>
          <p className="text-sm text-ink-muted">
            <span className="text-2xl font-bold text-white">{res.data?.total ?? '…'}</span> responses
            {survey.publishedAt && ` · published ${formatTime(survey.publishedAt)}`}
          </p>
        </div>
        {res.data && res.data.perDay.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-white">Responses per day</h3>
            <ColumnChart points={res.data.perDay} label="Responses per day" />
          </div>
        )}
      </GlassCard>
      {res.data?.questions.map((q, i) => (
        <QuestionChart key={q.qid} q={q} index={i} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------- list
type View =
  { kind: 'list' } | { kind: 'edit'; draft: SurveyDraft; survey?: Survey } | { kind: 'results'; survey: Survey };

export function SurveysTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const surveys = useQuery({ queryKey: ['admin', 'surveys'], queryFn: adminSurveys });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'surveys'] });

  const importer = useMutation({
    mutationFn: importSurveyFile,
    onSuccess: (draft) => setView({ kind: 'edit', draft }),
    onError: (e) => toast.show({ title: 'Could not import the file', body: errorMessage(e), tone: 'danger' }),
  });
  const status = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'close' }) => setSurveyStatus(id, action),
    onSuccess: (s) => {
      refresh();
      toast.show({
        title: s.status === 'open' ? 'Survey published: users can answer it now' : 'Survey closed',
        tone: 'success',
      });
    },
    onError: (e) => toast.show({ title: 'Could not update', body: errorMessage(e), tone: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: deleteSurvey,
    onSuccess: () => {
      refresh();
      toast.show({ title: 'Survey deleted', tone: 'info' });
    },
  });

  if (view.kind === 'edit') {
    return (
      <Builder
        initial={view.draft}
        surveyId={view.survey?.id}
        locked={(view.survey?.responses ?? 0) > 0}
        onSaved={() => {
          refresh();
          setView({ kind: 'list' });
        }}
        onCancel={() => setView({ kind: 'list' })}
      />
    );
  }
  if (view.kind === 'results') return <Results survey={view.survey} onBack={() => setView({ kind: 'list' })} />;

  return (
    <div className="flex flex-col gap-4" data-testid="surveys-tab">
      <GlassCard interactive={false} className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-white">Create a survey</h2>
        <p className="text-sm text-ink-muted">
          Build it here, or import a Word (.docx), PDF or Excel (.xlsx) file. Word / PDF: number each question (1. 2.
          3.) and put the choices on the lines below it (a) b) or -). Add "*" for required, "(select all that apply)"
          for several choices, "1 to 5" for a star rating and "Yes / No" for yes-no. Excel: columns Question, Type,
          Options (separated by ;), Required.
        </p>
        <div className="flex flex-wrap gap-2">
          <DepthButton
            icon={<Icon name="plus" size={16} />}
            onClick={() =>
              setView({ kind: 'edit', draft: { title: '', description: '', questions: [emptyQuestion()] } })
            }
          >
            New survey
          </DepthButton>
          <DepthButton
            variant="secondary"
            icon={<Icon name="upload" size={16} />}
            loading={importer.isPending}
            onClick={() => fileRef.current?.click()}
          >
            Import Word / PDF / Excel
          </DepthButton>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="survey-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importer.mutate(f);
              e.target.value = '';
            }}
          />
        </div>
      </GlassCard>

      {(surveys.data ?? []).map((s) => (
        <GlassCard key={s.id} interactive={false} data-testid="survey-row">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white">{s.title}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s.status]}`}>
                  {s.status}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                {s.questions.length} questions · {s.responses ?? 0} responses
                {s.source ? ` · from ${s.source.fileName}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <DepthButton size="sm" onClick={() => setView({ kind: 'results', survey: s })}>
                Results
              </DepthButton>
              <DepthButton
                size="sm"
                variant="secondary"
                onClick={() => setView({ kind: 'edit', draft: { title: s.title, description: s.description, questions: s.questions }, survey: s })}
              >
                Edit
              </DepthButton>
              {s.status !== 'open' ? (
                <DepthButton
                  size="sm"
                  variant="secondary"
                  onClick={() => status.mutate({ id: s.id, action: 'publish' })}
                >
                  {s.status === 'closed' ? 'Reopen' : 'Publish'}
                </DepthButton>
              ) : (
                <DepthButton size="sm" variant="secondary" onClick={() => status.mutate({ id: s.id, action: 'close' })}>
                  Close
                </DepthButton>
              )}
              <DepthButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Delete "${s.title}" and its ${s.responses ?? 0} responses?`)) remove.mutate(s.id);
                }}
              >
                Delete
              </DepthButton>
            </div>
          </div>
        </GlassCard>
      ))}
      {surveys.data?.length === 0 && <p className="text-sm text-ink-muted">No surveys yet.</p>}
    </div>
  );
}
