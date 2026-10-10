import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FloatingInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'> {
  label: string;
  error?: string;
  /** Leading icon (e.g. mail / lock); glows while the field is focused. */
  icon?: ReactNode;
  /** Trailing control inside the field (e.g. show/hide password). */
  trailing?: ReactNode;
}

/** Inset glass input with a label that floats up on focus / when filled. */
export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(function FloatingInput(
  { label, error, id, icon, trailing, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      {/* The bordered box is the container; the trailing control (e.g. show/hide password) sits
          next to the text area instead of on top of it. Overlapping it inside the 3D login card made
          the browser deliver taps to the input underneath. */}
      <div
        className={[
          'flex h-14 items-stretch rounded-xl border bg-black/25 shadow-inner transition-all duration-150',
          'focus-within:bg-black/35 focus-within:shadow-glow',
          error ? 'border-accent-danger/70' : 'border-white/10 focus-within:border-accent-glow/70',
        ].join(' ')}
      >
        <div className="relative min-w-0 flex-1">
          <input
            ref={ref}
            id={inputId}
            placeholder=" "
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-err` : undefined}
            className={[
              'peer h-full w-full rounded-xl bg-transparent pb-2 pt-6 text-white outline-none',
              icon ? 'pl-11' : 'pl-4',
              trailing ? 'pr-2' : 'pr-4',
            ].join(' ')}
            {...rest}
          />
          {icon && (
            <span
              data-testid="input-icon"
              className={[
                'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-all duration-150',
                'peer-focus:scale-110 peer-focus:text-accent-glow peer-focus:drop-shadow-[0_0_6px_rgba(129,140,248,0.8)]',
                error ? 'text-red-300' : 'text-ink-muted',
              ].join(' ')}
            >
              {icon}
            </span>
          )}
          <label
            htmlFor={inputId}
            className={[
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-ink-muted transition-all duration-150',
              icon ? 'left-11' : 'left-4',
              'peer-focus:top-4 peer-focus:text-xs peer-focus:text-accent-glow',
              'peer-[:not(:placeholder-shown)]:top-4 peer-[:not(:placeholder-shown)]:text-xs',
            ].join(' ')}
          >
            {label}
          </label>
        </div>
        {trailing && <div className="flex shrink-0 items-center pr-1.5">{trailing}</div>}
      </div>
      {error && (
        <p id={`${inputId}-err`} className="mt-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
});
