import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, differenceInCalendarDays, isSameMonth, startOfDay } from 'date-fns';
import { useCalendarMap, useOccurrences, useTasks } from '@/hooks/useCalendarData';
import { useFormat } from '@/hooks/useFormat';
import { useNow } from '@/hooks/useNow';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useTextScale } from '@/hooks/useTextScale';
import { usePeriodTransition } from '@/hooks/usePeriodTransition';
import { isSameDay, viewRange, weekNumber } from '@/lib/date';
import { layoutSpans, type SpanBox } from '@/lib/layout';
import { moveOccurrence, openEditTask, toggleTask } from '@/lib/actions';
import { taskItemKey, tasksInRange } from '@/lib/ical/tasks';
import type { Occurrence, Task } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { Popover } from '@/components/ui/Menu';
import { BarChip, DotChip, TaskChip } from './EventChip';
import { DEFAULT_TASK_COLOR, eventColor } from '@/lib/color';

/** 'ghost' is the event being created in the quick-create popover. */
type Item = { kind: 'event'; occ: Occurrence } | { kind: 'task'; task: Task } | { kind: 'ghost' };

const itemKey = (item: Item) => (item.kind === 'event' ? item.occ.key : item.kind === 'task' ? taskItemKey(item.task) : 'ghost');

/**
 * Height of one lane of chips and of the day number above them, in px at the
 * normal text size. A phone's lanes are tighter (17 px chips, 2 px apart), so
 * that a day of a 6-week month shows three of them.
 */
export function monthMetrics(phone: boolean, textScale: number): { lane: number; header: number } {
  return { lane: Math.round((phone ? 19 : 22) * textScale), header: Math.round((phone ? 24 : 28) * textScale) };
}

/** How many lanes of chips fit in a row `rowHeight` px tall. */
export function lanesThatFit(rowHeight: number, lane: number, header: number): number {
  return Math.max(1, Math.floor((rowHeight - header - 4) / lane));
}

/** The grid's columns: the seven days, after the week numbers when they are shown. */
function monthColumns(mobile: boolean, weekNumbers: boolean): string {
  if (!weekNumbers) return 'grid-cols-7';
  return mobile ? 'grid-cols-[22px_repeat(7,minmax(0,1fr))]' : 'grid-cols-[28px_repeat(7,minmax(0,1fr))]';
}

/** Day cell under a point. Chips sit in an overlay above the cells, so look through them. */
function dayAt(x: number, y: number): Date | null {
  const cell = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.day);
  return cell ? new Date(Number((cell as HTMLElement).dataset.day)) : null;
}

/**
 * The month on screen. While a finger swipes it sideways (`peek`, see
 * hooks/useSwipePager.ts), the months before and after it are drawn to its
 * left and right, inside the element that follows the finger: the month the
 * swipe goes to comes into view with its days and events as the current one
 * moves away, and it is what stays when the swipe ends. They are drawn for the
 * swipe only, so the rest of the time a month costs what it always did.
 */
export function MonthView({ peek = false }: { peek?: boolean }) {
  const fmt = useFormat();
  const mobile = useIsMobile();
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const showWeekNumbers = useSettings((s) => s.showWeekNumbers);
  const date = useUi((s) => s.date);
  const start = useMemo(() => viewRange('month', date, weekStartsOn).start, [date, weekStartsOn]);
  const before = useMemo(() => addMonths(date, -1), [date]);
  const after = useMemo(() => addMonths(date, 1), [date]);

  // Measured once for the three months, so that a month drawn beside this one has the right rows from the start.
  const pagerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A new month slides in from the side it comes from.
  usePeriodTransition([pagerRef], start.getTime());

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-clip select-none">
      <div className={`border-border-weak grid shrink-0 border-b ${monthColumns(mobile, showWeekNumbers)}`}>
        {showWeekNumbers && <div />}
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => (
          <div key={d.getDay()} className="text-text-weak py-2 text-center text-[0.6875rem] font-semibold tracking-wide uppercase">
            {mobile ? fmt.weekdayNarrow(d) : fmt.weekdayShort(d)}
          </div>
        ))}
      </div>
      <div ref={pagerRef} data-pager className="relative min-h-0 flex-1">
        <MonthGrid month={date} height={height} />
        {peek && <MonthGrid month={before} height={height} peer={-1} />}
        {peek && <MonthGrid month={after} height={height} peer={1} />}
      </div>
    </div>
  );
}

/**
 * The weeks of the month around `month`, `height` px tall in all. A `peer` is
 * a month drawn beside the one on screen during a swipe (-1 the one before,
 * 1 the one after): the same days and events, but nothing in it can be
 * touched, focused or found as a day; the pager and the month on screen keep
 * all of that.
 */
