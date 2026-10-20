import { useState } from 'react';

/** Single-series mark colour: validated (OKLCH L inside the dark band, >= 3:1 on the card surface). */
export const SERIES = '#7b84f5';

export interface BarItem {
  label: string;
  value: number;
  /** 0..1, shown next to the count */
  pct?: number;
}

const pctText = (p?: number) => (p === undefined ? '' : ` (${Math.round(p * 100)}%)`);

/**
 * Horizontal bars for survey answers: labels left, value labels at the bar end (count + share),
 * a hover tooltip per bar. The rows themselves are the table view (every number is printed).
 */
export function BarChart({ items, label }: { items: BarItem[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div role="figure" aria-label={label} className="flex flex-col gap-1.5" data-testid="bar-chart">
      {items.map((it, i) => (
        <div
          key={it.label}
          className="group relative grid grid-cols-[minmax(6rem,38%)_1fr] items-center gap-3 rounded-md py-1"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          tabIndex={0}
        >
          <span className="truncate text-sm text-white" title={it.label}>
            {it.label}
          </span>
          <span className="flex items-center gap-2">
            <span className="relative h-3 flex-1 rounded-r bg-white/5">
              <span
                className="absolute inset-y-0 left-0 rounded-r transition-[width] duration-500"
                style={{ width: `${(it.value / max) * 100}%`, background: SERIES, minWidth: it.value ? 3 : 0 }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              <span className="font-semibold text-white">{it.value}</span>
              {pctText(it.pct)}
            </span>
          </span>
          {hover === i && (
            <span
              role="tooltip"
              className="pointer-events-none absolute -top-8 left-1/3 z-10 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1 text-xs text-white shadow-depth-2"
            >
              {it.label}: {it.value} {it.value === 1 ? 'answer' : 'answers'}
              {pctText(it.pct)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Responses per day: thin columns on a baseline, tooltip on hover, first / last day labelled. */
export function ColumnChart({ points, label }: { points: { day: string; count: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const tip = hover === null ? undefined : points[hover];
  const max = Math.max(1, ...points.map((p) => p.count));
  const W = 600;
  const H = 120;
  const pad = 18;
  const slot = (W - pad * 2) / points.length;
  const bw = Math.max(2, Math.min(28, slot - 2)); // 2px surface gap between columns
  return (
    <figure aria-label={label} className="relative" data-testid="column-chart">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label={label}>
        <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="rgba(255,255,255,0.15)" />
        {points.map((p, i) => {
          const h = (p.count / max) * (H - 10);
          const x = pad + i * slot + (slot - bw) / 2;
          return (
            <g key={p.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* bigger invisible hit target */}
              <rect x={pad + i * slot} y={0} width={slot} height={H} fill="transparent" />
              <path
                d={`M${x},${H} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`}
                fill={SERIES}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            </g>
          );
        })}
        <text x={pad} y={H + 16} className="fill-ink-muted" fontSize="12">
          {first.day}
        </text>
        {points.length > 1 && (
          <text x={W - pad} y={H + 16} className="fill-ink-muted" fontSize="12" textAnchor="end">
            {last.day}
          </text>
        )}
      </svg>
      {tip && hover !== null && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1 text-xs text-white shadow-depth-2"
          style={{ left: `${((pad + hover * slot) / W) * 100}%` }}
        >
          {tip.day}: {tip.count} {tip.count === 1 ? 'response' : 'responses'}
        </span>
      )}
    </figure>
  );
}

/** 1-5 stars: display, or input when onChange is given. */
export function Stars({
  value,
  onChange,
  size = 22,
  label = 'Rating',
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role={onChange ? 'radiogroup' : 'img'}
      aria-label={onChange ? label : `${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = shown >= n ? 1 : shown > n - 1 ? shown - (n - 1) : 0;
        const star = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`star-${n}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#fbbf24" />
                <stop offset={`${fill * 100}%`} stopColor="rgba(255,255,255,0.18)" />
              </linearGradient>
            </defs>
            <path
              d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
              fill={`url(#star-${n}-${Math.round(fill * 100)})`}
            />
          </svg>
        );
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(n)}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
    </span>
  );
}
