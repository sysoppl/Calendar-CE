export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  /** Weekly: ['MO','WE']; monthly by position: ['2TU'] or ['-1FR']. */
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  until?: Date;
}

export type WrittenFreq = RecurrenceFreq | 'HOURLY' | 'MINUTELY' | 'SECONDLY';

/** One RRULE as written, enough to describe it. */
export interface WrittenRule {
  freq: WrittenFreq;
  interval: number;
  count?: number;
  until?: Date;
  /** The BY parts by name, as written: { BYDAY: ['MO', 'TU'], BYSETPOS: [-1] }. */
  by: Partial<Record<string, (string | number)[]>>;
}

/**
 * A recurrence the editors cannot show in full: a rule with parts they have
 * no control for (BYSETPOS, BYHOUR, ordinals on several days, ...), an HOURLY
 * or finer one, several RRULEs, extra dates (RDATE) or an EXRULE. The editors
 * show it read-only and a save leaves it as written; only choosing another
 * repeat option replaces it.
 */
export interface RuleAsWritten {
  rules: WrittenRule[];
  /** RDATEs add dates to the series. */
  extraDates: boolean;
  /** An EXRULE takes dates out by a rule of its own. */
  excludeRules: boolean;
}

export type PartStat = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'DELEGATED';

export interface Attendee {
  email: string;
  name?: string;
  status?: PartStat;
  role?: string;
}

export type EventStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';

/** Editable representation of an event (or a single occurrence of one). */
export interface EventData {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** IANA zone the event is anchored to; 'floating' for floating times. */
  timezone: string;
  rrule?: RecurrenceRule;
  /** Set instead of `rrule` for a recurrence the editor cannot show; `rrule`, when set, replaces it. */
  ruleAsWritten?: RuleAsWritten;
  /** Reminder offsets in minutes before the start. */
  alarms: number[];
  status?: EventStatus;
  busy: boolean;
  /** The event's own colour, as `normalizeItemColor` lets it through. */
  color?: string;
  /**
   * A COLOR the app cannot show (another client's notation), exactly as
   * written. Only a save reads it: it stays on the event while `color` is
   * unset. Never shown or put into CSS.
   */
  colorAsWritten?: string;
  url?: string;
  organizer?: Attendee;
  attendees: Attendee[];
  categories: string[];
}

export interface Occurrence {
  /** Unique per rendered instance: object URL + recurrence id. */
  key: string;
  objectUrl: string;
  calendarId: string;
  uid: string;
  title: string;
  location: string;
  description: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status?: EventStatus;
  busy: boolean;
  color?: string;
  /** ICAL string of the RECURRENCE-ID for recurring instances. */
  recurrenceId?: string;
  isRecurring: boolean;
  isException: boolean;
  /** Reminder offsets in minutes before the start. */
  alarms: number[];
  /** Those of `alarms` that a trigger at a fixed instant set: they stay put when the start moves. */
  fixedAlarms?: number[];
  /**
   * The start names no zone (an all-day date, or a time without TZID or UTC),
   * so it is wall-clock time wherever the device is.
   */
  floating: boolean;
  /** The user's own reply when they are an invited attendee (not the organizer). */
  selfStatus?: PartStat;
}

export type TaskStatus = 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED';

export interface TaskData {
  uid: string;
  title: string;
  description: string;
  due?: Date;
  dueAllDay: boolean;
  start?: Date;
  completed: boolean;
  completedAt?: Date;
  status: TaskStatus;
  /** 0 = undefined, 1 = highest, 9 = lowest (RFC 5545). */
  priority: number;
  percent: number;
  categories: string[];
  parentUid?: string;
  rrule?: RecurrenceRule;
  /** Set instead of `rrule` for a recurrence the editor cannot show; `rrule`, when set, replaces it. */
  ruleAsWritten?: RuleAsWritten;
  alarms: number[];
  created?: Date;
  modified?: Date;
}

export interface Task extends TaskData {
  objectUrl: string;
  calendarId: string;
  etag: string;
  isRecurring: boolean;
  /** The due date or time names no zone, so it is wall-clock time wherever the device is. */
  dueFloating?: boolean;
  /** The zone its start (or, without one, its due time) is written in: where its rule repeats. None for all-day tasks. */
  zone?: string;
  /**
   * Set on a later date of a repeating task as the calendar shows it (`due` is
   * that date): the task itself, which is due first.
   */
  upcomingOf?: Task;
}

export type EditScope = 'single' | 'future' | 'all';
