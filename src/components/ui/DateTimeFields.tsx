import { useEffect, useMemo, useRef, useState } from 'react';
import { autoUpdate, flip, offset, size, useDismiss, useFloating, useInteractions, FloatingPortal } from '@floating-ui/react';
import { useFormat } from '@/hooks/useFormat';
import { useT } from '@/i18n';
import { isSameDay, minutesOfDay, setMinutesOfDay } from '@/lib/date';
import { parseTime } from '@/lib/eventTimes';
import { MiniCalendar } from '@/components/layout/MiniCalendar';
import { Popover, useCloseOnBack } from './Menu';
import { placedStyle, popIn } from './floating';

/** A date shown as text ("9 Dec 2026"); clicking it opens a month to pick from. */
export function DateField({
  value,
  onChange,
  min,
  label,
  placeholder,
  className = '',
}: {
  value?: Date;
  onChange: (date: Date) => void;
  /** Earlier days cannot be picked. */
  min?: Date;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const fmt = useFormat();
  return (
    <Popover
      trigger={
        <button type="button" aria-label={label} title={label} className={`field truncate text-left ${value ? 'font-medium' : 'text-text-hint'} ${className}`}>
          {value ? fmt.date(value, { day: 'numeric', month: 'short', year: 'numeric' }) : placeholder}
        </button>
      }
    >
      {(close) => (
        // Wider on a touch screen, so that each day's column is a 44 px target.
        <div className="w-[17.5rem] p-3 pointer-coarse:w-[min(21rem,calc(100vw-1rem))]">
          <MiniCalendar
            tone="content"
            selected={value ?? new Date()}
            min={min}
            onSelect={(d) => {
              onChange(d);
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

const STEP = 30;

/**
 * A time that can be typed ("9", "9:30", "930 pm") or picked from a list of
 * half hours. With `from` on the same day (an event's start), the list begins
 * after it and shows how long the event would be.
 */
export function TimeField({
  value,
  onChange,
  from,
  label,
  className = '',
}: {
  value: Date;
  /** Minutes after midnight. */
  onChange: (minutes: number) => void;
  from?: Date;
  label: string;
  className?: string;
}) {
  const fmt = useFormat();
  const t = useT();
  const [open, setOpen] = useState(false);
  // The Android back button closes the list before the form it belongs to.
  useCloseOnBack(open, () => setOpen(false));
  /** Text being typed; null while the field just shows its value. */
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLUListElement | null>(null);
  const current = minutesOfDay(value);
  const base = from && isSameDay(from, value) ? minutesOfDay(from) : undefined;

  const options = useMemo(() => {
    const out: number[] = [];
    for (let m = base === undefined ? 0 : base + STEP; m < 1440; m += STEP) out.push(m);
    return out;
  }, [base]);

  const duration = (minutes: number) =>
    minutes < 60 ? t('time.minutes', { n: minutes }) : t('time.hours', { n: new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: 1 }).format(minutes / 60) });

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip(),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, { minWidth: `${rects.reference.width}px`, maxHeight: `${Math.max(120, Math.min(264, availableHeight))}px` });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
    // Placed by left/top: the pop-in animation owns `transform` (see floating.ts).
    transform: false,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useDismiss(context)]);

  // Opening shows the current time (or the next later option) in the middle.
  useEffect(() => {
    if (!open) return;
    const index = Math.max(
      0,
      options.findIndex((m) => m >= current),
    );
    setActive(options[index] === current ? index : -1);
    requestAnimationFrame(() => list.current?.children[index]?.scrollIntoView({ block: 'center' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (minutes: number) => {
    if (minutes !== current) onChange(minutes);
    setText(null);
    setOpen(false);
  };
  /** Takes over what was typed; anything that is not a time is dropped. */
  const commit = () => {
    const typed = text === null ? undefined : parseTime(text);
    if (typed !== undefined) choose(typed);
    else {
      setText(null);
      setOpen(false);
    }
  };

  return (
    <>
      <input
        ref={refs.setReference}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={label}
        title={label}
        autoComplete="off"
        inputMode="numeric"
        className={`field font-medium tabular-nums ${className}`}
        value={text ?? fmt.time(value)}
        {...getReferenceProps({
          onFocus: (e) => {
            (e.target as HTMLInputElement).select();
            setOpen(true);
          },
          onClick: () => setOpen(true),
          onChange: (e) => {
            setText((e.target as HTMLInputElement).value);
            setActive(-1);
          },
          onBlur: commit,
          onKeyDown: (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!open) return setOpen(true);
              const next = Math.max(0, Math.min(options.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
              setActive(next);
              list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && (text !== null || (open && active >= 0))) {
              // Enter first settles the time; only a second one submits the form.
              e.preventDefault();
              if (open && active >= 0) choose(options[active]);
              else commit();
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setText(null);
              setOpen(false);
            }
          },
        })}
      />
      {open && options.length > 0 && (
        <FloatingPortal>
          <ul
            ref={(el) => {
              list.current = el;
              refs.setFloating(el);
            }}
            role="listbox"
            aria-label={label}
            style={placedStyle(floatingStyles, isPositioned)}
            className={`${popIn(isPositioned)} bg-bg-elevated border-border-weak shadow-elevated text-text z-[60] overflow-y-auto rounded-xl border py-1`}
            {...getFloatingProps()}
          >
            {options.map((m, i) => (
              <li
                key={m}
                role="option"
                aria-selected={m === current}
                // Keeps the focus in the field, so picking does not count as leaving it.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m)}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 whitespace-nowrap tabular-nums ${i === active ? 'bg-bg-weak' : ''} ${m === current ? 'text-primary font-semibold' : ''}`}
              >
                {fmt.time(setMinutesOfDay(value, m))}
                {base !== undefined && <span className="text-text-hint text-xs font-normal">{duration(m - base)}</span>}
              </li>
            ))}
          </ul>
        </FloatingPortal>
      )}
    </>
  );
}
