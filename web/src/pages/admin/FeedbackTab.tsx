import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  adminFeedback,
  updateFeedback,
  type Feedback,
  type FeedbackStatus,
} from '../../api/feedback';
import { errorMessage } from '../../api/client';
import { formatSize } from '../../lib/attachments';
import { formatTime, timeAgo } from '../../lib/format';
import { fileUrl } from '../FeedbackPage';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { useToast } from '../../components/ui/Toast';
import { Badge } from './shared';

const FILTERS: (FeedbackStatus | 'all')[] = ['all', 'new', 'in_progress', 'resolved'];
const TONE = { new: 'warn', in_progress: 'info', resolved: 'ok' } as const;

function Item({ f }: { f: Feedback }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState(f.adminReply ?? '');
  const save = useMutation({
    mutationFn: (patch: { status?: FeedbackStatus; reply?: string }) => updateFeedback(f.id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'feedback'] });
      toast.show({ title: 'Saved', body: 'The user sees it in their Feedback page.', tone: 'success' });
    },
    onError: (err) => toast.show({ title: 'Could not save', body: errorMessage(err), tone: 'danger' }),
  });

  return (
    <GlassCard interactive={false} className="flex flex-col gap-3" data-testid={`feedback-${f.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
        <span className="font-semibold text-white">{CATEGORY_LABEL[f.category]}</span>
        <span className="text-sm text-ink-muted">
          {f.userName} · {f.userEmail}
        </span>
        <span className="ml-auto text-xs text-ink-muted" title={formatTime(f.createdAt)}>
          {timeAgo(f.createdAt)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-100">{f.message}</p>
      <p className="text-xs text-ink-muted">
        {[f.context.platform, f.context.appVersion && `v${f.context.appVersion}`, f.context.page]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {f.attachments.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {f.attachments.map((a) =>
            a.mime.startsWith('image/') ? (
              <a key={a.url} href={fileUrl(a.url)} target="_blank" rel="noopener noreferrer" title={a.name}>
                <img
                  src={fileUrl(a.url)}
                  alt={a.name}
                  className="h-24 w-36 rounded-lg border border-white/10 object-cover hover:border-accent-glow"
                />
              </a>
            ) : (
              <a
                key={a.url}
                href={fileUrl(a.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-24 w-36 flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-black/25 p-2 text-center text-xs text-white hover:border-accent-glow"
              >
                <span className="font-semibold">{a.mime === 'application/pdf' ? 'PDF' : 'TEXT'}</span>
                <span className="line-clamp-2 break-all text-ink-muted">{a.name}</span>
                <span className="text-ink-muted">{formatSize(a.size)}</span>
              </a>
            ),
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="label">Reply to the user</span>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          maxLength={4000}
          className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-sm text-white outline-none focus:border-accent-glow/70"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <DepthButton
          size="sm"
          loading={save.isPending}
          disabled={reply.trim() === (f.adminReply ?? '').trim()}
          onClick={() => save.mutate({ reply: reply.trim() })}
        >
          Send reply
        </DepthButton>
        {f.status !== 'in_progress' && (
          <DepthButton size="sm" variant="secondary" onClick={() => save.mutate({ status: 'in_progress' })}>
            Mark in progress
          </DepthButton>
        )}
        {f.status !== 'resolved' && (
          <DepthButton size="sm" variant="secondary" onClick={() => save.mutate({ status: 'resolved' })}>
            Mark resolved
          </DepthButton>
        )}
      </div>
    </GlassCard>
  );
}

/** Everything users sent from Settings → Feedback, with their screenshots and files. */
export function FeedbackTab() {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('all');
  const q = useQuery({
    queryKey: ['admin', 'feedback', filter],
    queryFn: () => adminFeedback(filter === 'all' ? undefined : filter),
    refetchInterval: 30000,
  });
  const counts = q.data?.counts;

  return (
    <div className="flex flex-col gap-4" data-testid="admin-feedback">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter feedback">
        {FILTERS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
              filter === s ? 'border-accent-glow/60 bg-accent-primary/30 text-white' : 'border-white/10 text-ink-muted'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s]}
            {counts && s !== 'all' ? ` (${counts[s]})` : ''}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <OrbitLoader size={72} />
        </div>
      ) : q.data && q.data.feedback.length > 0 ? (
        q.data.feedback.map((f) => <Item key={f.id} f={f} />)
      ) : (
        <p className="text-sm text-ink-muted">No feedback here yet.</p>
      )}
    </div>
  );
}
