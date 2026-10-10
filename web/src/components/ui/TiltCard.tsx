import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';

export interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Maximum rotation in degrees at the card edge. */
  maxTilt?: number;
}

/**
 * 3D card that leans toward the pointer (spring-smoothed), with a moving glare highlight.
 * Children placed in <TiltLayer depth={n}> float n px above the surface (parallax).
 * Falls back to a flat card for prefers-reduced-motion.
 */
export function TiltCard({ children, className = '', maxTilt = 10 }: TiltCardProps) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 180, damping: 18, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [maxTilt, -maxTilt]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-maxTilt, maxTilt]), spring);
  const glareX = useTransform(px, [0, 1], ['0%', '100%']);
  const glareY = useTransform(py, [0, 1], ['0%', '100%']);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.18), transparent 55%)`;

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  }

  function reset() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <div style={{ perspective: 1200 }} className={className} data-testid="tilt-card">
      <motion.div
        onPointerMove={onMove}
        onPointerLeave={reset}
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        initial={{ opacity: 0, y: 24, rotateX: reduce ? 0 : 14 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        className="relative"
      >
        {children}
        {!reduce && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{ background: glare, transform: 'translateZ(1px)' }}
          />
        )}
      </motion.div>
    </div>
  );
}

/** A child of TiltCard lifted `depth` px toward the viewer. */
export function TiltLayer({ depth = 30, children, className = '' }: { depth?: number; children: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ transform: `translateZ(${depth}px)`, transformStyle: 'preserve-3d' }}>
      {children}
    </div>
  );
}
