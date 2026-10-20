import { useQuery } from '@tanstack/react-query';
import { adminRatings } from '../../api/ratings';
import { GlassCard } from '../../components/ui/GlassCard';
import { Stars } from '../../components/charts/Charts';
import { RatingSummaryView } from '../../components/settings/RateAppCard';
import { formatTime } from '../../lib/format';

/** Admins: the same public summary, plus every rating with the person's full name and e-mail. */
export function RatingsTab() {
  const q = useQuery({ queryKey: ['admin', 'ratings'], queryFn: adminRatings, refetchInterval: 30000 });
  return (
    <div className="flex flex-col gap-4" data-testid="ratings-tab">
      <GlassCard interactive={false}>
        <h2 className="mb-4 text-lg font-bold text-white">App rating</h2>
        {q.data && <RatingSummaryView summary={q.data.summary} />}
      </GlassCard>
      <GlassCard interactive={false} className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-ink-muted">
            <tr>
              <th className="py-2">Stars</th>
              <th>Comment</th>
              <th>User</th>
              <th>Platform</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.ratings ?? []).map((r) => (
              <tr key={r.id} className="border-t border-white/10 align-top text-white/90">
                <td className="py-2">
                  <Stars value={r.stars} size={14} />
                </td>
                <td className="max-w-xs pr-3">{r.comment || <span className="text-ink-muted">-</span>}</td>
                <td>
                  {r.userName}
                  <div className="text-xs text-ink-muted">{r.userEmail}</div>
                </td>
                <td className="text-xs">
                  {r.platform}
                  {r.appVersion ? ` ${r.appVersion}` : ''}
                </td>
                <td className="text-xs text-ink-muted">{formatTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.ratings.length === 0 && <p className="py-4 text-sm text-ink-muted">No ratings yet.</p>}
      </GlassCard>
    </div>
  );
}
