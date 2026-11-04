import { useLayoutEffect, useMemo, useRef } from 'react';
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, isSameMonth, startOfWeek, startOfYear } from 'date-fns';
import { useCalendarMap, useOccurrences } from '@/hooks/useCalendarData';
import { useFormat } from '@/hooks/useFormat';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePeriodTransition } from '@/hooks/usePeriodTransition';
import { isSameDay } from '@/lib/date';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { eventColor } from '@/lib/color';

export function YearView() {
  const fmt = useFormat();
  const date = useUi((s) => s.date);
  const goTo = useUi((s) => s.goTo);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const phone = useIsMobile();
  const year = startOfYear(date);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement>(null);
  // Another year fades in.
  usePeriodTransition([grid], year.getTime(), 'fade');
  // This year opens at this month on a phone, not at January: there a year is several screens tall.
  useLayoutEffect(() => {
    const el = current.current;
    const box = scroller.current;
    if (!phone || !el || !box) return;
    // The scroller is the section's offset parent (it is positioned).
    box.scrollTop = Math.max(0, el.offsetTop - 8);
  }, [year.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const range = useMemo(() => ({ start: year, end: addMonths(year, 12) }), [year.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const occurrences = useOccurrences(range);
  const calendars = useCalendarMap();

  /** Colours of events per day (max 3 dots). */
  const dayColors = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of occurrences) {
      const color = eventColor(o.color, calendars.get(o.calendarId)?.color);
      let d = new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate());
      let guard = 0;
      do {
        const k = d.toDateString();
        const list = map.get(k) ?? [];
        if (list.length < 3 && !list.includes(color)) list.push(color);
        map.set(k, list);
        d = addDays(d, 1);
      } while (d < o.end && guard++ < 62);
    }
    return map;
  }, [occurrences, calendars]);

  const today = new Date();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(year, i));

  return (
    // On a phone two months side by side, and room at the bottom to scroll December out from under the new-event button.
    <div ref={scroller} className="relative h-full overflow-y-auto p-3 pb-20 sm:p-6">
      <div ref={grid} data-year-grid className={`grid ${phone ? 'grid-cols-2 gap-x-4 gap-y-5' : 'grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
        {months.map((m) => {
          const start = startOfWeek(m, { weekStartsOn });
          const weeks = Math.ceil((differenceInCalendarDays(endOfMonth(m), start) + 1) / 7);
          const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
          const thisMonth = isSameMonth(m, today);
          return (
            <section key={m.getMonth()} ref={thisMonth ? current : undefined} data-month={m.getMonth()} className="min-w-0 select-none">
              <button
                type="button"
                onClick={() => goTo(m, 'month')}
                className={`hover:text-primary pl-1 font-semibold capitalize ${phone ? 'w-full text-left text-sm pointer-coarse:min-h-11' : 'mb-2 text-[0.9375rem]'} ${thisMonth ? 'text-primary' : ''}`}
              >
                {fmt.monthLong(m)}
              </button>
              <div className="text-text-hint grid grid-cols-7 text-center text-[0.625rem] font-semibold uppercase">
                {days.slice(0, 7).map((d) => (
                  <span key={d.getDay()} className="py-1">
                    {fmt.weekdayNarrow(d)}
                  </span>
                ))}
              </div>
              <div className={`grid grid-cols-7 text-center ${phone ? 'text-[0.6875rem]' : 'text-[0.75rem]'}`}>
                {days.map((d) => {
                  const inMonth = isSameMonth(d, m);
                  const colors = inMonth ? dayColors.get(d.toDateString()) : undefined;
                  const isToday = isSameDay(d, today);
                  return (
                    <button
                      type="button"
                      key={d.toISOString()}
                      disabled={!inMonth}
                      onClick={() => goTo(d, 'day')}
                      className={`relative mx-auto flex flex-col items-center justify-center rounded-full transition-colors ${phone ? 'h-[1.375rem] w-[1.375rem]' : 'h-8 w-8'} ${
                        !inMonth ? 'invisible' : isToday ? 'bg-primary text-primary-contrast font-semibold' : 'hover:bg-bg-weak'
                      }`}
                    >
                      {d.getDate()}
                      {colors && !isToday && (
                        <span className={`absolute flex gap-px ${phone ? '-bottom-px' : 'bottom-0.5'}`}>
                          {colors.map((c) => (
                            <span key={c} className="h-1 w-1 rounded-full" style={{ background: c }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
