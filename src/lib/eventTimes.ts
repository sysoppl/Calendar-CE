// Date and time edits of an event form. Each function returns the fields to
// change, so the form's rules (keep the duration when the start moves, keep
// the day count of all-day events, ...) live in one tested place.
import { setMinutesOfDay } from './date';
import { localTimezone } from './ical/timezone';
import type { EventData } from './ical/types';

type Times = Pick<EventData, 'start' | 'end' | 'allDay'>;
type Patch = Partial<Pick<EventData, 'start' | 'end' | 'allDay' | 'busy' | 'timezone'>>;

// Calendar arithmetic, not 24 h steps: days are 23 or 25 hours long around DST.
const dayOf = (d: Date, add = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** All-day ends are exclusive in the data but shown inclusively. */
export function shownEnd(data: Times): Date {
  return data.allDay ? dayOf(data.end, -1) : data.end;
}

export function isRangeInvalid(data: Times): boolean {
  return data.end.getTime() < data.start.getTime() || (data.allDay && data.end.getTime() <= data.start.getTime());
}

/** Moves the start to another day; the event keeps its length. */
export function withStartDate(data: Times, date: Date): Patch {
  if (data.allDay) {
    const days = Math.max(1, Math.round((dayOf(data.end).getTime() - dayOf(data.start).getTime()) / 86400000));
    return { start: dayOf(date), end: dayOf(date, days) };
  }
  const start = setMinutesOfDay(date, minutesOf(data.start));
  return { start, end: new Date(start.getTime() + (data.end.getTime() - data.start.getTime())) };
}

/** Changes the start time; the event keeps its length. */
export function withStartTime(data: Times, minutes: number): Patch {
  const start = setMinutesOfDay(data.start, minutes);
  return { start, end: new Date(start.getTime() + (data.end.getTime() - data.start.getTime())) };
}

/** Sets the (shown, inclusive) end day. */
export function withEndDate(data: Times, date: Date): Patch {
  return { end: data.allDay ? dayOf(date, 1) : setMinutesOfDay(date, minutesOf(data.end)) };
}

export function withEndTime(data: Times, minutes: number): Patch {
  return { end: setMinutesOfDay(data.end, minutes) };
}

/**
 * Switches between an all-day and a timed event. A timed event starts at the
 * next full hour (within the working day) and lasts `durationMinutes`.
 */
export function withAllDay(data: Times & Pick<EventData, 'timezone'>, allDay: boolean, durationMinutes: number, now = new Date()): Patch {
  if (allDay) {
    const start = dayOf(data.start);
    const end = dayOf(data.end, 1);
    return { allDay, start, end: end <= start ? dayOf(start, 1) : end, busy: false };
  }
  // Capped so a late-evening switch does not roll over to the next day.
  const start = setMinutesOfDay(data.start, Math.min(23, Math.max(8, now.getHours() + 1)) * 60);
  return {
    allDay,
    start,
    end: new Date(start.getTime() + durationMinutes * 60000),
    busy: true,
    timezone: data.timezone === 'floating' ? localTimezone() : data.timezone,
  };
}

/**
 * Reads a typed time: "9", "9:30", "930", "21.15", "9 pm", "12:05am".
 * Returns minutes after midnight, or undefined when it is not a time.
 */
export function parseTime(text: string): number | undefined {
  const m = /^(\d{1,2})[:.,h]?(\d{2})?([ap])?m?$/.exec(text.toLowerCase().replace(/[\s.]+(?=[apm]|$)/g, '').replace(/\s+/g, ''));
  if (!m) return undefined;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (minutes > 59) return undefined;
  if (m[3]) {
    if (hours < 1 || hours > 12) return undefined;
    hours = (hours % 12) + (m[3] === 'p' ? 12 : 0);
  } else if (hours > 23) return undefined;
  return hours * 60 + minutes;
}
