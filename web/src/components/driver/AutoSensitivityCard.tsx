import type { DriverTuning } from '../../api/types';
import { timeAgo } from '../../lib/format';
import { GlassCard } from '../ui/GlassCard';
import { Icon } from '../ui/Icon';

const MODE = {
  learning: {
    title: 'Learning',
    text: 'Guardian Drive is still getting to know how this driver normally looks when awake. Alerts already work with safe default settings.',
    cls: 'bg-accent-primary/25 text-indigo-100',
  },
  standard: {
    title: 'Standard',
    text: "Tuned to this driver's eyes. Alerts use the normal, safe sensitivity.",
    cls: 'bg-emerald-500/20 text-emerald-100',
  },
  reduced: {
    title: 'Fewer false alarms',
    text: 'You marked several alerts as false alarms, so this driver now needs a little more evidence before an alert. It goes back to normal as alerts are confirmed real.',
    cls: 'bg-amber-500/20 text-amber-100',
  },
} as const;

/**
 * Replaces the old threshold sliders: parents don't tune numbers. Sensitivity is learned from the
 * driver's own readings (hourly) and from the parent's "False alarm" / "Real" taps.
 */
export function AutoSensitivityCard({ name, tuning }: { name: string; tuning?: DriverTuning }) {
  const t = tuning ?? { mode: 'learning' as const };
  const m = MODE[t.mode];
  return (
    <GlassCard interactive={false} data-testid="auto-sensitivity">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-white">Alert sensitivity</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${m.cls}`}>Automatic · {m.title}</span>
      </div>
      <p className="text-sm text-ink-muted">{m.text}</p>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-muted">
        <li className="flex gap-2">
          <Icon name="eye" size={16} className="mt-0.5 shrink-0 text-accent-glow" />
          {t.eyeSamples
            ? `Learned from ${t.eyeSamples.toLocaleString()} readings of ${name}'s eyes in the last 7 days.`
            : `Needs a few minutes of driving to learn ${name}'s normal eye openness.`}
        </li>
        {(t.falseAlarms ?? 0) + (t.realAlarms ?? 0) > 0 && (
          <li className="flex gap-2">
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent-glow" />
            Your feedback (last 30 days): {t.realAlarms ?? 0} real, {t.falseAlarms ?? 0} false alarm
            {t.falseAlarms === 1 ? '' : 's'}.
          </li>
        )}
        {t.updatedAt && (
          <li className="flex gap-2">
            <Icon name="refresh" size={16} className="mt-0.5 shrink-0 text-accent-glow" />
            Updated {timeAgo(t.updatedAt)}. It keeps adjusting every hour.
          </li>
        )}
      </ul>
      <p className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-ink-muted">
        Tip: on an alert that wasn't real, tap <strong className="text-white">False alarm</strong>. Guardian Drive
        learns from it right away.
      </p>
    </GlassCard>
  );
}
