import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from 'date-fns';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCalendarMap, useOccurrences, useTasks } from '@/hooks/useCalendarData';
import { useFormat } from '@/hooks/useFormat';
import { useNow } from '@/hooks/useNow';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePeriodTransition } from '@/hooks/usePeriodTransition';
import { claimSwipe } from '@/hooks/useSwipePager';
import { isSameDay, minutesOfDay, roundToStep, setMinutesOfDay, wallMinutes, weekNumber } from '@/lib/date';
import { layoutSpans, layoutTimed } from '@/lib/layout';
import { moveOccurrence, openEditTask, toggleTask } from '@/lib/actions';
import { taskItemKey, tasksInRange } from '@/lib/ical/tasks';
import type { Occurrence, Task } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { zonedParts } from '@/lib/ical/timezone';
import { BarChip, TaskChip, TimedChipContent } from './EventChip';
import { DEFAULT_TASK_COLOR, eventColor } from '@/lib/color';
import { titleWithYears } from '@/lib/milestone';

type Item = { kind: 'event'; occ: Occurrence } | { kind: 'task'; task: Task };

const SNAP = 15;
const DRAG_THRESHOLD = 4;
const ALL_DAY_LANE = 24;
const MAX_ALL_DAY_LANES = 3;
/** A finger held this long on an event, without moving, picks it up to move it. */
export const LONG_PRESS_MS = 450;
/** A finger that moves further than this before then is scrolling or swiping instead. */
export const TOUCH_SLOP = 8;
/** A press that moved further than this is not a tap. */
const TAP_SLOP = 10;

type Drag =
  | { kind: 'create'; day: number; anchorMin: number; curMin: number; curDay: number }
  | { kind: 'move'; occ: Occurrence; grabOffsetMin: number; day: number; min: number; duration: number }
  | { kind: 'resize'; occ: Occurrence; endMin: number; day: number };

interface Pending {
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  target: { kind: 'empty'; day: number; min: number } | { kind: 'event'; occ: Occurrence; el: HTMLElement; resize: boolean; day: number; min: number };
}

type Laid = { item: Item; start: Date; end: Date };

/** The days `days` cover, from the start of the first to the end of the last. */
function rangeOfDays(days: Date[]) {
  return { start: startOfDay(days[0]), end: addDays(startOfDay(days[days.length - 1]), 1) };
}

/** The all-day items of `days` laid out in lanes, and the timed ones of each day side by side. */
function layoutDays(occurrences: Occurrence[], tasks: Task[], days: Date[], showTasks: boolean, showCompleted: boolean) {
  const range = rangeOfDays(days);
  const allDay: Laid[] = [];
  const timed: Laid[] = [];
  for (const occ of occurrences) {
    const long = occ.end.getTime() - occ.start.getTime() >= 24 * 3600000;
    if (occ.allDay || long) allDay.push({ item: { kind: 'event', occ }, start: occ.start, end: occ.end });
    else timed.push({ item: { kind: 'event', occ }, start: occ.start, end: occ.end });
  }
  if (showTasks) {
    for (const task of tasksInRange(tasks, range.start, range.end, showCompleted)) {
      const due = task.due!;
      if (task.dueAllDay) allDay.push({ item: { kind: 'task', task }, start: due, end: addDays(due, 1) });
      else timed.push({ item: { kind: 'task', task }, start: due, end: addMinutes(due, 30) });
    }
  }
  const byDay = days.map((day) => {
    // Wall-clock positions: a day is 23 or 25 hours long when clocks change.
    const dayStart = startOfDay(day).getTime();
    const dayEnd = startOfDay(addDays(day, 1)).getTime();
    return layoutTimed(
      timed
        .filter((x) => x.start.getTime() < dayEnd && x.end.getTime() > dayStart)
        .map((x) => ({ item: x.item, start: wallMinutes(x.start, day), end: wallMinutes(x.end, day) })),
    );
  });
  return { allDayItems: layoutSpans(allDay, days[0], days.length), timedByDay: byDay };
}

/** Where an all-day item sits in a strip of `n` days. */
function allDayBox(b: { startCol: number; span: number; lane: number }, n: number) {
  return { left: `calc(${(b.startCol / n) * 100}% + 2px)`, width: `calc(${(b.span / n) * 100}% - 5px)`, top: 4 + b.lane * ALL_DAY_LANE, height: ALL_DAY_LANE - 3 };
}

