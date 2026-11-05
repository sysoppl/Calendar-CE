import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { calendarColor, readableText } from '@/lib/color';
import { TOUCH_MIN_H } from './touch';

/**
 * A finger-sized hit area (44 × 44 px) around a control that keeps its drawn
 * size, on a touch screen only.
 */
export const SWITCH_HIT =
  'pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2';

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  id,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** The switch's name, when no element names it (`labelledBy`). */
  label?: string;
  disabled?: boolean;
  id?: string;
  labelledBy?: string;
  describedBy?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${SWITCH_HIT} ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        data-knob
        // The knob jumps instead of sliding where motion is reduced.
        className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

/** Checkbox with a label, filled with the accent colour when ticked. */
export function Checkbox({ checked, onChange, children, id, describedBy }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id?: string; describedBy?: string }) {
  return (
    // `relative`: the hidden input stays inside the label. Placed anywhere else, the WebView
    // scrolls the page to it when a tap on the label focuses it (a jump on large screens).
    <label className={`relative flex cursor-pointer items-center gap-2 select-none ${TOUCH_MIN_H}`}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} className="peer sr-only" />
      <span
        className={`peer-focus-visible:outline-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 ${
          checked ? 'bg-primary border-primary text-primary-contrast' : 'border-border bg-bg'
        }`}
      >
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
      {children}
    </label>
  );
}

/** Square checkbox filled with the calendar colour. */
export function ColorCheckbox({
  checked,
  color,
  onChange,
  label,
  round = false,
}: {
  checked: boolean;
  color: string;
  onChange: (v: boolean) => void;
  label: string;
  round?: boolean;
}) {
  const c = calendarColor(color);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 transition-colors ${round ? 'rounded-full' : 'rounded-sm'}`}
      style={{ borderColor: c, background: checked ? c : 'transparent' }}
    >
      {checked && <Check size={12} strokeWidth={3.5} color={readableText(c)} />}
    </button>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[0.8125rem] font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-text-weak mt-1 text-xs">{hint}</p>}
    </div>
  );
}

/** A setting's hint: 13 px, so that it stays readable on a phone. */
const HINT = 'text-text-weak mt-0.5 block text-[0.8125rem] leading-snug';
const ROW = 'border-border-weak border-b last:border-b-0';

interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  /** The control the label names (a field, a select, a switch). */
  htmlFor?: string;
  /** Id of the label's text, for a control named through `aria-labelledby` (a group of buttons, a switch). */
  labelId?: string;
  /** Id of the hint, for the control's `aria-describedby`. */
  hintId?: string;
  /**
   * The control sits at the end of the label's line on a phone too, instead
   * of under it: for switches and other small controls. With `htmlFor`, a tap
   * anywhere on the label or the hint works the control.
   */
  inline?: boolean;
}

/** Settings row: label on the left, control on the right (stacks on phones unless `inline`). */
export function SettingRow({ label, hint, children, htmlFor, labelId, hintId, inline = false }: SettingRowProps) {
  if (inline) {
    const hintText = hint && (
      <span id={hintId} className={HINT}>
        {hint}
      </span>
    );
    const left = 'min-w-0 flex-1 sm:w-[42%] sm:flex-none';
    return (
      <div className={`${ROW} flex min-h-14 items-center gap-4 py-3 sm:gap-6 sm:py-4`}>
        {labelId && htmlFor ? (
          // The control is named by the label's text alone (`aria-labelledby`),
          // so the hint can be part of what a tap on the row's text reaches.
          <label htmlFor={htmlFor} className={`${left} cursor-pointer`}>
            <span id={labelId} className="font-semibold">
              {label}
            </span>
            {hintText}
          </label>
        ) : (
          <div className={left}>
            <label id={labelId} htmlFor={htmlFor} className="font-semibold">
              {label}
            </label>
            {hintText}
          </div>
        )}
        <div className="flex shrink-0 items-center sm:min-w-0 sm:flex-1">{children}</div>
      </div>
    );
  }
  return (
    <div className={`${ROW} flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6 sm:py-4`}>
      <div className="sm:w-[42%]">
        <label id={labelId} htmlFor={htmlFor} className="font-semibold">
          {label}
        </label>
        {hint && (
          <span id={hintId} className={HINT}>
            {hint}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center sm:justify-start">{children}</div>
    </div>
  );
}

/** A setting that is on or off: one row, the switch at its end, worked by a tap anywhere on the row's text. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingRow inline label={label} hint={hint} htmlFor={id} labelId={`${id}-label`} hintId={hint ? `${id}-hint` : undefined}>
      <Toggle id={id} checked={checked} onChange={onChange} disabled={disabled} label={label} labelledBy={`${id}-label`} describedBy={hint ? `${id}-hint` : undefined} />
    </SettingRow>
  );
}

/** Settings that belong together, under a small heading. */
export function SettingGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 first:mt-1">
      <h3 id={id} className="text-text-weak pt-1 text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Form or detail row with a leading icon. `align` says what the icon lines up
 * with: a form field, a small chip, the first line of text, or the middle of
 * the content.
 */
export function IconRow({
  icon,
  label,
  align = 'field',
  children,
}: {
  icon: ReactNode;
  label?: string;
  align?: 'field' | 'chip' | 'text' | 'center';
  children: ReactNode;
}) {
  const offset = { field: 'mt-[calc((var(--field-h)-18px)/2)]', chip: 'mt-[5px]', text: 'mt-px', center: 'self-center' }[align];
  return (
    <div className="flex gap-3">
      <span className={`text-text-weak shrink-0 ${offset}`} title={label} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  /** The option's name when its label is not text (a glyph). */
  name?: string;
}

/**
 * One choice of a few, as a row of buttons. `full` makes the segments share
 * the whole width on a phone, never wrapping a segment onto a line of its own;
 * `phoneColumns: 2` lays four or more of them out two by two there.
 */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  full = false,
  phoneColumns,
  labelledBy,
  label,
  id,
}: {
  value: T | null;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  full?: boolean;
  phoneColumns?: 2;
  /** Id of the text that names the whole choice (the row's label). */
  labelledBy?: string;
  /** The whole choice's name, when no element on screen gives it. */
  label?: string;
  id?: string;
}) {
  const layout = full
    ? `grid w-full auto-cols-fr grid-flow-col sm:inline-grid sm:w-auto ${phoneColumns === 2 ? 'max-sm:grid-flow-row max-sm:grid-cols-2' : ''}`
    : 'inline-flex max-w-full flex-wrap';
  return (
    <div id={id} role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={`bg-bg-weak border-border-weak rounded-lg border p-0.5 ${layout}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          aria-label={o.name}
          title={o.name}
          onClick={() => onChange(o.value)}
          className={`flex min-w-0 items-center justify-center rounded-[calc(var(--radius-lg)-2px)] py-1.5 text-[0.8125rem] font-medium transition-colors ${full ? 'px-2' : 'px-3'} ${TOUCH_MIN_H} ${
            o.value === value ? 'bg-bg text-text shadow-sm' : 'text-text-weak hover:text-text'
          }`}
        >
          {full ? <span className="min-w-0 truncate">{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  );
}
