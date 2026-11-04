import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { TOUCH_MIN, TOUCH_MIN_H } from './touch';

// Colours fade, but not the outline: the focus ring appears at once in the
// accent colour instead of fading in from the text colour.
const FADE = 'transition-[color,background-color,border-color]';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'frame';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-contrast hover:bg-primary-hover disabled:opacity-60',
  outline: 'border border-border text-text hover:bg-bg-weak disabled:opacity-60',
  ghost: 'text-text hover:bg-bg-weak disabled:opacity-50',
  danger: 'bg-danger text-danger-contrast hover:brightness-110 disabled:opacity-60',
  frame: 'border border-frame-border text-frame-text hover:bg-frame-hover',
};

const SIZES: Record<Size, string> = {
  // Taller on a touch screen inside a TOUCH_AREA (see touch.ts).
  sm: `h-8 ${TOUCH_MIN_H} px-3 text-[0.8125rem] gap-1.5`,
  // Same height as a form field, so the two line up side by side.
  md: 'h-[var(--field-h)] px-4 gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', icon, loading, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap ${FADE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'content' | 'frame';
  size?: number;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'content', size = 36, active, className = '', children, ...rest },
  ref,
) {
  const toneCls =
    tone === 'frame'
      ? `text-frame-text hover:bg-frame-hover ${active ? 'bg-frame-active' : ''}`
      : `text-text-weak hover:bg-bg-weak hover:text-text ${active ? 'bg-bg-strong text-text' : ''}`;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${FADE} ${TOUCH_MIN} ${toneCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
