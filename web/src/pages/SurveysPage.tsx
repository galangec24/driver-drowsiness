import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { answerSurvey, openSurveys, type AnswerValue, type Survey } from '../api/surveys';
import { errorMessage } from '../api/client';
import { GlassCard } from '../components/ui/GlassCard';
import { DepthButton } from '../components/ui/DepthButton';
import { OrbitLoader } from '../components/ui/OrbitLoader';
import { useToast } from '../components/ui/Toast';
import { Stars } from '../components/charts/Charts';

function SurveyForm({ survey, onDone }: { survey: Survey; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const set = (qid: string, v: AnswerValue) => setValues((prev) => ({ ...prev, [qid]: v }));
  const send = useMutation({
    mutationFn: () =>
      answerSurvey(
        survey.id,
        Object.entries(values).map(([qid, value]) => ({ qid, value })),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['surveys', 'open'] });
      toast.show({ title: 'Thank you for answering', tone: 'success' });
      onDone();
    },
    onError: (e) => toast.show({ title: 'Could not send your answers', body: errorMessage(e), tone: 'danger' }),
  });
  const missing = survey.questions.filter((q) => {
    const v = values[q.qid];
    return q.required && (v === undefined || v === '' || (Array.isArray(v) && !v.length));
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      {survey.description && <p className="text-sm text-ink-muted">{survey.description}</p>}
      {survey.questions.map((q, i) => (
        <fieldset key={q.qid} className="glass-inset flex flex-col gap-2 p-4">
          <legend className="sr-only">{q.text}</legend>
          <p className="font-semibold text-white">
            {i + 1}. {q.text}
            {q.required && <span className="ml-1 text-red-300">*</span>}
          </p>
          {(q.type === 'single' || q.type === 'yesno') &&
            q.options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-white">
                <input
                  type="radio"
                  name={q.qid}
                  checked={values[q.qid] === o}
                  onChange={() => set(q.qid, o)}
                  className="accent-indigo-400"
                />
                {o}
              </label>
            ))}
          {q.type === 'multiple' &&
            q.options.map((o) => {
              const cur = (values[q.qid] as string[] | undefined) ?? [];
              return (
                <label key={o} className="flex items-center gap-2 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={cur.includes(o)}
                    onChange={(e) => set(q.qid, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))}
                    className="accent-indigo-400"
                  />
                  {o}
                </label>
              );
            })}
          {q.type === 'rating' && (
            <Stars value={Number(values[q.qid] ?? 0)} onChange={(n) => set(q.qid, n)} size={28} label={q.text} />
          )}
          {q.type === 'text' && (
            <textarea
              className="min-h-[72px] rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none focus:border-accent-glow/70"
              maxLength={2000}
              value={(values[q.qid] as string) ?? ''}
              onChange={(e) => set(q.qid, e.target.value)}
              aria-label={q.text}
            />
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <DepthButton type="submit" loading={send.isPending} disabled={missing.length > 0}>
          Send answers
        </DepthButton>
        {missing.length > 0 && (
          <span className="text-xs text-ink-muted">
            {missing.length} required {missing.length === 1 ? 'question' : 'questions'} left (*)
          </span>
        )}
      </div>
    </form>
  );
}

export function SurveysPage() {
  const surveys = useQuery({ queryKey: ['surveys', 'open'], queryFn: openSurveys });
  const [openId, setOpenId] = useState<string | null>(null);
  const list = surveys.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">Surveys</h1>
        <p className="text-sm text-ink-muted">
          Help the Guardian Drive team improve the app. Each survey takes a few minutes.
        </p>
      </header>
      {surveys.isLoading ? (
        <div className="flex justify-center py-16">
          <OrbitLoader size={72} />
        </div>
      ) : list.length === 0 ? (
        <GlassCard interactive={false} className="text-sm text-ink-muted">
          There are no surveys right now. Thank you for checking!
        </GlassCard>
      ) : (
        list.map((s) => (
          <GlassCard key={s.id} interactive={false} data-testid="survey-card">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white">{s.title}</h2>
                <p className="text-xs text-ink-muted">{s.questions.length} questions</p>
              </div>
              {s.answered ? (
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                  Answered, thank you
                </span>
              ) : (
                openId !== s.id && <DepthButton onClick={() => setOpenId(s.id)}>Answer</DepthButton>
              )}
            </div>
            {openId === s.id && !s.answered && (
              <div className="mt-4">
                <SurveyForm survey={s} onDone={() => setOpenId(null)} />
              </div>
            )}
          </GlassCard>
        ))
      )}
    </div>
  );
}
