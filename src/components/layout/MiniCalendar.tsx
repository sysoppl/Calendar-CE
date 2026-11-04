import { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormat } from '@/hooks/useFormat';
import { useOccurrences } from '@/hooks/useCalendarData';
import { isSameDay, weekNumber, type Range } from '@/lib/date';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';

interface Props {
  selected: Date;
  highlight?: Range;
  onSelect: (d: Date) => void;
  /** 'frame' for the sidebar, 'content' inside popovers. */
  tone?: 'frame' | 'content';
  /** Days before this one cannot be picked. */
  min?: Date;
}

export function MiniCalendar({ selected, highlight, onSelect, tone = 'frame', min }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const showWeekNumbers = useSettings((s) => s.showWeekNumbers);
  const fmt = useFormat();
  const t = useT();

  useEffect(() => setMonth(startOfMonth(selected)), [selected]);

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month, weekStartsOn]);

  const range = useMemo(() => ({ start: days[0], end: addDays(days[41], 1) }), [days]);
  const occurrences = useOccurrences(range);
  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const o of occurrences) {
      for (let d = new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate()); d < o.end; d = addDays(d, 1)) {
        set.add(d.toDateString());
        if (set.size > 60) break;
      }
      if (o.end.getTime() === o.start.getTime()) set.add(o.start.toDateString());
    }
    return set;
  }, [occurrences]);

  const today = new Date();
  const earliest = min && startOfDay(min);
  const frame = tone === 'frame';
  const weak = frame ? 'text-frame-weak' : 'text-text-weak';
  const hover = frame ? 'hover:bg-frame-hover' : 'hover:bg-bg-weak';
  const groupHover = frame ? 'group-hover:bg-frame-hover' : 'group-hover:bg-bg-weak';
  const cols = showWeekNumbers ? 'grid-cols-8' : 'grid-cols-7';
  // On a touch screen the arrows are 44 px, the size a fingertip hits reliably.
  const arrow = `flex items-center justify-center rounded-md p-1.5 pointer-coarse:size-11 ${hover}`;

  return (
    <div className="select-none">
      {/* On a touch screen the grid fills its box (see the drawer): the month name keeps its place by itself. */}
      <div className="mb-1 flex items-center justify-between pl-2 pointer-coarse:pl-3">
        <span className="font-semibold capitalize">{fmt.date(month, { month: 'long', year: 'numeric' })}</span>
        <div className="flex">
          <button type="button" aria-label={t('nav.previous')} className={arrow} onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label={t('nav.next')} className={arrow} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className={`grid ${cols} text-center text-[0.6875rem] ${weak}`}>
        {showWeekNumbers && <span className="py-1" />}
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="py-1 font-medium uppercase">
            {fmt.weekdayNarrow(d)}
          </span>
        ))}
      </div>
      {/* On a touch screen each day is pressed anywhere in its cell, 44 px tall; the circle keeps its size. */}
      <div className={`grid ${cols} gap-y-0.5 text-center text-[0.75rem] pointer-coarse:gap-y-0`}>
        {days.map((d, i) => {
          const inMonth = isSameMonth(d, month);
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selected);
          const inRange = highlight && d >= highlight.start && d < highlight.end;
          const rangeStart = inRange && (i % 7 === 0 || !(addDays(d, -1) >= highlight!.start));
          const rangeEnd = inRange && (i % 7 === 6 || !(addDays(d, 1) < highlight!.end));
          const disabled = !!earliest && d < earliest;
          return (
            <div key={d.toISOString()} className="contents">
              {showWeekNumbers && i % 7 === 0 && <span className={`flex items-center justify-center text-[0.625rem] ${weak}`}>{weekNumber(d)}</span>}
              <div className="relative flex justify-center py-px pointer-coarse:py-0">
                {/* The band of the range shown, as tall as the circles also where the rows are taller. */}
                {inRange && (
                  <span
                    aria-hidden
                    className={`absolute inset-x-0 top-1/2 h-[1.875rem] -translate-y-1/2 ${frame ? 'bg-frame-hover' : 'bg-bg-weak'} ${rangeStart ? 'rounded-l-full' : ''} ${rangeEnd ? 'rounded-r-full' : ''}`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onSelect(d)}
                  disabled={disabled}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={fmt.date(d, { dateStyle: 'full' })}
                  className="group relative flex h-7 w-7 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-30 pointer-coarse:h-11 pointer-coarse:w-full pointer-coarse:rounded-lg"
                >
                  <span
                    className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                      isToday ? 'bg-primary text-primary-contrast font-semibold' : isSelected ? `${frame ? 'bg-frame-active' : 'bg-bg-strong'} font-semibold` : groupHover
                    } ${!inMonth && !isToday ? `${weak} ${disabled ? '' : 'opacity-70'}` : ''}`}
                  >
                    {d.getDate()}
                    {busyDays.has(d.toDateString()) && !isToday && (
                      <span className="bg-primary absolute bottom-0.5 h-1 w-1 rounded-full opacity-80" />
                    )}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