/** Where a timed item sits in its day's column. */
function timedBox(box: { top: number; bottom: number; col: number; cols: number; span: number }, pxPerMin: number) {
  const height = Math.max(18, (box.bottom - box.top) * pxPerMin - 2);
  const leftPct = (box.col / box.cols) * 100;
  const widthPct = (box.span / box.cols) * 100;
  return { top: box.top * pxPerMin + 1, height, left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - ${box.col + box.span === box.cols ? 6 : 2}px)` };
}

/** Days drawn beside the ones on screen during a swipe sit one width off them, to the left (-1) or the right (1). */
function peerSide(side: -1 | 1): string {
  return `absolute inset-y-0 w-full ${side === -1 ? 'right-full' : 'left-full'}`;
}

/** A day's name and number above its column. */
function DayHead({ day, today, fmt }: { day: Date; today: boolean; fmt: ReturnType<typeof useFormat> }) {
  return (
    <>
      <span className={`text-[0.6875rem] font-semibold tracking-wide uppercase ${today ? 'text-primary' : 'text-text-weak'}`}>{fmt.weekdayShort(day)}</span>
      <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg leading-none font-semibold ${today ? 'bg-primary text-primary-contrast' : ''}`}>{day.getDate()}</span>
    </>
  );
}

/** The line across today at the time it is now, `top` px down the day. */
function NowLine({ top }: { top: number }) {
  return (
    <div className="pointer-events-none absolute right-0 left-0 z-[4]" style={{ top }}>
      <div className="bg-now relative h-[2px]">
        <span className="bg-now absolute -top-[5px] -left-[6px] h-3 w-3 rounded-full" />
      </div>
    </div>
  );
}

/**
 * The hours of `days`. While a finger swipes them sideways, `peers` are the
 * days before and after (see hooks/useSwipePager.ts): their headers, all-day
 * items and events are drawn beside these, in each of the three parts that
 * follow the finger, so the days the swipe goes to are already there as it
 * pulls them in. They cannot be touched or focused and are drawn for the
 * swipe only.
 */
