import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export interface DepthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-accent-glow to-accent-primary text-onaccent border-white/20 hover:shadow-glow',
  secondary: 'bg-glass-light text-white border-glass-border hover:bg-glass-hover hover:shadow-depth-2',
  danger: 'bg-gradient-to-b from-red-400 to-accent-danger text-onaccent border-white/20 hover:shadow-glow-danger',
  ghost: 'bg-transparent text-ink-muted border-transparent shadow-none hover:bg-glass-light hover:text-white',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-6 py-3.5 text-base gap-2',
};

/** shadow-depth-1 at rest, glow on hover for primary, translate-y-px on press. */
export const DepthButton = forwardRef<HTMLButtonElement, DepthButtonProps>(function DepthButton(
  { variant = 'primary', size = 'md', loading = false, icon, block, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        'inline-flex select-none items-center justify-center rounded-xl border font-semibold shadow-depth-1',
        'transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
});
