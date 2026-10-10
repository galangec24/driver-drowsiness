import { useEffect, useState } from 'react';
import type { Thresholds } from '../../api/types';
import { DepthButton } from '../ui/DepthButton';

interface SliderSpec {
  key: keyof Thresholds;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SPECS: SliderSpec[] = [
  { key: 'earThreshold', label: 'Eye-closure (EAR) threshold', help: 'Below this eye aspect ratio counts as closing. Auto-tuned daily.', min: 0.1, max: 0.35, step: 0.005, format: (v) => v.toFixed(3) },
  { key: 'perclosThreshold', label: 'PERCLOS limit', help: 'Share of time eyes are closed that counts as fully drowsy.', min: 0.1, max: 0.9, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'drowsyDurationMs', label: 'Drowsy duration', help: 'How long closure must persist before it matters.', min: 500, max: 6000, step: 100, format: (v) => `${(v / 1000).toFixed(1)} s` },
  { key: 'fusionWeightVision', label: 'Vision weight', help: 'Weight of EAR + PERCLOS in the fused score.', min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'fusionWeightPhysio', label: 'Heart-rate weight', help: 'Weight of the physiological signal.', min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'hrDropThreshold', label: 'Heart-rate drop', help: 'Drop below the driver’s own resting-awake heart rate (from the watch) that counts as fully drowsy.', min: 0.05, max: 0.4, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'breathDropThreshold', label: 'Breathing slow-down', help: 'Drop below the driver’s own breathing rate (dashboard radar) that counts as fully drowsy.', min: 0.05, max: 0.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'yawnThreshold', label: 'Yawn limit', help: 'Yawns within 5 minutes that raise a fatigue warning on their own.', min: 1, max: 10, step: 1, format: (v) => `${v} / 5 min` },
  { key: 'nodThreshold', label: 'Head-nod limit', help: 'Head nods within 5 minutes that count as falling asleep (drowsy).', min: 1, max: 6, step: 1, format: (v) => `${v} / 5 min` },
  { key: 'fusionWeightNod', label: 'Head-nod weight', help: 'Extra weight of a single head nod in the fused score.', min: 0.05, max: 0.6, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'fusionWeightYawn', label: 'Yawn weight', help: 'Extra weight of yawning in the fused score.', min: 0.05, max: 0.5, step: 0.05, format: (v) => v.toFixed(2) },
];

export function ThresholdEditor({
  value,
  onSave,
  saving,
}: {
  value: Thresholds;
  onSave: (patch: Partial<Thresholds>) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<Thresholds>(value);
  useEffect(() => setDraft(value), [value]);

  const changed = (Object.keys(draft) as Array<keyof Thresholds>).filter((k) => draft[k] !== value[k]);
  const weightSum = draft.fusionWeightVision + draft.fusionWeightPhysio;

  return (
    <div className="flex flex-col gap-5">
      {SPECS.map((s) => (
        <label key={s.key} className="block">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-white">{s.label}</span>
            <span className="rounded-lg bg-black/30 px-2 py-0.5 font-mono text-sm text-accent-glow">{s.format(draft[s.key])}</span>
          </div>
          <input
            type="range"
            className="gd-range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={draft[s.key]}
            aria-label={s.label}
            onChange={(e) => setDraft((d) => ({ ...d, [s.key]: Number(e.target.value) }))}
          />
          <p className="mt-1 text-xs text-ink-muted">{s.help}</p>
        </label>
      ))}
      {Math.abs(weightSum - 1) > 0.001 && (
        <p className="text-xs text-amber-300">Weights add up to {weightSum.toFixed(2)} — 1.00 keeps the score on a 0–1 scale.</p>
      )}
      <div className="flex justify-end gap-2">
        <DepthButton variant="ghost" size="sm" disabled={!changed.length} onClick={() => setDraft(value)}>
          Reset
        </DepthButton>
        <DepthButton
          size="sm"
          loading={saving}
          disabled={!changed.length}
          onClick={() => onSave(Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<Thresholds>)}
        >
          Save thresholds
        </DepthButton>
      </div>
    </div>
  );
}
