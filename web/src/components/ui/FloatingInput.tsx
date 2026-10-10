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
      <div className="group relative">
        <input
          ref={ref}
          id={inputId}
          placeholder=" "
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={[
            'peer h-14 w-full rounded-xl border bg-black/25 pb-2 pt-6 text-white shadow-inner outline-none',
            'transition-all duration-150 focus:bg-black/35 focus:shadow-glow',
            icon ? 'pl-11' : 'pl-4',
            trailing ? 'pr-12' : 'pr-4',
            error ? 'border-accent-danger/70' : 'border-white/10 focus:border-accent-glow/70',
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
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {error && (
        <p id={`${inputId}-err`} className="mt-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
});
