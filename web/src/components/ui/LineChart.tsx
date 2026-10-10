import { useId } from 'react';

export interface LineChartProps {
  values: number[];
  height?: number;
  color?: string;
  /** Optional horizontal reference line (e.g. the driver's personal EAR threshold). */
  threshold?: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
}

/** Dependency-free SVG area chart with a glow stroke. */
export function LineChart({
  values,
  height = 120,
  color = '#818cf8',
  threshold,
  min,
  max,
  label,
  unit = '',
}: LineChartProps) {
  const gradId = useId();
  const width = 600;
  const pad = 6;
  const clean = values.filter((v) => Number.isFinite(v));
  const lo = min ?? Math.min(...clean, threshold ?? Infinity);
  const hi = max ?? Math.max(...clean, threshold ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / Math.max(1, clean.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = clean.length ? `${line} L${x(clean.length - 1)},${height} L${x(0)},${height} Z` : '';
  const last = clean[clean.length - 1];

  return (
    <figure className="w-full">
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="text-lg font-bold text-white">
          {last === undefined ? '—' : `${Number.isInteger(last) ? last : last.toFixed(3)}${unit}`}
        </span>
      </figcaption>
      {clean.length < 2 ? (
        <div className="glass-inset flex items-center justify-center text-sm text-ink-muted" style={{ height }}>
          Waiting for sensor data…
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="glass-inset w-full"
          style={{ height }}
          role="img"
          aria-label={`${label} trend`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
          {threshold !== undefined && (
            <line
              x1={0}
              x2={width}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke="#ef4444"
              strokeDasharray="6 6"
              strokeOpacity="0.7"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
      )}
    </figure>
  );
}
