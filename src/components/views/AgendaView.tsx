import { useMemo, useRef } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { MapPin, Repeat, CalendarX2, Check } from 'lucide-react';
import { useCalendarMap, useOccurrences, useTasks } from '@/hooks/useCalendarData';
import { useFormat } from '@/hooks/useFormat';
import { useNow } from '@/hooks/useNow';
import { usePeriodTransition } from '@/hooks/usePeriodTransition';
import { isSameDay, viewRange } from '@/lib/date';
import { openEditTask, toggleTask } from '@/lib/actions';
import { taskItemKey, tasksInRange } from '@/lib/ical/tasks';
import type { Occurrence, Task } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { EventDot } from './EventChip';
import { DEFAULT_TASK_COLOR, calendarColor, eventColor, readableText } from '@/lib/color';

type Row = { kind: 'event'; occ: Occurrence } | { kind: 'task'; task: Task };

export function AgendaView() {
  const t = useT();
  const fmt = useFormat();
  const now = useNow();
  const date = useUi((s) => s.date);
  const openPopover = useUi((s) => s.openPopover);
  const goTo = useUi((s) => s.goTo);
  const settings = useSettings();
  const range = useMemo(() => viewRange('agenda', date, settings.weekStartsOn), [date, settings.weekStartsOn]);
  const occurrences = useOccurrences(range);
  const tasks = useTasks();
  const calendars = useCalendarMap();
  const list = useRef<HTMLDivElement>(null);
  // Another stretch of days fades in.
  usePeriodTransition([list], range.start.getTime(), 'fade');

  const groups = useMemo(() => {
    const map = new Map<number, Row[]>();
    const push = (day: Date, row: Row) => {
      const k = startOfDay(day).getTime();
      map.set(k, [...(map.get(k) ?? []), row]);
    };
    for (const occ of occurrences) {
      // Multi-day events are listed on each day they cover within the range.
      let d = occ.start < range.start ? range.start : startOfDay(occ.start);
      let guard = 0;
      do {
        push(d, { kind: 'event', occ });
        d = addDays(d, 1);
      } while (d < occ.end && d < range.end && guard++ < 60);
    }
    if (settings.showTasksInCalendar) {
      for (const task of tasksInRange(tasks, range.start, range.end, settings.showCompletedTasks)) push(task.due!, { kind: 'task', task });
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [occurrences, tasks, range, settings.showTasksInCalendar, settings.showCompletedTasks]);

  if (!groups.length) {
    return (
      <div ref={list} data-pager className="text-text-weak flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarX2 size={48} strokeWidth={1.25} className="text-text-hint" />
        <p>{t('grid.agendaEmpty')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      {/* At the bottom on a phone, room for the last day to scroll out from under the new-event button. */}
      <div ref={list} data-pager className="mx-auto max-w-3xl px-3 pt-2 pb-20 sm:px-6 sm:pb-2">
        {groups.map(([k, rows]) => {
          const day = new Date(k);
          const today = isSameDay(day, now);
          return (
            <section key={k} className="border-border-weak flex gap-4 border-b py-3 last:border-b-0">
              <button type="button" onClick={() => goTo(day, 'day')} className="flex w-14 shrink-0 flex-col items-center gap-0.5 self-start pt-0.5 sm:w-24 sm:flex-row sm:gap-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl font-semibold ${today ? 'bg-primary text-primary-contrast' : ''}`}
                >
                  {day.getDate()}
                </span>
                <span className={`flex flex-col text-[0.6875rem] leading-tight font-semibold uppercase max-sm:items-center ${today ? 'text-primary' : 'text-text-weak'}`}>
                  <span>{fmt.weekdayShort(day)}</span>
                  <span className="font-normal">{fmt.date(day, { month: 'short' }).replace('.', '')}</span>
                </span>
              </button>
              <ul className="min-w-0 flex-1">
                {rows.map((row) => {
                  if (row.kind === 'task') {
                    // A task reads like an event: a ring where an event has its dot (ticked off when done), the time, the title.
                    const task = row.task;
                    const c = calendarColor(calendars.get(task.calendarId)?.color ?? DEFAULT_TASK_COLOR, DEFAULT_TASK_COLOR);
                    return (
                      <li key={taskItemKey(task)} data-agenda-task className="hover:bg-bg-weak flex items-start gap-3 rounded-lg px-2 py-2">
                        {/* The ring ticks the task off; its hit area reaches beyond it (44 px for a finger). */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={task.completed}
                          aria-label={task.title || t('grid.noTitle')}
                          onClick={() => void toggleTask(task)}
                          className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-2 pointer-coarse:after:-inset-[17px]"
                          style={{ boxShadow: `inset 0 0 0 1.5px ${c}`, background: task.completed ? c : 'transparent' }}
                        >
                          {task.completed && <Check size={7} strokeWidth={4} color={readableText(c)} />}
                        </button>
                        <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openEditTask(task)}>
                          <span className="text-text-weak w-[5.5rem] shrink-0 pt-px text-[0.8125rem] tabular-nums sm:w-28">{task.dueAllDay ? '' : fmt.time(task.due!)}</span>
                          <span className={`block min-w-0 flex-1 truncate font-semibold ${task.completed ? 'text-text-weak line-through' : ''}`}>{task.title || t('grid.noTitle')}</span>
                        </button>
                      </li>
                    );
                  }
                  const occ = row.occ;
                  const color = eventColor(occ.color, calendars.get(occ.calendarId)?.color);
                  const declined = occ.selfStatus === 'DECLINED';
                  // Past ones keep their contrast: weaker text, not faded out.
                  const past = (settings.dimPastEvents && occ.end < now) || declined;
                  const multiDay = !isSameDay(occ.start, new Date(occ.end.getTime() - 1));
                  let time: string;
                  if (occ.allDay) time = t('grid.allDay');
                  else if (multiDay && !isSameDay(occ.start, day)) time = isSameDay(new Date(occ.end.getTime() - 1), day) ? `– ${fmt.time(occ.end)}` : t('grid.allDay');
                  else if (multiDay) time = `${fmt.time(occ.start)} –`;
                  else time = fmt.timeRange(occ.start, occ.end);
                  return (
                    <li key={occ.key + k}>
                      <button
                        type="button"
                        className="hover:bg-bg-weak flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          openPopover({ occurrence: occ, anchor: { x: r.left, y: r.top, width: Math.min(r.width, 320), height: r.height } });
                        }}
                      >
                        <EventDot color={color} reply={occ.selfStatus} className="mt-1.5 h-2.5 w-2.5" />
                        <span className="text-text-weak w-[5.5rem] shrink-0 pt-px text-[0.8125rem] tabular-nums sm:w-28">{time}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-semibold ${past ? 'text-text-weak' : ''} ${occ.status === 'CANCELLED' || declined ? 'line-through' : ''}`}>
                            {occ.title || t('grid.noTitle')}
                            {occ.isRecurring && <Repeat size={12} className="text-text-hint ml-1.5 inline-block" />}
                          </span>
                          {occ.location && (
                            <span className="text-text-weak flex items-center gap-1 truncate text-[0.8125rem]">
                              <MapPin size={12} className="shrink-0" />
                              <span className="truncate">{occ.location}</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