const MonthGrid = memo(function MonthGrid({ month, height, peer }: { month: Date; height: number; peer?: -1 | 1 }) {
  const t = useT();
  const fmt = useFormat();
  const now = useNow();
  const mobile = useIsMobile();
  const textScale = useTextScale();
  const { lane: LANE, header: HEADER } = monthMetrics(mobile, textScale);
  const settings = useSettings();
  const calendars = useCalendarMap();
  const { goTo, openPopover, openQuickCreate, popover, quickCreate } = useUi();
  const range = useMemo(() => viewRange('month', month, settings.weekStartsOn), [month, settings.weekStartsOn]);
  const occurrences = useOccurrences(range);
  const tasks = useTasks();

  const weeks = useMemo(() => {
    const out: Date[] = [];
    for (let d = range.start; d < range.end; d = addDays(d, 7)) out.push(d);
    return out;
  }, [range]);

  // The event being created belongs to the month on screen only.
  const ghostStart = peer ? undefined : quickCreate?.start;
  const ghostEnd = peer ? undefined : quickCreate?.end;
  const ghost = useMemo(() => (ghostStart && ghostEnd ? { start: ghostStart, end: ghostEnd } : null), [ghostStart, ghostEnd]);

  // On their own: a drag to create an event changes `ghost` at every move, which must not repeat the tasks again.
  const taskItems = useMemo(() => {
    if (!settings.showTasksInCalendar) return [];
    return tasksInRange(tasks, range.start, range.end, settings.showCompletedTasks).map((task): { item: Item; start: Date; end: Date } => {
      const s = startOfDay(task.due!);
      return { item: { kind: 'task', task }, start: s, end: addDays(s, 1) };
    });
  }, [tasks, range, settings.showTasksInCalendar, settings.showCompletedTasks]);

  const items = useMemo(() => {
    const list: { item: Item; start: Date; end: Date }[] = occurrences.map((occ) => ({ item: { kind: 'event', occ }, start: occ.start, end: occ.end }));
    list.push(...taskItems);
    if (ghost) list.push({ item: { kind: 'ghost' }, start: ghost.start, end: ghost.end });
    return list;
  }, [occurrences, taskItems, ghost]);

  const rows = useMemo(() => weeks.map((w) => layoutSpans(items, w, 7)), [weeks, items]);

  // How many lanes fit in a row; until the grid has been measured, a row is taken as 120 px.
  const rowHeight = height ? height / weeks.length : 120;
  const maxLanes = lanesThatFit(rowHeight, LANE, HEADER);
  /** Width of the week numbers' column. */
  const weekCol = mobile ? 22 : 28;
  const columns = monthColumns(mobile, settings.showWeekNumbers);

  // Drag events between days (mouse only).
  const [dragging, setDragging] = useState<{ occ: Occurrence; fromDay: Date; overDay: Date | null } | null>(null);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  // The click that ends a drag on the item it started from opens nothing:
  // by the time it comes, the drag is over in the state already.
  const dragEnded = useRef(false);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const over = dayAt(e.clientX, e.clientY);
      setDragging((d) => (d && over?.getTime() !== d.overDay?.getTime() ? { ...d, overDay: over } : d));
    };
    const onUp = () => {
      // Read from the ref: side effects do not belong in a state updater.
      const d = draggingRef.current;
      setDragging(null);
      dragEnded.current = true;
      setTimeout(() => (dragEnded.current = false));
      if (d?.overDay && !isSameDay(d.overDay, d.fromDay)) {
        const delta = differenceInCalendarDays(d.overDay, d.fromDay);
        void moveOccurrence(d.occ, addDays(d.occ.start, delta), addDays(d.occ.end, delta));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag across empty cells to create an event spanning several days (mouse only).
  const [selection, setSelection] = useState<{ anchor: Date; current: Date } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    if (!selection) return;
    const onMove = (e: PointerEvent) => {
      const over = dayAt(e.clientX, e.clientY);
      if (over) setSelection((s) => (s && s.current.getTime() !== over.getTime() ? { ...s, current: over } : s));
    };
    const onUp = () => {
      const s = selectionRef.current;
      setSelection(null);
      if (!s) return;
      const [first, last] = s.anchor <= s.current ? [s.anchor, s.current] : [s.current, s.anchor];
      const r = document.querySelector(`[data-day="${s.current.getTime()}"]`)?.getBoundingClientRect();
      if (r) openQuickCreate({ start: first, end: addDays(last, 1), allDay: true, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [selection !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Days highlighted as the range of the event being created. */
  const pendingRange = selection
    ? selection.anchor <= selection.current
      ? { start: selection.anchor, end: addDays(selection.current, 1) }
      : { start: selection.current, end: addDays(selection.anchor, 1) }
    : null;

  const colorOf = (occ: Occurrence) => eventColor(occ.color, calendars.get(occ.calendarId)?.color);
  const visibleDays = (row: Date) => Array.from({ length: 7 }, (_, i) => addDays(row, i));

  const renderItem = (b: SpanBox<Item>, compact: boolean) => {
    if (b.item.kind === 'ghost') {
      return (
        <div data-quick-ghost className="shadow-elevated h-full rounded-md">
          <BarChip
            dense={compact}
            title={quickCreate?.title || t('grid.noTitle')}
            color={quickCreate?.color ?? ''}
            eventStyle={settings.eventStyle}
            continuesBefore={b.continuesBefore}
            continuesAfter={b.continuesAfter}
          />
        </div>
      );
    }
    if (b.item.kind === 'task') {
      const task = b.item.task;
      return (
        <div data-item className="h-full cursor-pointer" onClick={() => openEditTask(task)}>
          <TaskChip title={task.title || t('grid.noTitle')} color={calendars.get(task.calendarId)?.color ?? DEFAULT_TASK_COLOR} completed={task.completed} onToggle={() => void toggleTask(task)} dense={compact} />
        </div>
      );
    }
    const occ = b.item.occ;
    const multi = occ.allDay || b.span > 1 || occ.end.getTime() - occ.start.getTime() >= 86400000;
    const past = settings.dimPastEvents && occ.end < now;
    return (
      <button
        type="button"
        data-item
        className={`block h-full w-full text-left ${dragging?.occ.key === occ.key ? 'opacity-40' : ''} ${popover?.occurrence.key === occ.key ? 'ring-primary rounded-md ring-2' : ''}`}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0 || calendars.get(occ.calendarId)?.readOnly) return;
          const startX = e.clientX;
          const startY = e.clientY;
          const fromDay = dayAt(e.clientX, e.clientY) ?? startOfDay(occ.start);
          const onMove = (ev: PointerEvent) => {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
              window.removeEventListener('pointermove', onMove);
              setDragging({ occ, fromDay, overDay: fromDay });
            }
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true });
        }}
        onClick={(e) => {
          if (dragging || dragEnded.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          openPopover({ occurrence: occ, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
        }}
      >
        {multi ? (
          <BarChip
            dense={compact}
            title={occ.title || t('grid.noTitle')}
            color={colorOf(occ)}
            eventStyle={settings.eventStyle}
            past={past}
            continuesBefore={b.continuesBefore}
            continuesAfter={b.continuesAfter}
            cancelled={occ.status === 'CANCELLED'}
            reply={occ.selfStatus}
            prefix={!occ.allDay && !b.continuesBefore && !compact ? <span className="shrink-0 font-normal opacity-85">{fmt.time(occ.start)}</span> : undefined}
          />
        ) : compact ? (
          <BarChip dense title={occ.title || t('grid.noTitle')} color={colorOf(occ)} eventStyle={settings.eventStyle} past={past} cancelled={occ.status === 'CANCELLED'} reply={occ.selfStatus} />
        ) : (
          <DotChip title={occ.title || t('grid.noTitle')} time={fmt.time(occ.start)} color={colorOf(occ)} past={past} cancelled={occ.status === 'CANCELLED'} reply={occ.selfStatus} />
        )}
      </button>
    );
  };

  return (
    <div
      data-pager-peer={peer}
      // A month beside the one on screen sits just off it, one width to the left or right.
      className={`grid h-full ${peer === -1 ? 'absolute inset-y-0 right-full w-full' : peer === 1 ? 'absolute inset-y-0 left-full w-full' : ''}`}
      style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      inert={!!peer}
      aria-hidden={peer ? true : undefined}
    >
      {weeks.map((week, wi) => {
        const boxes = rows[wi];
        const days = visibleDays(week);
        const lanesShown = boxes.some((b) => b.lane >= maxLanes) ? maxLanes - 1 : maxLanes;
        return (
          <div key={week.toISOString()} className={`border-border-weak relative grid min-h-0 border-b last:border-b-0 ${columns}`}>
            {settings.showWeekNumbers && (
              <div className="text-text-hint flex justify-center pt-2 text-[0.625rem]" title={t('grid.weekLong', { n: weekNumber(week) })}>
                {weekNumber(week)}
              </div>
            )}
            {days.map((d) => {
              const today = isSameDay(d, now);
              const inMonth = isSameMonth(d, month);
              const isOver = (dragging?.overDay && isSameDay(dragging.overDay, d)) || (pendingRange && d >= pendingRange.start && d < pendingRange.end);
              return (
                <div
                  key={d.toISOString()}
                  data-day={peer ? undefined : d.getTime()}
                  className={`border-border-weak min-w-0 border-l first:border-l-0 ${inMonth ? '' : 'bg-bg-weak/60'} ${isOver ? 'bg-primary-weak' : ''}`}
                  onPointerDown={(e) => {
                    if (mobile || e.pointerType !== 'mouse' || e.button !== 0) return;
                    if ((e.target as HTMLElement).closest('[data-item],[data-more],[data-daynum]')) return;
                    setSelection({ anchor: d, current: d });
                  }}
                  onClick={(e) => {
                    // Phones: cells are too small to edit in place, so a tap opens the day.
                    if (mobile) {
                      goTo(d, 'day');
                      return;
                    }
                    // Mouse clicks are the zero-length case of the drag selection above.
                    if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') return;
                    if ((e.target as HTMLElement).closest('[data-item],[data-more],[data-daynum]')) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    openQuickCreate({ start: d, end: addDays(d, 1), allDay: true, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } });
                  }}
                >
                  {/* The whole strip above the chips opens the day; the number's circle inside it looks as it always did. */}
                  <button type="button" data-daynum onClick={() => goTo(d, 'day')} className={`group flex w-full justify-center focus-visible:outline-none ${mobile ? 'pt-0.5' : 'pt-1'}`}>
                    <span
                      className={`group-focus-visible:outline-primary flex items-center justify-center rounded-full px-1 text-[0.75rem] font-semibold transition-colors group-focus-visible:outline-2 group-focus-visible:outline-offset-1 ${mobile ? 'h-5 min-w-5' : 'h-6 min-w-6'} ${
                        today ? 'bg-primary text-primary-contrast' : `group-hover:bg-bg-strong ${inMonth ? '' : 'text-text-hint'}`
                      }`}
                    >
                      {d.getDate() === 1 && !mobile ? fmt.date(d, { day: 'numeric', month: 'short' }) : d.getDate()}
                    </span>
                  </button>
                </div>
              );
            })}
            {/* Event lanes overlay */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: HEADER, left: settings.showWeekNumbers ? weekCol : 0 }}>
              {boxes
                .filter((b) => b.lane < lanesShown)
                .map((b) => (
                  <div
                    key={itemKey(b.item) + wi}
                    className={`absolute ${mobile ? 'px-px' : 'px-0.5'} ${mobile || b.item.kind === 'ghost' ? 'pointer-events-none' : 'pointer-events-auto'}`}
                    style={{ left: `${(b.startCol / 7) * 100}%`, width: `${(b.span / 7) * 100}%`, top: b.lane * LANE, height: LANE - 2 }}
                  >
                    {renderItem(b, mobile)}
                  </div>
                ))}
              {days.map((d, i) => {
                const hidden = boxes.filter((b) => b.lane >= lanesShown && b.startCol <= i && b.startCol + b.span > i);
                if (!hidden.length) return null;
                const dayItems = boxes.filter((b) => b.startCol <= i && b.startCol + b.span > i).sort((a, b) => a.lane - b.lane);
                // A phone's day has room for the number only ("+2"); the full words are its name.
                const more = (
                  <button
                    type="button"
                    data-more
                    aria-label={t('grid.more', { n: hidden.length })}
                    className={`text-text-weak hover:bg-bg-strong h-full w-full truncate rounded-md text-left text-[0.6875rem] font-semibold ${mobile ? 'px-1' : 'px-1.5'}`}
                  >
                    {mobile ? `+${hidden.length}` : t('grid.more', { n: hidden.length })}
                  </button>
                );
                return (
                  <div key={i} className={`absolute ${mobile ? 'pointer-events-none px-px' : 'pointer-events-auto px-0.5'}`} style={{ left: `${(i / 7) * 100}%`, width: `${100 / 7}%`, top: lanesShown * LANE, height: LANE - 2 }}>
                    {/* A month beside the one on screen only shows the count: it never opens. */}
                    {peer ? (
                      more
                    ) : (
                      <Popover placement="bottom" trigger={more}>
                        {() => (
                          <div className="w-64 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-text-weak text-[0.6875rem] font-semibold uppercase">{fmt.weekdayShort(d)}</span>
                              <button type="button" className="hover:bg-bg-weak rounded-full px-2 text-xl font-semibold" onClick={() => goTo(d, 'day')}>
                                {d.getDate()}
                              </button>
                            </div>
                            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                              {dayItems.map((b) => (
                                <div key={itemKey(b.item)} style={{ height: LANE }}>
                                  {renderItem({ ...b, continuesBefore: false, continuesAfter: false }, false)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Popover>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});
