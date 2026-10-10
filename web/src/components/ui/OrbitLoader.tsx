/**
 * 3D loader: three glowing rings orbiting on different axes around the shield logo.
 * Pure CSS 3D (see .orbit-* in styles/index.css); honours prefers-reduced-motion.
 */
export function OrbitLoader({ size = 96, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4" data-testid="orbit-loader">
      <div className="orbit-stage" style={{ width: size, height: size }}>
        <span className="orbit-ring orbit-ring-1" />
        <span className="orbit-ring orbit-ring-2" />
        <span className="orbit-ring orbit-ring-3" />
        <img src="/icons/icon.svg" alt="" className="orbit-core" style={{ width: size * 0.38, height: size * 0.38 }} />
      </div>
      {label && <p className="animate-pulse text-sm font-semibold tracking-wide text-indigo-100">{label}</p>}
    </div>
  );
}
