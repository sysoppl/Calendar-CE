import { useEffect, useId, useRef } from 'react';

type Tone = 'primary' | 'success' | 'danger';

interface ProgressBarProps {
  /** Says what is in progress; shown above the bar. */
  label: string;
  /** How far, from 0 to `max`. Left out while that is not known: the bar then only shows that work goes on. */
  value?: number | null;
  max?: number;
  /** Shown opposite the label and read out in place of the percentage, e.g. "12 of 40". */
  valueText?: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  tone?: Tone;
  className?: string;
}

const TONES: Record<Tone, string> = { primary: 'bg-primary', success: 'bg-success', danger: 'bg-danger' };

export function ProgressBar({ label, value, max = 100, valueText, hideLabel = false, tone = 'primary', className = '' }: ProgressBarProps) {
  const labelId = useId();
  const bar = useRef<HTMLDivElement>(null);
  const known = typeof value === 'number' && Number.isFinite(value) && max > 0;
  const percent = known ? Math.round(Math.min(1, Math.max(0, value / max)) * 100) : 0;

  useEffect(() => {
    const el = bar.current;
    // With reduced motion the bar pulses in place instead (see the classes below).
    if (known || !el?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sweep = el.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(250%)' }], { duration: 1400, iterations: Infinity, easing: 'ease-in-out' });
    return () => sweep.cancel();
  }, [known]);

  return (
    <div className={className}>
      {!hideLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem]">
          <span id={labelId} className="min-w-0 font-semibold">
            {label}
          </span>
          {(valueText !== undefined || known) && <span className="text-text-weak shrink-0 tabular-nums">{valueText ?? `${percent}%`}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-label={hideLabel ? label : undefined}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={known ? percent : undefined}
        aria-valuetext={valueText}
        className="bg-bg-strong h-2 overflow-hidden rounded-full"
      >
        <div
          ref={bar}
          className={`h-full rounded-full ${TONES[tone]} ${known ? 'transition-[width] duration-300 motion-reduce:transition-none' : 'w-2/5 motion-reduce:w-full motion-reduce:animate-pulse'}`}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}