export function TimeGridView({ days, peers = null }: { days: Date[]; peers?: { before: Date[]; after: Date[] } | null }) {
  const t = useT();
  const fmt = useFormat();
  const now = useNow();
  const settings = useSettings();
  const calendars = useCalendarMap();
  const { openPopover, openQuickCreate, goTo, popover, quickCreate } = useUi();
  const phone = useIsMobile();
  const hourHeight = settings.density === 'compact' ? 40 : 56; // matches --hour-height
  const pxPerMin = hourHeight / 60;

  const range = useMemo(() => rangeOfDays(days), [days]);
  const occurrences = useOccurrences(range);
  const allTasks = useTasks();

  const { allDayItems, timedByDay } = useMemo(
    () => layoutDays(occurrences, allTasks, days, settings.showTasksInCalendar, settings.showCompletedTasks),
    [occurrences, allTasks, days, settings.showTasksInCalendar, settings.showCompletedTasks],
  );

  // The days beside these during a swipe; without `peers` nothing is read for them.
  const beforeOccurrences = useOccurrences(peers ? rangeOfDays(peers.before) : null);
  const afterOccurrences = useOccurrences(peers ? rangeOfDays(peers.after) : null);
  const peerLayouts = useMemo(() => {
    if (!peers) return null;
    const lay = (side: -1 | 1, peerDays: Date[], occs: Occurrence[]) => ({ side, days: peerDays, ...layoutDays(occs, allTasks, peerDays, settings.showTasksInCalendar, settings.showCompletedTasks) });
    return [lay(-1, peers.before, beforeOccurrences), lay(1, peers.after, afterOccurrences)];
  }, [peers, beforeOccurrences, afterOccurrences, allTasks, settings.showTasksInCalendar, settings.showCompletedTasks]);

  const [allDayExpanded, setAllDayExpanded] = useState(false);
  /** Day columns being selected in the all-day strip (drag to span several days). */
  const [stripSel, setStripSel] = useState<{ from: number; to: number } | null>(null);
  const laneCount = allDayItems.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const visibleLanes = allDayExpanded ? laneCount : Math.min(laneCount, MAX_ALL_DAY_LANES);
  const hiddenPerDay = days.map((_, i) => allDayItems.filter((b) => b.lane >= visibleLanes && b.startCol <= i && b.startCol + b.span > i).length);
  const hasHidden = hiddenPerDay.some((n) => n > 0);
  const allDayHeight = Math.max(1, visibleLanes + (hasHidden && !allDayExpanded ? 1 : 0)) * ALL_DAY_LANE + 8;

  // ---------------------------------------------------------------------------
  // Scrolling

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // The days, the all-day strip and the grid slide in together; the hour gutter stays.
  usePeriodTransition([headRef, stripRef, columnsRef], days[0].getTime());
  const initialScrollDone = useRef(false);
  useLayoutEffect(() => {
    if (!scrollRef.current || initialScrollDone.current) return;
    const todayVisible = days.some((d) => isSameDay(d, new Date()));
    const hour = todayVisible ? Math.max(0, Math.min(settings.dayStartHour, new Date().getHours() - 1)) : settings.dayStartHour;
    scrollRef.current.scrollTop = Math.max(0, hour * hourHeight - 12);
    initialScrollDone.current = true;
  }, [days, hourHeight, settings.dayStartHour]);

  // ---------------------------------------------------------------------------
  // Pointer interactions

  const [drag, setDrag] = useState<Drag | null>(null);
  const pending = useRef<Pending | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  /** What a tap (a press that did not move) was on, opened by the click that follows it. */
  const tap = useRef<Pending['target'] | null>(null);
  /** The long press that picks an event up with a finger. */
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopLongPress = () => {
    if (longPress.current !== null) clearTimeout(longPress.current);
    longPress.current = null;
  };
  useEffect(() => stopLongPress, []);

  /** Starts moving (or resizing) the event the press began on: after a mouse moved a little, or after a finger was held. */
  const startDrag = (p: Pending): boolean => {
    if (p.target.kind !== 'event') return false;
    const { occ } = p.target;
    if (calendars.get(occ.calendarId)?.readOnly) return false;
    const startDay = Math.max(0, differenceInCalendarDays(occ.start, days[0]));
    if (p.target.resize) {
      setDrag({ kind: 'resize', occ, endMin: minutesOfDay(occ.end) || 1440, day: startDay });
    } else {
      const occStartMin = isSameDay(occ.start, days[p.target.day]) ? minutesOfDay(occ.start) : wallMinutes(occ.start, days[p.target.day]);
      setDrag({
        kind: 'move',
        occ,
        grabOffsetMin: p.target.min - occStartMin,
        day: p.target.day,
        min: occStartMin,
        duration: (occ.end.getTime() - occ.start.getTime()) / 60000,
      });
    }
    return true;
  };

  // While a finger moves an event the grid must not scroll. Only a listener
  // that is not passive can stop that, and only before scrolling has begun:
  // the long press is given up as soon as the finger moves (TOUCH_SLOP).
  useEffect(() => {
    const el = columnsRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const pointToCell = (clientX: number, clientY: number) => {
    const rect = columnsRef.current!.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    const day = Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / colWidth)));
    const min = Math.max(0, Math.min(1440, (clientY - rect.top) / pxPerMin));
    return { day, min };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    tap.current = null;
    stopLongPress();
    if (e.button !== 0) return;
    const { day, min } = pointToCell(e.clientX, e.clientY);
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-occ]');
    const touch = e.pointerType === 'touch';
    let p: Pending;
    if (chip) {
      const occ = occurrences.find((o) => o.key === chip.dataset.occ);
      if (!occ) return;
      p = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch, target: { kind: 'event', occ, el: chip, resize: !!(e.target as HTMLElement).closest('[data-resize]'), day, min } };
    } else if ((e.target as HTMLElement).closest('[data-task]')) {
      return;
    } else {
      p = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch, target: { kind: 'empty', day, min } };
    }
    pending.current = p;
    if (!touch) {
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (p.target.kind === 'event' && !calendars.get(p.target.occ.calendarId)?.readOnly) {
      // A finger held still on an event picks it up; nothing opens then (a long press sends no click).
      longPress.current = setTimeout(() => {
        longPress.current = null;
        if (pending.current !== p || dragRef.current) return;
        if (startDrag(p)) claimSwipe(p.pointerId);
      }, LONG_PRESS_MS);
    }
  };

  /** Opens what a tap was on: the event's details, or a new event at the half hour tapped. */
  const onClick = () => {
    const target = tap.current;
    tap.current = null;
    if (!target) return;
    if (target.kind === 'event') {
      const r = target.el.getBoundingClientRect();
      openPopover({ occurrence: target.occ, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
      return;
    }
    // Something open is closed by a tap beside it, rather than starting something new.
    const ui = useUi.getState();
    if (ui.popover || ui.quickCreate) {
      openPopover(null);
      openQuickCreate(null);
      return;
    }
    const startMin = Math.floor(target.min / 30) * 30;
    const start = setMinutesOfDay(days[target.day], startMin);
    const end = addMinutes(start, settings.defaultEventDuration);
    openQuickCreate({ start, end, allDay: false, anchor: anchorFor(target.day, startMin, startMin + settings.defaultEventDuration) });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const cell = pointToCell(e.clientX, e.clientY);
    const current = dragRef.current;
    if (!current) {
      if (p.touch) {
        // Moving first is a scroll or a swipe, not a long press.
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TOUCH_SLOP) stopLongPress();
        return;
      }
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      if (p.target.kind === 'empty') {
        const anchor = Math.floor(p.target.min / SNAP) * SNAP;
        setDrag({ kind: 'create', day: p.target.day, anchorMin: anchor, curMin: anchor + SNAP, curDay: p.target.day });
      } else {
        startDrag(p);
      }
      return;
    }
    if (current.kind === 'create') setDrag({ ...current, curMin: roundToStep(cell.min, SNAP), curDay: cell.day });
    else if (current.kind === 'move') setDrag({ ...current, day: cell.day, min: roundToStep(cell.min - current.grabOffsetMin, SNAP) });
    else setDrag({ ...current, endMin: Math.max(roundToStep(cell.min, SNAP), minutesOfDay(current.occ.start) + SNAP) });
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    stopLongPress();
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    pending.current = null;
    const d = dragRef.current;
    setDrag(null);
    if (cancelled) return;

    if (!d) {
      // A swipe is not a tap.
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
      // A tap: what it opens waits for the click that follows. Opened now, a
      // sheet's backdrop would be under the finger when that click comes.
      tap.current = p.target;
      return;
    }

    if (d.kind === 'create') {
      const sameDay = d.curDay === d.day;
      let a = d.anchorMin;
      let b = d.curMin;
      if (sameDay && b < a) [a, b] = [b, a + SNAP];
      if (sameDay && b - a < SNAP) b = a + SNAP;
      const start = setMinutesOfDay(days[Math.min(d.day, d.curDay)], sameDay ? a : d.curDay < d.day ? d.curMin : d.anchorMin);
      const end = setMinutesOfDay(days[Math.max(d.day, d.curDay)], sameDay ? b : d.curDay < d.day ? d.anchorMin + SNAP : d.curMin);
      openQuickCreate({ start, end, allDay: false, anchor: anchorFor(d.day, a, b) });
    } else if (d.kind === 'move') {
      const start = setMinutesOfDay(days[d.day], d.min);
      if (start.getTime() !== d.occ.start.getTime()) void moveOccurrence(d.occ, start, addMinutes(start, d.duration), false);
    } else {
      const end = setMinutesOfDay(d.occ.start, d.endMin);
      if (end.getTime() !== d.occ.end.getTime()) void moveOccurrence(d.occ, d.occ.start, end, false);
    }
  };

  const anchorFor = (day: number, a: number, b: number) => {
    const rect = columnsRef.current!.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    return { x: rect.left + day * colWidth, y: rect.top + a * pxPerMin, width: colWidth, height: Math.max(20, (b - a) * pxPerMin) };
  };

  /** Day column under the pointer in the all-day strip. */
  const stripColumn = (e: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(days.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * days.length)));
  };
  /** Where a finger came down on the empty all-day strip: a tap there (not a swipe) creates an all-day event. */
  const stripTouch = useRef<{ x: number; y: number } | null>(null);
  const openAllDay = (first: number, last: number, strip: HTMLElement) => {
    const rect = strip.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    openQuickCreate({
      start: startOfDay(days[first]),
      end: addDays(startOfDay(days[last]), 1),
      allDay: true,
      anchor: { x: rect.left + first * colWidth, y: rect.top, width: (last - first + 1) * colWidth, height: rect.height },
    });
  };

  // Cancel a drag with Escape.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pending.current = null;
        setDrag(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  // ---------------------------------------------------------------------------
  // Rendering helpers

  const colorOf = (occ: Occurrence) => eventColor(occ.color, calendars.get(occ.calendarId)?.color);
  // A phone's week needs every pixel for its seven days: the hour labels take a narrower gutter.
  const gutter = settings.showSecondaryTimezone ? 'w-[104px]' : phone ? 'w-11' : 'w-14 sm:w-16';
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const secondaryLabel = (h: number) => {
    const d = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), h);
    const p = zonedParts(settings.secondaryTimezone, d);
    return fmt.hourLabel(p.hour) + (p.minute ? `:${String(p.minute).padStart(2, '0')}` : '');
  };

  const quickCreateGhost =
    quickCreate && !quickCreate.allDay
      ? days
          .map((day, i) => ({ i, day }))
          .filter(({ day }) => isSameDay(day, quickCreate.start))
          .map(({ i, day }) => {
            const top = (quickCreate.start.getTime() - startOfDay(day).getTime()) / 60000;
            const bottom = Math.min(1440, (quickCreate.end.getTime() - startOfDay(day).getTime()) / 60000);
            return { i, top, height: Math.max(18, (bottom - top) * pxPerMin - 2) };
          })[0]
      : undefined;
  /** First and last visible day covered by the all-day event being created. */
  const allDayGhost = (() => {
    if (!quickCreate?.allDay) return undefined;
    const covered = days.flatMap((d, i) => (d >= startOfDay(quickCreate.start) && d < quickCreate.end ? [i] : []));
    return covered.length ? { first: covered[0], last: covered[covered.length - 1] } : undefined;
  })();

  // A new event may start outside of what is scrolled into view.
  const ghostId = quickCreate?.id;
  const ghostStart = quickCreate?.start.getTime();
  useEffect(() => {
    if (ghostId !== undefined) scrollRef.current?.querySelector('[data-quick-ghost]')?.scrollIntoView({ block: 'nearest' });
  }, [ghostId, ghostStart]);

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      {/* Day headers */}
      <div className="border-border-weak flex shrink-0 border-b" style={{ scrollbarGutter: 'stable', overflowY: 'hidden', overflowX: 'hidden' }}>
        <div className={`${gutter} text-text-hint flex shrink-0 flex-col items-center justify-end gap-0.5 pb-1 text-[0.6875rem]`}>
          {settings.showWeekNumbers && days.length > 1 && <span title={t('grid.weekLong', { n: weekNumber(days[0]) })}>{t('grid.week')}{weekNumber(days[0])}</span>}
          {settings.showSecondaryTimezone && (
            // Labels sit above the two hour columns they describe.
            <div className="flex w-full justify-end gap-2 pr-2 text-[0.625rem] leading-none">
              <span className="truncate opacity-70" title={settings.secondaryTimezone}>
                {fmt.zoneName(settings.secondaryTimezone)}
              </span>
              <span className="shrink-0">{fmt.zoneName()}</span>
            </div>
          )}
        </div>
        {/* Clipped at its own edges: the days beside these, and these as they move, stay off the gutter. */}
        <div className="min-w-0 flex-1 overflow-x-clip">
          <div ref={headRef} data-pager className="relative grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => (
              <button key={d.toISOString()} type="button" onClick={() => goTo(d, 'day')} className="hover:bg-bg-weak flex flex-col items-center gap-0.5 py-2 transition-colors">
                <DayHead day={d} today={isSameDay(d, now)} fmt={fmt} />
              </button>
            ))}
            {peerLayouts?.map((p) => (
              <div key={p.side} data-pager-peer={p.side} inert aria-hidden className={`${peerSide(p.side)} grid`} style={{ gridTemplateColumns: `repeat(${p.days.length}, minmax(0, 1fr))` }}>
                {p.days.map((d) => (
                  <div key={d.toISOString()} className="flex flex-col items-center gap-0.5 py-2">
                    <DayHead day={d} today={isSameDay(d, now)} fmt={fmt} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* All-day strip */}
      <div className="border-border-weak flex shrink-0 border-b" style={{ scrollbarGutter: 'stable', overflowY: 'hidden', overflowX: 'hidden' }}>
        <div className={`${gutter} text-text-hint flex shrink-0 flex-col items-center justify-start px-1 pt-1.5 text-center text-[0.6875rem] leading-tight`}>
          <span>{t('grid.allDay')}</span>
          {laneCount > MAX_ALL_DAY_LANES && (
            <button
              type="button"
              aria-label={allDayExpanded ? t('sidebar.collapse') : t('sidebar.expand')}
              className="hover:bg-bg-weak mt-0.5 rounded p-0.5"
              onClick={() => setAllDayExpanded(!allDayExpanded)}
            >
              {allDayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-x-clip">
          <div
            ref={stripRef}
            data-pager
            data-all-day
            className="relative"
            style={{ height: allDayHeight }}
            onPointerDown={(e) => {
              stripTouch.current = null;
              if (e.button !== 0 || (e.target as HTMLElement).closest('[data-occ],[data-task],[data-more]')) return;
              // A finger only taps here: dragging across days is a swipe to the next period.
              if (e.pointerType === 'touch') {
                stripTouch.current = { x: e.clientX, y: e.clientY };
                return;
              }
              const col = stripColumn(e);
              setStripSel({ from: col, to: col });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!stripSel) return;
              const col = stripColumn(e);
              if (col !== stripSel.to) setStripSel({ ...stripSel, to: col });
            }}
            onPointerCancel={() => {
              stripTouch.current = null;
              setStripSel(null);
            }}
            onPointerUp={(e) => {
              if (!stripSel) return;
              setStripSel(null);
              openAllDay(Math.min(stripSel.from, stripSel.to), Math.max(stripSel.from, stripSel.to), e.currentTarget);
            }}
            onClick={(e) => {
              const start = stripTouch.current;
              stripTouch.current = null;
              if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
              const col = stripColumn(e);
              openAllDay(col, col, e.currentTarget);
            }}
          >
            <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <div key={d.toISOString()} className="border-border-weak border-l" />
              ))}
            </div>
            {allDayItems
              .filter((b) => b.lane < visibleLanes)
              .map((b) => {
                const style = allDayBox(b, days.length);
                if (b.item.kind === 'task') {
                  const task = b.item.task;
                  return (
                    <div key={taskItemKey(task)} data-task className="absolute cursor-pointer" style={style} onClick={() => openEditTask(task)}>
                      <TaskChip title={task.title || t('grid.noTitle')} color={calendars.get(task.calendarId)?.color ?? DEFAULT_TASK_COLOR} completed={task.completed} onToggle={() => void toggleTask(task)} dense={phone} />
                    </div>
                  );
                }
                const occ = b.item.occ;
                return (
                  <button
                    key={occ.key}
                    type="button"
                    data-occ={occ.key}
                    className="absolute text-left"
                    style={style}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      openPopover({ occurrence: occ, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
                    }}
                  >
                    <BarChip
                      dense={phone}
                      title={titleWithYears(occ, t('grid.noTitle'))}
                      color={colorOf(occ)}
                      eventStyle={settings.eventStyle}
                      past={settings.dimPastEvents && occ.end < now}
                      continuesBefore={b.continuesBefore}
                      continuesAfter={b.continuesAfter}
                      cancelled={occ.status === 'CANCELLED'}
                      reply={occ.selfStatus}
                    />
                  </button>
                );
              })}
            {!allDayExpanded &&
              hiddenPerDay.map((n, i) =>
                n > 0 ? (
                  <button
                    key={i}
                    type="button"
                    data-more
                    className="text-text-weak hover:bg-bg-weak absolute rounded px-1.5 text-left text-[0.6875rem] font-semibold"
                    style={{ left: `calc(${(i / days.length) * 100}% + 2px)`, width: `calc(${100 / days.length}% - 5px)`, top: 4 + visibleLanes * ALL_DAY_LANE, height: ALL_DAY_LANE - 4 }}
                    onClick={() => setAllDayExpanded(true)}
                  >
                    {t('grid.more', { n })}
                  </button>
                ) : null,
              )}
            {stripSel && (
              <div
                className="bg-primary-weak border-primary pointer-events-none absolute rounded-md border-2"
                style={{
                  left: `calc(${(Math.min(stripSel.from, stripSel.to) / days.length) * 100}% + 2px)`,
                  width: `calc(${((Math.abs(stripSel.to - stripSel.from) + 1) / days.length) * 100}% - 5px)`,
                  top: 4,
                  height: ALL_DAY_LANE - 3,
                }}
              />
            )}
            {allDayGhost && (
              <div
                data-quick-ghost
                className="shadow-elevated pointer-events-none absolute z-[2] rounded-md"
                style={{
                  left: `calc(${(allDayGhost.first / days.length) * 100}% + 2px)`,
                  width: `calc(${((allDayGhost.last - allDayGhost.first + 1) / days.length) * 100}% - 5px)`,
                  top: 4,
                  height: ALL_DAY_LANE - 3,
                }}
              >
                <BarChip dense={phone} title={quickCreate!.title || t('grid.noTitle')} color={quickCreate!.color ?? ''} eventStyle={settings.eventStyle} />
              </div>
            )}
            {/* The days beside these show the lanes that fit here, without "+N". */}
            {peerLayouts?.map((p) => (
              <div key={p.side} data-pager-peer={p.side} inert aria-hidden className={`${peerSide(p.side)} overflow-hidden`}>
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${p.days.length}, minmax(0, 1fr))` }}>
                  {p.days.map((d) => (
                    <div key={d.toISOString()} className="border-border-weak border-l" />
                  ))}
                </div>
                {p.allDayItems
                  .filter((b) => b.lane < visibleLanes)
                  .map((b) => (
                    <div key={b.item.kind === 'task' ? taskItemKey(b.item.task) : b.item.occ.key} className="absolute" style={allDayBox(b, p.days.length)}>
                      {b.item.kind === 'task' ? (
                        <TaskChip title={b.item.task.title || t('grid.noTitle')} color={calendars.get(b.item.task.calendarId)?.color ?? DEFAULT_TASK_COLOR} completed={b.item.task.completed} onToggle={() => {}} dense={phone} />
                      ) : (
                        <BarChip
                          dense={phone}
                          title={titleWithYears(b.item.occ, t('grid.noTitle'))}
                          color={colorOf(b.item.occ)}
                          eventStyle={settings.eventStyle}
                          past={settings.dimPastEvents && b.item.occ.end < now}
                          continuesBefore={b.continuesBefore}
                          continuesAfter={b.continuesAfter}
                          cancelled={b.item.occ.status === 'CANCELLED'}
                          reply={b.item.occ.selfStatus}
                        />
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Time grid */}
      {/* Sideways it clips: the days slide in from the side when the period changes. */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="flex" style={{ height: 24 * hourHeight }}>
          <div className={`${gutter} relative shrink-0`}>
            {hours.map((h) =>
              h === 0 ? null : (
                <div key={h} className="text-text-hint absolute right-0 flex w-full -translate-y-1/2 justify-end gap-2 pr-2 text-[0.6875rem] tabular-nums" style={{ top: h * hourHeight }}>
                  {settings.showSecondaryTimezone && <span className="opacity-70">{secondaryLabel(h)}</span>}
                  <span>{fmt.hourLabel(h)}</span>
                </div>
              ),
            )}
          </div>
          {/* Clipped at its own edges, like the day headers. */}
          <div className="relative min-w-0 flex-1 overflow-x-clip">
            <div
              ref={columnsRef}
              data-pager
              className="time-grid-bg relative grid h-full"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, touchAction: drag ? 'none' : undefined }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finish(e)}
              onPointerCancel={(e) => finish(e, true)}
              onClick={onClick}
              onContextMenu={(e) => {
                // A long press is the way to pick an event up, not a menu.
                if (pending.current?.touch || dragRef.current) e.preventDefault();
              }}
            >
              {days.map((day, i) => {
                const isToday = isSameDay(day, now);
                return (
                  <div key={day.toISOString()} className={`border-border-weak relative border-l ${isToday ? 'bg-primary-weak/30' : ''}`}>
                    {timedByDay[i].map((box) => {
                      const style = timedBox(box, pxPerMin);
                      const height = style.height;
                      if (box.item.kind === 'task') {
                        const task = box.item.task;
                        return (
                          <div key={taskItemKey(task)} data-task className="absolute z-[1] cursor-pointer" style={{ ...style, height: Math.min(height, 22) }} onClick={() => openEditTask(task)}>
                            <TaskChip title={task.title || t('grid.noTitle')} color={calendars.get(task.calendarId)?.color ?? DEFAULT_TASK_COLOR} completed={task.completed} onToggle={() => void toggleTask(task)} dense={phone} />
                          </div>
                        );
                      }
                      const occ = box.item.occ;
                      const beingDragged = drag && drag.kind !== 'create' && drag.occ.key === occ.key;
                      const resizable = !calendars.get(occ.calendarId)?.readOnly && isSameDay(occ.start, day) && occ.end <= addDays(startOfDay(day), 1);
                      return (
                        <div
                          key={occ.key}
                          data-occ={occ.key}
                          role="button"
                          tabIndex={0}
                          aria-label={`${titleWithYears(occ)}, ${fmt.timeRange(occ.start, occ.end)}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              const r = e.currentTarget.getBoundingClientRect();
                              openPopover({ occurrence: occ, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
                            }
                          }}
                          className={`group absolute z-[1] cursor-pointer ${beingDragged ? 'opacity-40' : ''}`}
                          style={style}
                        >
                          <TimedChipContent
                            title={titleWithYears(occ, t('grid.noTitle'))}
                            time={fmt.timeRange(occ.start, occ.end)}
                            location={occ.location}
                            color={colorOf(occ)}
                            eventStyle={settings.eventStyle}
                            heightPx={height}
                            past={settings.dimPastEvents && occ.end < now}
                            tentative={occ.status === 'TENTATIVE'}
                            cancelled={occ.status === 'CANCELLED'}
                            reply={occ.selfStatus}
                            recurring={occ.isRecurring}
                            selected={popover?.occurrence.key === occ.key}
                            phone={phone}
                          />
                          {resizable && (
                            // A finger needs a taller handle; it shows while the event is held.
                            <div
                              data-resize
                              className={`absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 pointer-coarse:h-3 ${beingDragged ? 'pointer-coarse:opacity-100' : ''}`}
                            >
                              <div className="mx-auto mt-0.5 h-1 w-6 rounded-full bg-white/70" />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Drag previews */}
                    {drag?.kind === 'move' && drag.day === i && (
                      <div className="pointer-events-none absolute right-1.5 left-px z-[3]" style={{ top: drag.min * pxPerMin + 1, height: Math.max(18, drag.duration * pxPerMin - 2) }}>
                        <TimedChipContent
                          title={titleWithYears(drag.occ, t('grid.noTitle'))}
                          time={fmt.timeRange(setMinutesOfDay(day, drag.min), setMinutesOfDay(day, drag.min + drag.duration))}
                          color={colorOf(drag.occ)}
                          eventStyle={settings.eventStyle}
                          heightPx={drag.duration * pxPerMin}
                          dragging
                          phone={phone}
                        />
                      </div>
                    )}
                    {drag?.kind === 'resize' && drag.day === i && (
                      <div
                        className="pointer-events-none absolute right-1.5 left-px z-[3]"
                        style={{ top: minutesOfDay(drag.occ.start) * pxPerMin + 1, height: Math.max(18, (drag.endMin - minutesOfDay(drag.occ.start)) * pxPerMin - 2) }}
                      >
                        <TimedChipContent
                          title={titleWithYears(drag.occ, t('grid.noTitle'))}
                          time={fmt.timeRange(drag.occ.start, setMinutesOfDay(drag.occ.start, drag.endMin))}
                          color={colorOf(drag.occ)}
                          eventStyle={settings.eventStyle}
                          heightPx={(drag.endMin - minutesOfDay(drag.occ.start)) * pxPerMin}
                          dragging
                          phone={phone}
                        />
                      </div>
                    )}
                    {drag?.kind === 'create' && i >= Math.min(drag.day, drag.curDay) && i <= Math.max(drag.day, drag.curDay) && (
                      <SelectionBlock drag={drag} dayIndex={i} pxPerMin={pxPerMin} day={day} fmt={fmt} />
                    )}
                    {quickCreateGhost && quickCreateGhost.i === i && !drag && (
                      <div data-quick-ghost className="pointer-events-none absolute right-1.5 left-px z-[3]" style={{ top: quickCreateGhost.top * pxPerMin + 1, height: quickCreateGhost.height }}>
                        <TimedChipContent
                          title={quickCreate!.title || t('grid.noTitle')}
                          time={fmt.timeRange(quickCreate!.start, quickCreate!.end)}
                          color={quickCreate!.color ?? ''}
                          eventStyle={settings.eventStyle}
                          heightPx={quickCreateGhost.height}
                          dragging
                          phone={phone}
                        />
                      </div>
                    )}

                    {isToday && <NowLine top={minutesOfDay(now) * pxPerMin} />}
                  </div>
                );
              })}
              {peerLayouts?.map((p) => (
                <div key={p.side} data-pager-peer={p.side} inert aria-hidden className={`${peerSide(p.side)} time-grid-bg grid`} style={{ gridTemplateColumns: `repeat(${p.days.length}, minmax(0, 1fr))` }}>
                  {p.days.map((day, i) => {
                    const isToday = isSameDay(day, now);
                    return (
                      <div key={day.toISOString()} className={`border-border-weak relative border-l ${isToday ? 'bg-primary-weak/30' : ''}`}>
                        {p.timedByDay[i].map((box) => {
                          const style = timedBox(box, pxPerMin);
                          if (box.item.kind === 'task') {
                            const task = box.item.task;
                            return (
                              <div key={taskItemKey(task)} className="absolute z-[1]" style={{ ...style, height: Math.min(style.height, 22) }}>
                                <TaskChip title={task.title || t('grid.noTitle')} color={calendars.get(task.calendarId)?.color ?? DEFAULT_TASK_COLOR} completed={task.completed} onToggle={() => {}} dense={phone} />
                              </div>
                            );
                          }
                          const occ = box.item.occ;
                          return (
                            <div key={occ.key} className="absolute z-[1]" style={style}>
                              <TimedChipContent
                                title={titleWithYears(occ, t('grid.noTitle'))}
                                time={fmt.timeRange(occ.start, occ.end)}
                                location={occ.location}
                                color={colorOf(occ)}
                                eventStyle={settings.eventStyle}
                                heightPx={style.height}
                                past={settings.dimPastEvents && occ.end < now}
                                tentative={occ.status === 'TENTATIVE'}
                                cancelled={occ.status === 'CANCELLED'}
                                reply={occ.selfStatus}
                                recurring={occ.isRecurring}
                                phone={phone}
                              />
                            </div>
                          );
                        })}
                        {isToday && <NowLine top={minutesOfDay(now) * pxPerMin} />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectionBlock({ drag, dayIndex, pxPerMin, day, fmt }: { drag: Extract<Drag, { kind: 'create' }>; dayIndex: number; pxPerMin: number; day: Date; fmt: ReturnType<typeof useFormat> }) {
  const first = Math.min(drag.day, drag.curDay);
  const last = Math.max(drag.day, drag.curDay);
  let top: number;
  let bottom: number;
  if (first === last) {
    top = Math.min(drag.anchorMin, drag.curMin);
    bottom = Math.max(drag.anchorMin + (drag.curMin < drag.anchorMin ? 15 : 0), drag.curMin);
  } else {
    const startMin = drag.day <= drag.curDay ? drag.anchorMin : drag.curMin;
    const endMin = drag.day <= drag.curDay ? drag.curMin : drag.anchorMin + 15;
    top = dayIndex === first ? startMin : 0;
    bottom = dayIndex === last ? endMin : 1440;
  }
  return (
    <div
      className="bg-primary text-primary-contrast pointer-events-none absolute right-1.5 left-px z-[3] overflow-hidden rounded-md px-1.5 py-1 text-[0.6875rem] font-medium opacity-90"
      style={{ top: top * pxPerMin + 1, height: Math.max(14, (bottom - top) * pxPerMin - 2) }}
    >
      {fmt.timeRange(setMinutesOfDay(day, top), setMinutesOfDay(day, bottom))}
    </div>
  );
}
