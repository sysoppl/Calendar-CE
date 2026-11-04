// Date helpers for views and formatting.
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  getISOWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import type { ViewType } from '@/store/settings';

export type WeekStart = 0 | 1 | 6;

export interface Range {
  start: Date;
  end: Date;
}

/** The days `view` shows around `date`. A week is seven days on every screen. */
export function viewRange(view: ViewType, date: Date, weekStartsOn: WeekStart, customDays = 4): Range {
  switch (view) {
    case 'day':
      return { start: startOfDay(date), end: addDays(startOfDay(date), 1) };
    case 'days':
      return { start: startOfDay(date), end: addDays(startOfDay(date), customDays) };
    case 'week': {
      const start = startOfWeek(date, { weekStartsOn });
      return { start, end: addDays(start, 7) };
    }
    case 'month': {
      const start = startOfWeek(startOfMonth(date), { weekStartsOn });
      const end = addDays(endOfWeek(endOfMonth(date), { weekStartsOn }), 1);
      return { start: startOfDay(start), end: startOfDay(end) };
    }
    case 'year':
      return { start: startOfYear(date), end: addYears(startOfYear(date), 1) };
    case 'agenda':
      return { start: startOfDay(date), end: addDays(startOfDay(date), 60) };
  }
}

/** A date in the period before (-1) or after (1) the one `view` shows around `date`. */
export function stepDate(view: ViewType, date: Date, dir: 1 | -1, customDays = 4): Date {
  switch (view) {
    case 'day':
      return addDays(date, dir);
    case 'days':
      return addDays(date, customDays * dir);
    case 'week':
      return addWeeks(date, dir);
    case 'month':
      return addMonths(date, dir);
    case 'year':
      return addYears(date, dir);
    case 'agenda':
      return addDays(date, 30 * dir);
  }
}

export function daysInRange(range: Range): Date[] {
  const out: Date[] = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekNumber(d: Date): number {
  return getISOWeek(d);
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function minutesOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Wall-clock minutes from midnight of `day` to `t` (negative before, above
 * 1440 after). Unlike elapsed time this stays aligned with the hour grid on
 * days when the clocks change.
 */
export function wallMinutes(t: Date, day: Date): number {
  return differenceInCalendarDays(t, day) * 1440 + minutesOfDay(t) + t.getSeconds() / 60;
}

export function setMinutesOfDay(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d;
}

export function roundToStep(minutes: number, step = 15) {
  return Math.round(minutes / step) * step;
}

/** Next round half hour from now, used for new events. */
export function nextSlot(from = new Date(), step = 30): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m - (m % step) + step);
  return d;
}
