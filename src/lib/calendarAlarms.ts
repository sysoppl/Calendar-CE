// Default notifications per calendar. A calendar can have notifications of
// its own for events with a time and for all-day events; a kind it has none
// for follows the general defaults (Settings → General: `defaultAlarms`,
// `defaultAllDayAlarms`). They fill in the notifications of a new event in
// that calendar (the event editor and Quick Create). Existing items, tasks
// (which have no default notifications) and imported items never get any.
//
// They are kept in this device's settings (`calendarAlarms`, by calendar id),
// and go when their calendar is deleted or its account removed here.
import { useSettings, type CalendarAlarms, type Settings } from '@/store/settings';

export type { CalendarAlarms };
export type CalendarAlarmsMap = Record<string, CalendarAlarms>;
export type AlarmKind = 'timed' | 'allDay';

/** More notifications than this in one default is not a choice anybody makes; the rest is left out. */
export const MAX_ALARMS = 20;
/** More calendars with defaults of their own than this is not a person's list; the rest is left out. */
export const MAX_CALENDARS = 200;
/** A calendar id is an account id, `|` and an address of at most 4 KiB (store/data.ts). */
const MAX_ID = 4200;
/** Ten years, either way: further than any trigger means anything. */
const MAX_MINUTES = 10 * 366 * 1440;

/**
 * A list of notifications as kept: whole minutes (a number typed past ten
 * years is held at that), each once, in ascending order (as the editor keeps
 * them); undefined when it is not a list of numbers.
 */
export function cleanAlarmList(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || !value.every((m) => typeof m === 'number' && Number.isFinite(m))) return undefined;
  const minutes = (value as number[]).map((m) => Math.max(-MAX_MINUTES, Math.min(MAX_MINUTES, Math.round(m))));
  return [...new Set(minutes)].sort((a, b) => a - b).slice(0, MAX_ALARMS);
}

/** One calendar's defaults as kept: only the kinds it has, valid; undefined when it has none. */
export function cleanEntry(value: unknown): CalendarAlarms | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const timed = cleanAlarmList(v.timed);
  const allDay = cleanAlarmList(v.allDay);
  if (!timed && !allDay) return undefined;
  return { ...(timed ? { timed } : {}), ...(allDay ? { allDay } : {}) };
}

/**
 * The whole map as kept: valid entries only, ids in order, so that one set of
 * defaults always reads the same. Whatever does not read right (a damaged
 * store) is left out, never taken half.
 */
export function cleanCalendarAlarms(value: unknown): CalendarAlarmsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: CalendarAlarmsMap = {};
  const ids = Object.keys(value)
    .filter((id) => id.length > 0 && id.length <= MAX_ID && id.includes('|'))
    .sort();
  for (const id of ids) {
    if (Object.keys(out).length >= MAX_CALENDARS) break;
    const entry = cleanEntry((value as Record<string, unknown>)[id]);
    if (entry) out[id] = entry;
  }
  return out;
}

/** What `calendarId` has of its own; an empty object when nothing. */
export function calendarAlarmsOf(calendarId: string | undefined, settings: Pick<Settings, 'calendarAlarms'> = useSettings.getState()): CalendarAlarms {
  if (!calendarId) return {};
  const map = settings.calendarAlarms;
  const own = map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, calendarId) ? cleanEntry(map[calendarId]) : undefined;
  return own ?? {};
}

/** The general default of one kind (Settings → General). */
export function generalAlarms(allDay: boolean, settings: Pick<Settings, 'defaultAlarms' | 'defaultAllDayAlarms'> = useSettings.getState()): number[] {
  const list = allDay ? settings.defaultAllDayAlarms : settings.defaultAlarms;
  return Array.isArray(list) ? [...list] : [];
}

/**
 * The notifications a new event in `calendarId` starts with: the calendar's
 * own for its kind (timed or all-day), else the general default. A copy,
 * which the caller may change.
 */
export function defaultAlarmsFor(
  calendarId: string | undefined,
  allDay: boolean,
  settings: Pick<Settings, 'calendarAlarms' | 'defaultAlarms' | 'defaultAllDayAlarms'> = useSettings.getState(),
): number[] {
  const own = calendarAlarmsOf(calendarId, settings)[allDay ? 'allDay' : 'timed'];
  return own ? [...own] : generalAlarms(allDay, settings);
}

/** Whether two lists of notifications are the same, whatever their order. */
export function sameAlarms(a: readonly number[], b: readonly number[]): boolean {
  const x = [...new Set(a)].sort((p, q) => p - q);
  const y = [...new Set(b)].sort((p, q) => p - q);
  return x.length === y.length && x.every((m, i) => m === y[i]);
}

/** `map` with `calendarId`'s defaults set to `entry` (an empty entry removes them). Pure. */
export function withCalendarAlarms(map: CalendarAlarmsMap | undefined, calendarId: string, entry: CalendarAlarms): CalendarAlarmsMap {
  const rest = { ...cleanCalendarAlarms(map) };
  delete rest[calendarId];
  const clean = cleanEntry(entry);
  return cleanCalendarAlarms(clean ? { ...rest, [calendarId]: clean } : rest);
}

/** `map` without the calendars `gone` names; the same object when there were none. Pure. */
export function withoutCalendarAlarms<T extends CalendarAlarmsMap | undefined>(map: T, gone: (calendarId: string) => boolean): T {
  if (!map || typeof map !== 'object') return map;
  const ids = Object.keys(map);
  if (!ids.some(gone)) return map;
  return Object.fromEntries(Object.entries(map).filter(([id]) => !gone(id))) as T;
}

/**
 * Removes the defaults of the calendars `gone` names, when there are any
 * (a calendar was deleted, or its account removed).
 */
export function dropCalendarAlarms(gone: (calendarId: string) => boolean): void {
  const settings = useSettings.getState();
  const next = withoutCalendarAlarms(settings.calendarAlarms, gone);
  if (next !== settings.calendarAlarms) settings.update({ calendarAlarms: next });
}

/**
 * Gives calendars the defaults of the ones they were copied or moved from
 * (`[from, to]`), where the one they go to has none of its own.
 */
export function carryCalendarAlarms(pairs: [from: string, to: string][]): void {
  const settings = useSettings.getState();
  let map = settings.calendarAlarms;
  for (const [from, to] of pairs) {
    const own = calendarAlarmsOf(from, { calendarAlarms: map });
    if (from === to || (!own.timed && !own.allDay) || Object.keys(calendarAlarmsOf(to, { calendarAlarms: map })).length) continue;
    map = withCalendarAlarms(map, to, own);
  }
  if (map !== settings.calendarAlarms) settings.update({ calendarAlarms: map });
}
