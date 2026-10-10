import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (t: { title: string; body?: string; tone?: ToastTone; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneClass: Record<ToastTone, string> = {
  info: 'border-accent-glow/40 shadow-glow',
  success: 'border-accent-ok/40',
  warn: 'border-accent-warn/50',
  danger: 'border-accent-danger/60 shadow-glow-danger',
};

const dotClass: Record<ToastTone, string> = {
  info: 'bg-accent-glow',
  success: 'bg-accent-ok',
  warn: 'bg-accent-warn',
  danger: 'bg-accent-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    ({ title, body, tone = 'info', durationMs = 5000 }) => {
      const id = nextId.current++;
      setItems((list) => [{ id, title, body, tone }, ...list].slice(0, 4));
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.button
              key={t.id}
              type="button"
              layout
              initial={{ opacity: 0, x: 40, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.25 }}
              onClick={() => dismiss(t.id)}
              className={`glass pointer-events-auto w-full max-w-sm bg-ink-900/80 px-4 py-3 text-left ${toneClass[t.tone]}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass[t.tone]}`} />
                <div className="min-w-0">
                  <p className="font-semibold text-white">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-sm text-ink-muted">{t.body}</p>}
                </div>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
