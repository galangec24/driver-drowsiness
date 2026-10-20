import { useTheme, type ThemePref } from '../../lib/theme';
import { GlassCard } from './GlassCard';

const SUN =
  'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5 1.5 3h-3zm0 20-1.5-3h3zM2 12l3-1.5v3zm20 0-3 1.5v-3zM4.9 4.9l3.2 1.1-2.1 2.1zm14.2 14.2-3.2-1.1 2.1-2.1zM4.9 19.1l1.1-3.2 2.1 2.1zM19.1 4.9 18 8.1 15.9 6z';
const MOON = 'M12.3 2a9.7 9.7 0 1 0 9.7 11.6A7.6 7.6 0 0 1 12.3 2z';

/** Sun / moon button next to the notifications bell: switches light <-> dark. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setPref } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-testid="theme-toggle"
      className={`glass flex h-11 w-11 items-center justify-center rounded-full text-white shadow-depth-2 transition-transform hover:scale-105 ${className}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d={theme === 'dark' ? SUN : MOON} fill="currentColor" />
      </svg>
    </button>
  );
}

const OPTIONS: { value: ThemePref; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follow this device' },
  { value: 'light', label: 'Light', hint: 'Bright, for daytime' },
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes at night' },
];

/** Settings: System / Light / Dark. */
export function AppearanceCard() {
  const { pref, setPref } = useTheme();
  return (
    <GlassCard interactive={false} data-testid="appearance-card">
      <h2 className="mb-1 text-lg font-bold text-white">Appearance</h2>
      <p className="mb-4 text-sm text-ink-muted">Choose the light or dark theme. Saved on this device.</p>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            onClick={() => setPref(o.value)}
            className={[
              'rounded-xl border p-3 text-left transition-colors',
              pref === o.value
                ? 'border-accent-glow/70 bg-accent-primary/15'
                : 'border-glass-border bg-glass-light hover:bg-glass-hover',
            ].join(' ')}
          >
            <span className="block text-sm font-semibold text-white">{o.label}</span>
            <span className="block text-[11px] text-ink-muted">{o.hint}</span>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
