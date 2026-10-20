import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyRating, getRatingSummary, rateApp, removeMyRating, type RatingSummary } from '../../api/ratings';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../ui/GlassCard';
import { DepthButton } from '../ui/DepthButton';
import { useToast } from '../ui/Toast';
import { BarChart, Stars } from '../charts/Charts';
import { timeAgo } from '../../lib/format';

/** Everyone sees the average and recent reviews; rating is optional and can be changed or removed. */
export function RatingSummaryView({ summary }: { summary: RatingSummary }) {
  return (
    <div className="grid gap-5 md:grid-cols-[auto_1fr]" data-testid="rating-summary">
      <div className="flex flex-col items-start gap-1">
        <span className="text-4xl font-bold text-white">
          {summary.average !== null ? summary.average.toFixed(1) : '-'}
        </span>
        <Stars value={summary.average ?? 0} size={18} />
        <span className="text-xs text-ink-muted">
          {summary.count} {summary.count === 1 ? 'rating' : 'ratings'}
        </span>
      </div>
      <BarChart
        label="Ratings by number of stars"
        items={[5, 4, 3, 2, 1].map((n) => ({
          label: `${n} star${n > 1 ? 's' : ''}`,
          value: summary.distribution[String(n) as '1'],
          pct: summary.count ? summary.distribution[String(n) as '1'] / summary.count : 0,
        }))}
      />
      {summary.recent.length > 0 && (
        <ul className="flex flex-col gap-3 md:col-span-2">
          {summary.recent.map((r) => (
            <li key={r.id} className="glass-inset p-3">
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <Stars value={r.stars} size={14} />
                <span className="font-semibold text-white">{r.author}</span>
                <span className="ml-auto">{timeAgo(r.updatedAt)}</span>
              </div>
              <p className="mt-1 text-sm text-white/90">{r.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RateAppCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const summary = useQuery({ queryKey: ['ratings', 'summary'], queryFn: getRatingSummary });
  const mine = useQuery({ queryKey: ['ratings', 'mine'], queryFn: getMyRating });
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (mine.data) {
      setStars(mine.data.stars);
      setComment(mine.data.comment);
    }
  }, [mine.data]);

  const save = useMutation({
    mutationFn: rateApp,
    onSuccess: (r) => {
      qc.setQueryData(['ratings', 'summary'], r.summary);
      qc.setQueryData(['ratings', 'mine'], r.rating);
      toast.show({ title: 'Thank you for rating Guardian Drive', tone: 'success' });
    },
    onError: (e) => toast.show({ title: 'Could not save your rating', body: errorMessage(e), tone: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: removeMyRating,
    onSuccess: (s) => {
      qc.setQueryData(['ratings', 'summary'], s);
      qc.setQueryData(['ratings', 'mine'], null);
      setStars(0);
      setComment('');
      toast.show({ title: 'Your rating was removed', tone: 'info' });
    },
  });

  return (
    <GlassCard interactive={false} data-testid="rate-app-card">
      <h2 className="mb-1 text-lg font-bold text-white">Rate Guardian Drive</h2>
      <p className="mb-4 text-sm text-ink-muted">
        Optional. Your rating and comment are shown to other users with your first name only.
      </p>
      {summary.data && <RatingSummaryView summary={summary.data} />}

      <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4">
        <span className="label">{mine.data ? 'Your rating' : 'Add your rating'}</span>
        <Stars value={stars} onChange={setStars} size={30} label="Your rating" />
        <textarea
          className="min-h-[72px] rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none focus:border-accent-glow/70"
          placeholder="Tell others what you think (optional)"
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-label="Comment"
        />
        <div className="flex flex-wrap gap-2">
          <DepthButton
            disabled={!stars}
            loading={save.isPending}
            onClick={() => save.mutate({ stars, comment: comment.trim() })}
          >
            {mine.data ? 'Update rating' : 'Submit rating'}
          </DepthButton>
          {mine.data && (
            <DepthButton variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove my rating
            </DepthButton>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
