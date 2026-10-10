import { useEffect } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';

interface Shape {
  className: string;
  /** Parallax strength: farther shapes (small depth) move less. */
  depth: number;
  top: string;
  left: string;
  float: number;
}

const SHAPES: Shape[] = [
  { className: 'shape-orb h-48 w-48 from-indigo-400/50 to-indigo-700/10', depth: 18, top: '8%', left: '6%', float: 7 },
  { className: 'shape-orb h-28 w-28 from-emerald-300/40 to-emerald-700/5', depth: 34, top: '70%', left: '12%', float: 9 },
  { className: 'shape-ring h-40 w-40', depth: 26, top: '14%', left: '78%', float: 8 },
  { className: 'shape-cube h-16 w-16', depth: 48, top: '62%', left: '82%', float: 6 },
  { className: 'shape-orb h-20 w-20 from-rose-300/40 to-rose-700/5', depth: 40, top: '40%', left: '48%', float: 10 },
  { className: 'shape-cube h-10 w-10', depth: 60, top: '22%', left: '36%', float: 5 },
];

function Floating({ shape, mx, my, index }: { shape: Shape; mx: MotionValue<number>; my: MotionValue<number>; index: number }) {
  const x = useTransform(mx, (v) => v * shape.depth);
  const y = useTransform(my, (v) => v * shape.depth);
  return (
    <motion.div className="absolute" style={{ top: shape.top, left: shape.left, x, y }}>
      <motion.div
        className={shape.className}
        animate={{ y: [0, -14, 0], rotateZ: [0, index % 2 ? 8 : -8, 0] }}
        transition={{ duration: shape.float, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

/** Background of floating 3D shapes that drift against the pointer (depth parallax). */
export function ParallaxScene() {
  const reduce = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 50, damping: 20 });
  const my = useSpring(rawY, { stiffness: 50, damping: 20 });

  useEffect(() => {
    if (reduce) return undefined;
    const onMove = (e: PointerEvent) => {
      rawX.set(-(e.clientX / window.innerWidth - 0.5) * 2);
      rawY.set(-(e.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduce, rawX, rawY]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden" data-testid="parallax-scene">
      {SHAPES.map((s, i) => (
        <Floating key={i} shape={s} mx={mx} my={my} index={i} />
      ))}
    </div>
  );
}
