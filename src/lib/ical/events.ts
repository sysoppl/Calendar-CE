// Reading, expanding and modifying VEVENTs.
import ICAL from 'ical.js';
import { normalizeItemColor } from '../color';
import { readHidden, writeHidden } from '../hidden';
import { readPersistent, writePersistent } from '../persistent';
import { readSince, writeSince } from '../milestone';
import { cloneRoot, newUid, wrapCalendar, type ParsedObject } from './parse';
import { applyRecurrence, budgetExpansion, budgetRecurrence, keepsRule, readRecurrence } from './recurrence';
import { dateToIcal, nowUtc, setTextProp, setTimeProp, zoneOf } from './time';
import { buildVTimezone } from './timezone';
import type { Attendee, EditScope, EventData, EventStatus, Occurrence, PartStat } from './types';

const MAX_ITERATIONS = 20000;
const DAY_MS = 86400000;

/**
 * Series whose expansion ran out of budget or reached MAX_ITERATIONS, with
 * the start of the last instance found before that. What lies beyond stays
 * unknown rather than costing the same search again on every render.
 */
const exhausted = new WeakMap<ParsedObject, number>();

// -----------------------------------------------------------------------------
// Reading

function textValue(comp: ICAL.Component, name: string): string {
  const v = comp.getFirstPropertyValue(name);
  return v == null ? '' : String(v);
}

/** A moment as the device's clock shows it, counted as if no clock ever changed. */
function onTheClock(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
}

/** A trigger relative to the end of its event or the due time of its task (RELATED=END). */
export function relatedToEnd(trigger: ICAL.Property): boolean {
  return String(trigger.getParameter('related') ?? '').toUpperCase() === 'END';
}

/**
 * Whether the event editor shows an alarm, as `readAlarms` reads it without
 * an end: a trigger relative to the start, or one at a fixed instant. Saving
 * keeps every other one as written (applyAlarms).
 */
function editorShows(alarm: ICAL.Component): boolean {
  try {
    const trigger = alarm.getFirstProperty('trigger');
    const value = trigger?.getFirstValue();
    return value instanceof ICAL.Time || (value instanceof ICAL.Duration && !relatedToEnd(trigger!));
  } catch {
    return false;
  }
}

/**
 * Reminder offsets in minutes before `start`, and those of them that only a
 * trigger at a fixed instant set: such a reminder does not move with a
 * floating start when the device changes time zone. With `wallClock`, a fixed
 * instant counts by the clock on the wall (what the editor shows and writes
 * back), not by the hours in between, which a change of the clocks makes one
 * more or less. A trigger relative to the end counts only given `end` (an
 * instance's reminders); the editor does not show it.
 */
function readAlarms(comp: ICAL.Component, start: ICAL.Time | null, wallClock = false, end?: ICAL.Time): { offsets: number[]; fixed: number[] } {
  const relative = new Set<number>();
  const absolute = new Set<number>();
  for (const alarm of comp.getAllSubcomponents('valarm')) {
    const trigger = alarm.getFirstProperty('trigger');
    if (!trigger) continue;
    const value = trigger.getFirstValue();
    if (value instanceof ICAL.Duration) {
      if (relatedToEnd(trigger)) {
        if (end && start) relative.add(Math.round((start.toJSDate().getTime() - end.toJSDate().getTime()) / 60000 - value.toSeconds() / 60));
        continue;
      }
      relative.add(Math.round(-value.toSeconds() / 60));
    } else if (value instanceof ICAL.Time && start) {
      absolute.add(Math.round((wallClock ? onTheClock(start.toJSDate()) - onTheClock(value.toJSDate()) : start.toJSDate().getTime() - value.toJSDate().getTime()) / 60000));
    }
  }
  return {
    offsets: [...new Set([...relative, ...absolute])].sort((a, b) => a - b),
    fixed: [...absolute].filter((m) => !relative.has(m)).sort((a, b) => a - b),
  };
}

function emailOf(prop: ICAL.Property): string {
  return String(prop.getFirstValue() ?? '').replace(/^mailto:/i, '');
}

const PART_STATS: readonly PartStat[] = ['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'DELEGATED'];

/** A PARTSTAT as the app knows it: parameter values are case-insensitive, and one it does not know (an X- value, a task's) is none. */
function partStatOf(value: unknown): PartStat | undefined {
  const s = String(value ?? '').toUpperCase();
  return PART_STATS.find((p) => p === s);
}

function readAttendee(prop: ICAL.Property): Attendee {
  return {
    email: emailOf(prop),
    name: (prop.getParameter('cn') as string | undefined) ?? undefined,
    status: partStatOf(prop.getParameter('partstat')),
    role: (prop.getParameter('role') as string | undefined) ?? undefined,
  };
}

function readCategories(comp: ICAL.Component): string[] {
  return comp
    .getAllProperties('categories')
    .flatMap((p) => p.getValues().map(String))
    .filter(Boolean);
}

function readStatus(comp: ICAL.Component): EventStatus | undefined {
  const s = textValue(comp, 'status').toUpperCase();
  return s === 'CONFIRMED' || s === 'TENTATIVE' || s === 'CANCELLED' ? s : undefined;
}

/**
 * The user's reply to an invitation: the PARTSTAT of the attendee matching one
 * of their addresses. Undefined when they are not invited or are the organizer.
 */
function selfStatusOf(comp: ICAL.Component, self?: ReadonlySet<string>): PartStat | undefined {
  if (!self?.size) return undefined;
  const organizer = comp.getFirstProperty('organizer');
  if (organizer && self.has(emailOf(organizer).toLowerCase())) return undefined;
  const me = comp.getAllProperties('attendee').find((p) => self.has(emailOf(p).toLowerCase()));
  if (!me) return undefined;
  return partStatOf(me.getParameter('partstat')) ?? 'NEEDS-ACTION';
}

/** Event data for a component, optionally overriding start/end (occurrences). */
export function readEventData(comp: ICAL.Component, start?: ICAL.Time, end?: ICAL.Time): EventData {
  const ev = new ICAL.Event(comp);
  const s = start ?? ev.startDate;
  const e = end ?? ev.endDate;
  const organizer = comp.getFirstProperty('organizer');
  const colorText = textValue(comp, 'color');
  const color = normalizeItemColor(colorText);
  return {
    uid: textValue(comp, 'uid'),
    title: textValue(comp, 'summary'),
    description: textValue(comp, 'description'),
    location: textValue(comp, 'location'),
    start: s.toJSDate(),
    end: e.toJSDate(),
    allDay: s.isDate,
    timezone: zoneOf(s),
    ...readRecurrence(comp),
    // An all-day event's fixed reminder as the clock on the wall puts it: a week before at
    // midnight stays "1 week before" across a change of the clocks, also once it is edited.
    alarms: readAlarms(comp, s, s.isDate).offsets,
    status: readStatus(comp),
    busy: textValue(comp, 'transp').toUpperCase() !== 'TRANSPARENT',
    color,
    ...(colorText && !color ? { colorAsWritten: colorText } : {}),
    url: textValue(comp, 'url') || undefined,
    organizer: organizer ? readAttendee(organizer) : undefined,
    attendees: comp.getAllProperties('attendee').map(readAttendee),
    categories: readCategories(comp),
    since: readSince(comp),
    hidden: readHidden(comp),
    persistent: readPersistent(comp),
  };
}

function masterOf(root: ICAL.Component): ICAL.Component | undefined {
  return root.getAllSubcomponents('vevent').find((c) => !c.hasProperty('recurrence-id'));
}

function sameRecurrenceId(a: ICAL.Time, b: ICAL.Time): boolean {
  if (a.isDate || b.isDate) return a.year === b.year && a.month === b.month && a.day === b.day;
  return a.toJSDate().getTime() === b.toJSDate().getTime();
}

function exceptionFor(root: ICAL.Component, rid: ICAL.Time): ICAL.Component | undefined {
  return root.getAllSubcomponents('vevent').find((c) => {
    const v = c.getFirstPropertyValue('recurrence-id');
    return v instanceof ICAL.Time && sameRecurrenceId(v, rid);
  });
}

/** Rebuilds a RECURRENCE-ID time in the zone of the master's DTSTART. */
function ridTime(master: ICAL.Component, rid: string): ICAL.Time {
  const t = ICAL.Time.fromString(rid, null);
  const start = master.getFirstPropertyValue('dtstart');
  if (!t.isDate && start instanceof ICAL.Time && t.zone !== ICAL.Timezone.utcTimezone) {
    t.zone = start.zone;
  }
  return t;
}

function toOccurrence(
  obj: ParsedObject,
  comp: ICAL.Component,
  start: ICAL.Time,
  end: ICAL.Time,
  recurrenceId: ICAL.Time | undefined,
  isRecurring: boolean,
  self?: ReadonlySet<string>,
  master?: ICAL.Component,
): Occurrence {
  const s = start.toJSDate();
  let e = end.toJSDate();
  if (e <= s) e = new Date(s.getTime() + (start.isDate ? DAY_MS : 0));
  const rid = recurrenceId?.toString();
  const alarms = readAlarms(comp, start, false, end);
  return {
    key: rid ? `${obj.url}#${rid}` : obj.url,
    objectUrl: obj.url,
    calendarId: obj.calendarId,
    uid: obj.uid,
    title: textValue(comp, 'summary'),
    location: textValue(comp, 'location'),
    description: textValue(comp, 'description'),
    start: s,
    end: e,
    allDay: start.isDate,
    status: readStatus(comp),
    busy: textValue(comp, 'transp').toUpperCase() !== 'TRANSPARENT',
    color: normalizeItemColor(textValue(comp, 'color')),
    recurrenceId: rid,
    isRecurring,
    isException: comp.hasProperty('recurrence-id'),
    alarms: alarms.offsets,
    ...(alarms.fixed.length ? { fixedAlarms: alarms.fixed } : {}),
    floating: zoneOf(start) === 'floating',
    selfStatus: selfStatusOf(comp, self),
    // A series' date and choice: an override (a moved instance) does not carry its own.
    since: readSince(master ?? comp),
    hidden: readHidden(master ?? comp),
    persistent: readPersistent(master ?? comp),
  };
}

/**
 * RDATE and EXDATE values, and overrides (RECURRENCE-ID), that a series is
 * expanded with at most. Real series list some hundreds at most; ical.js
 * sorts and walks all of them at every expansion.
 */
export const MAX_SERIES_DATES = 5000;
export const MAX_SERIES_OVERRIDES = 2000;

/** The series as it is expanded, per parsed object: its VEVENTs, the master first among them. */
const expanded = new WeakMap<ParsedObject, { master: ICAL.Component; vevents: ICAL.Component[] }>();

/** The moment a listed date (a DATE, DATE-TIME or PERIOD value) or a RECURRENCE-ID stands for; NaN when it is none. */
function momentOf(value: unknown): number {
  const time = value instanceof ICAL.Period ? value.start : value;
  return time instanceof ICAL.Time ? time.toJSDate().getTime() : NaN;
}

/** How far a moment is from `now`; one that is no moment comes last. */
function distance(moment: number, now: number): number {
  return Number.isNaN(moment) ? Infinity : Math.abs(moment - now);
}

/**
 * The series to expand. One that lists more dates or overrides than any real
 * one has (MAX_SERIES_DATES, MAX_SERIES_OVERRIDES) is expanded from a copy
 * that keeps only those nearest to now (`now`, when the object is first
 * expanded): instances far away lose an exception, a listed date or the
 * changes of their override, and every other one is shown as it is. The
 * object itself, which edits write back, is never changed. Counted once per
 * parsed object.
 */
function seriesOf(obj: ParsedObject, master: ICAL.Component, vevents: ICAL.Component[], now = Date.now()): { master: ICAL.Component; vevents: ICAL.Component[] } {
  const known = expanded.get(obj);
  if (known) return known;
  const count = (comp: ICAL.Component) => ['rdate', 'exdate'].reduce((n, name) => n + comp.getAllProperties(name).reduce((m, prop) => m + prop.getValues().length, 0), 0);
  let series = { master, vevents };
  if (count(master) > MAX_SERIES_DATES || vevents.length - 1 > MAX_SERIES_OVERRIDES) {
    const root = cloneRoot(obj);
    const all = root.getAllSubcomponents('vevent');
    const copy = all.find((c) => !c.hasProperty('recurrence-id'))!;
    // Listed dates: the nearest ones stay, in the properties they were in.
    const listed: { prop: ICAL.Property; value: unknown; far: number }[] = [];
    for (const name of ['rdate', 'exdate']) {
      for (const prop of copy.getAllProperties(name)) for (const value of prop.getValues()) listed.push({ prop, value, far: distance(momentOf(value), now) });
    }
    if (listed.length > MAX_SERIES_DATES) {
      const kept = new Set(listed.slice().sort((a, b) => a.far - b.far).slice(0, MAX_SERIES_DATES));
      const values = new Map<ICAL.Property, unknown[]>();
      for (const entry of listed) {
        if (!values.has(entry.prop)) values.set(entry.prop, []);
        if (kept.has(entry)) values.get(entry.prop)!.push(entry.value);
      }
      for (const [prop, left] of values) {
        if (left.length) prop.setValues(left as never[]);
        else copy.removeProperty(prop);
      }
    }
    // Overrides: the nearest ones stay; the others' instances are the series' own again.
    let others = all.filter((c) => c !== copy);
    if (others.length > MAX_SERIES_OVERRIDES) {
      const far = new Map(others.map((c) => [c, distance(momentOf(c.getFirstPropertyValue('recurrence-id')), now)]));
      const kept = new Set(others.slice().sort((a, b) => far.get(a)! - far.get(b)!).slice(0, MAX_SERIES_OVERRIDES));
      for (const c of others) if (!kept.has(c)) root.removeSubcomponent(c);
      others = others.filter((c) => kept.has(c));
    }
    series = { master: copy, vevents: [copy, ...others] };
  }
  expanded.set(obj, series);
  return series;
}

/**
 * The one occurrence of an event that does not repeat, per parsed object and
 * the addresses it was read with: it is the same for every range, and every
 * view, the mini calendar and the reminders ask for ranges over all items.
 */
const singles = new WeakMap<ParsedObject, { self?: ReadonlySet<string>; zone: string; occ: Occurrence }>();

/**
 * The device's time zone, which a time without one (a floating time, an
 * all-day date) is read in: a cached occurrence is only good in the zone it
 * was read in. Asked at most once a second; the answer is not cheap.
 */
let zoneRead = { at: -Infinity, zone: '' };
function deviceZone(): string {
  const now = Date.now();
  if (now - zoneRead.at > 1000) {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      // Then the offset alone tells a change.
    }
    zoneRead = { at: now, zone: `${zone}|${new Date().getTimezoneOffset()}` };
  }
  return zoneRead.zone;
}

/** The same addresses: the views keep one set per account, the reminders make theirs anew each time. */
function sameAddresses(a?: ReadonlySet<string>, b?: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const address of a) if (!b.has(address)) return false;
  return true;
}

/**
 * All occurrences of an event object that overlap [rangeStart, rangeEnd).
 * `self` holds the user's own (lower-case) addresses, used to read their reply.
 */
export function expandEvent(obj: ParsedObject, rangeStart: Date, rangeEnd: Date, self?: ReadonlySet<string>): Occurrence[] {
  const overlaps = (s: Date, e: Date, allDay: boolean) =>
    s < rangeEnd && (e > rangeStart || (s.getTime() === e.getTime() && s >= rangeStart) || (allDay && s >= rangeStart));
  const zone = deviceZone();
  const known = singles.get(obj);
  if (known && known.zone === zone && sameAddresses(known.self, self)) return overlaps(known.occ.start, known.occ.end, known.occ.allDay) ? [known.occ] : [];

  let vevents = obj.root.getAllSubcomponents('vevent');
  let master = vevents.find((c) => !c.hasProperty('recurrence-id'));
  const out: Occurrence[] = [];

  if (!master) {
    // Orphaned overrides (we were invited to single instances only).
    for (const c of vevents) {
      const ev = new ICAL.Event(c);
      const occ = toOccurrence(obj, c, ev.startDate, ev.endDate, c.getFirstPropertyValue('recurrence-id') as ICAL.Time, true, self);
      if (overlaps(occ.start, occ.end, occ.allDay)) out.push(occ);
    }
    return out;
  }

  if (!master.getFirstPropertyValue('dtstart')) return out;
  const single = new ICAL.Event(master);
  if (!single.isRecurring()) {
    const occ = toOccurrence(obj, master, single.startDate, single.endDate, undefined, false, self);
    singles.set(obj, { self, zone, occ });
    if (overlaps(occ.start, occ.end, occ.allDay)) out.push(occ);
    return out;
  }
  ({ master, vevents } = seriesOf(obj, master, vevents));
  const event = new ICAL.Event(master);

  for (const c of vevents) {
    if (c !== master && c.getFirstPropertyValue('uid') === master.getFirstPropertyValue('uid')) {
      event.relateException(c);
    }
  }

  const durationMs = Math.max(0, event.endDate.toJSDate().getTime() - event.startDate.toJSDate().getTime());
  const iterator = event.iterator();
  const budget = budgetExpansion(iterator);
  // The instances found: by the moment of their RECURRENCE-ID, which an
  // override may name in UTC while the master has a TZID, or by the day of one
  // that is a date.
  const seen = new Set<string>();
  const dayOf = (rid: ICAL.Time) => `${rid.year}-${rid.month}-${rid.day}`;
  const idOf = (rid: ICAL.Time) => (rid.isDate ? dayOf(rid) : String(rid.toJSDate().getTime()));
  const stop = exhausted.get(obj) ?? Infinity;
  // Nothing is known past `stop`. A range that begins after it would only pay
  // for the walk up to there, which costs as much as it did the first time.
  const reachable = stop + durationMs + DAY_MS >= rangeStart.getTime();
  let last = -Infinity;
  let next: ICAL.Time | null;
  let n = 0;
  while (reachable && last < stop && n++ < MAX_ITERATIONS && (next = iterator.next())) {
    const nextDate = next.toJSDate();
    last = nextDate.getTime();
    if (nextDate >= rangeEnd) break;
    if (nextDate.getTime() + durationMs + DAY_MS < rangeStart.getTime()) continue;
    const details = event.getOccurrenceDetails(next);
    const comp = details.item.component;
    const occ = toOccurrence(obj, comp, details.startDate, details.endDate, details.recurrenceId, true, self, master);
    seen.add(idOf(details.recurrenceId));
    if (occ.status === 'CANCELLED' && occ.isException) continue;
    if (overlaps(occ.start, occ.end, occ.allDay)) out.push(occ);
  }
  // The instances found are real; the series is shown up to there, and not
  // searched past it again. The same goes for one that reached the most
  // instances shown of a series: nothing after them would be shown either.
  if (budget.cut || n > MAX_ITERATIONS) exhausted.set(obj, last);

  // Overrides moved into the range from an instance outside of it.
  for (const c of vevents) {
    if (c === master) continue;
    const rid = c.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
    if (!rid) continue;
    const ev = new ICAL.Event(c);
    const occ = toOccurrence(obj, c, ev.startDate, ev.endDate, rid, true, self, master);
    if (!seen.has(idOf(rid)) && !seen.has(dayOf(rid)) && occ.status !== 'CANCELLED' && overlaps(occ.start, occ.end, occ.allDay)) {
      // Only if the RRULE actually produces this instance (not EXDATE'd).
      out.push(occ);
    }
  }
  return out;
}

/**
 * Event data for editing. For 'all' scope this is the master with the
 * occurrence's own start/end so the form shows what the user clicked.
 */
export function eventDataFor(obj: ParsedObject, occ: Pick<Occurrence, 'recurrenceId' | 'start' | 'end'>): EventData {
  const master = masterOf(obj.root);
  if (occ.recurrenceId && master) {
    const exc = exceptionFor(obj.root, ridTime(master, occ.recurrenceId));
    const base = readEventData(exc ?? master);
    const { rrule, ruleAsWritten } = readRecurrence(master);
    return {
      ...base,
      rrule,
      ruleAsWritten,
      since: readSince(master),
      hidden: readHidden(master),
      persistent: readPersistent(master),
      start: occ.start,
      end: occ.end,
    };
  }
  const comp = master ?? obj.root.getFirstSubcomponent('vevent')!;
  return readEventData(comp);
}

// -----------------------------------------------------------------------------
// Writing

export type WriteOp =
  | { type: 'create'; calendarId: string; uid: string; data: string }
  | { type: 'update'; url: string; etag: string; data: string }
  | { type: 'delete'; url: string; etag: string };

/** Writes the editor's alarms; one it does not show (relative to the end, say) stays as written. */
function applyAlarms(comp: ICAL.Component, alarms: number[], title: string) {
  for (const a of comp.getAllSubcomponents('valarm')) if (editorShows(a)) comp.removeSubcomponent(a);
  for (const minutes of alarms) {
    const alarm = new ICAL.Component('valarm');
    alarm.updatePropertyWithValue('action', 'DISPLAY');
    alarm.updatePropertyWithValue('description', title || 'Reminder');
    const dur = ICAL.Duration.fromSeconds(-minutes * 60);
    alarm.updatePropertyWithValue('trigger', dur);
    comp.addSubcomponent(alarm);
  }
}

function applyAttendees(comp: ICAL.Component, data: EventData) {
  const existing = new Map(
    comp.getAllProperties('attendee').map((p) => [emailOf(p).toLowerCase(), p]),
  );
  comp.removeAllProperties('attendee');
  for (const a of data.attendees) {
    const prev = existing.get(a.email.toLowerCase());
    const prop = prev ?? new ICAL.Property('attendee');
    if (!prev) {
      prop.setValue(`mailto:${a.email}`);
      prop.setParameter('partstat', a.status ?? 'NEEDS-ACTION');
      prop.setParameter('role', a.role ?? 'REQ-PARTICIPANT');
      prop.setParameter('rsvp', 'TRUE');
    }
    if (a.name) prop.setParameter('cn', a.name);
    comp.addProperty(prop);
  }
  if (data.attendees.length && !comp.hasProperty('organizer') && data.organizer) {
    const org = new ICAL.Property('organizer');
    org.setValue(`mailto:${data.organizer.email}`);
    if (data.organizer.name) org.setParameter('cn', data.organizer.name);
    comp.addProperty(org);
  }
  if (!data.attendees.length) comp.removeAllProperties('organizer');
}

function touch(comp: ICAL.Component, bumpSequence = true) {
  const now = nowUtc();
  comp.updatePropertyWithValue('dtstamp', now);
  comp.updatePropertyWithValue('last-modified', now);
  if (bumpSequence) {
    const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0);
    comp.updatePropertyWithValue('sequence', seq + 1);
  }
}

/** Copies EventData onto a VEVENT, keeping properties we do not model. */
export function applyEventData(comp: ICAL.Component, data: EventData, opts: { rrule: boolean }) {
  setTextProp(comp, 'summary', data.title.trim());
  setTextProp(comp, 'description', data.description);
  setTextProp(comp, 'location', data.location);
  setTextProp(comp, 'url', data.url);
  // A COLOR the app cannot show stays as written until the user picks a colour or the calendar's.
  const color = data.color ?? data.colorAsWritten;
  if (color === undefined || textValue(comp, 'color') !== color) setTextProp(comp, 'color', color);
  setTextProp(comp, 'status', data.status);
  comp.updatePropertyWithValue('transp', data.busy ? 'OPAQUE' : 'TRANSPARENT');

  const tz = data.allDay ? 'floating' : data.timezone;
  setTimeProp(comp, 'dtstart', dateToIcal(data.start, tz, data.allDay));
  comp.removeAllProperties('duration');
  let end = data.end;
  if (data.allDay && end <= data.start) end = new Date(data.start.getFullYear(), data.start.getMonth(), data.start.getDate() + 1);
  setTimeProp(comp, 'dtend', dateToIcal(end, tz, data.allDay));

  // An unchanged rule, or one the editor could only show, stays as written.
  if (opts.rrule) applyRecurrence(comp, data, data.allDay);

  comp.removeAllProperties('categories');
  if (data.categories.length) {
    const prop = new ICAL.Property('categories');
    prop.setValues(data.categories);
    comp.addProperty(prop);
  }
  applyAlarms(comp, data.alarms, data.title);
  applyAttendees(comp, data);
  // A series' master carries them; updateEvent leaves them off an override of one (see `since`).
  writeSince(comp, data.since);
  writeHidden(comp, data.hidden);
  writePersistent(comp, data.persistent);
  touch(comp);
}

/** Adds VTIMEZONE definitions for every TZID referenced but not defined. */
export function addMissingTimezones(root: ICAL.Component) {
  const defined = new Set(root.getAllSubcomponents('vtimezone').map((c) => String(c.getFirstPropertyValue('tzid'))));
  const used = new Set<string>();
  const walk = (c: ICAL.Component) => {
    for (const p of c.getAllProperties()) {
      const tzid = p.getParameter('tzid');
      if (typeof tzid === 'string') used.add(tzid);
    }
    c.getAllSubcomponents().forEach(walk);
  };
  root.getAllSubcomponents().forEach(walk);
  for (const tzid of used) {
    if (defined.has(tzid)) continue;
    const block = buildVTimezone(tzid);
    if (!block) continue;
    const vtz = new ICAL.Component(ICAL.parse(block));
    // Timezones go first by convention.
    const others = [...root.getAllSubcomponents()];
    others.forEach((o) => root.removeSubcomponent(o));
    root.addSubcomponent(vtz);
    others.forEach((o) => root.addSubcomponent(o));
  }
}

function serialize(root: ICAL.Component): string {
  addMissingTimezones(root);
  return root.toString() + '\r\n';
}

/**
 * `recurrence` holds the RRULE, RDATE, EXDATE and EXRULE properties of a
 * series this event continues. They are then what `data` keeps or replaces,
 * as for an edit of a series (see applyRecurrence).
 */
export function createEventIcs(data: EventData, recurrence: ICAL.Property[] = []): string {
  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', data.uid || newUid());
  vevent.updatePropertyWithValue('created', nowUtc());
  for (const prop of recurrence) vevent.addProperty(prop);
  applyEventData(vevent, data, { rrule: true });
  vevent.updatePropertyWithValue('sequence', 0);
  return serialize(wrapCalendar(vevent));
}

function sameSince(a: Date | undefined, b: Date | undefined): boolean {
  return a?.getTime() === b?.getTime();
}

function untilBefore(occStart: ICAL.Time): Date {
  const d = occStart.toJSDate();
  return occStart.isDate ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : new Date(d.getTime() - 1000);
}

/** The override for one instance of a series, created from the master when missing. */
function ensureException(root: ICAL.Component, master: ICAL.Component, rid: ICAL.Time): ICAL.Component {
  let exc = exceptionFor(root, rid);
  if (!exc) {
    exc = ICAL.Component.fromString(master.toString());
    exc.removeAllProperties('rrule');
    exc.removeAllProperties('rdate');
    exc.removeAllProperties('exdate');
    setTimeProp(exc, 'recurrence-id', rid);
    // The copy still carries the master's dates: move it onto this instance.
    const duration = new ICAL.Event(master).duration;
    setTimeProp(exc, 'dtstart', rid.clone());
    if (exc.hasProperty('dtend')) {
      const end = rid.clone();
      end.addDuration(duration);
      setTimeProp(exc, 'dtend', end);
    }
    root.addSubcomponent(exc);
  }
  return exc;
}

/** A copy of a property as written (its jCal, plain JSON), with `values` instead of its own when given. */
function copyProperty(prop: ICAL.Property, values?: unknown[]): ICAL.Property {
  const jcal = JSON.parse(JSON.stringify(prop.toJSON())) as unknown[];
  return new ICAL.Property((values ? [...jcal.slice(0, 3), ...values] : jcal) as never);
}

/**
 * Ends the series before `rid`: every RRULE gets an UNTIL, and the dates of
 * RDATE and EXDATE from `rid` on leave the master. Those are returned, for a
 * series that continues from there.
 */
function endSeriesBefore(root: ICAL.Component, master: ICAL.Component, rid: ICAL.Time): ICAL.Property[] {
  for (const prop of master.getAllProperties('rrule')) {
    const recur = prop.getFirstValue();
    if (!(recur instanceof ICAL.Recur)) continue;
    // The rule as written, cut short: going through the editor's model of it would drop what that cannot express.
    const ended = recur.clone();
    const u = untilBefore(rid);
    ended.count = null;
    ended.until = rid.isDate
      ? ICAL.Time.fromData({ year: u.getFullYear(), month: u.getMonth() + 1, day: u.getDate(), isDate: true })
      : ICAL.Time.fromJSDate(u, true);
    prop.setValue(ended);
  }
  const cut = rid.toJSDate().getTime();
  const later: ICAL.Property[] = [];
  for (const prop of [...master.getAllProperties('rdate'), ...master.getAllProperties('exdate')]) {
    // Values as written (jCal), side by side with when each one is.
    const raw = (prop.toJSON() as unknown[]).slice(3);
    const at = prop.getValues().map((v) => (v instanceof ICAL.Period ? v.start : (v as ICAL.Time)).toJSDate().getTime());
    const after = raw.filter((_, i) => at[i] >= cut);
    if (!after.length) continue;
    later.push(copyProperty(prop, after));
    const before = raw.filter((_, i) => at[i] < cut);
    master.removeProperty(prop);
    if (before.length) master.addProperty(copyProperty(prop, before));
  }
  for (const c of root.getAllSubcomponents('vevent')) {
    const r = c.getFirstPropertyValue('recurrence-id');
    if (r instanceof ICAL.Time && r.toJSDate().getTime() >= cut) root.removeSubcomponent(c);
  }
  touch(master);
  return later;
}

/**
 * Copies of the master's RRULEs for a series that goes on from `rid`. A rule
 * with a COUNT keeps only the instances it has from `rid` on (those before
 * stay with the old series), and one with none left is not copied.
 */
function rulesFrom(master: ICAL.Component, rid: ICAL.Time): ICAL.Property[] {
  const dtstart = master.getFirstPropertyValue('dtstart');
  const cut = rid.toJSDate().getTime();
  const out: ICAL.Property[] = [];
  for (const prop of master.getAllProperties('rrule')) {
    const recur = prop.getFirstValue();
    if (!(recur instanceof ICAL.Recur) || !recur.count || !(dtstart instanceof ICAL.Time)) {
      out.push(copyProperty(prop));
      continue;
    }
    // Counted the way the series counts them: from DTSTART, EXDATEs included.
    const iter = recur.iterator(dtstart);
    budgetRecurrence([iter]);
    let before = 0;
    for (let next = iter.next(); next && next.toJSDate().getTime() < cut; next = iter.next()) before++;
    if (before >= recur.count) continue;
    const rest = recur.clone();
    rest.count = recur.count - before;
    const copy = copyProperty(prop);
    copy.setValue(rest);
    out.push(copy);
  }
  return out;
}

/** `date` moved as `from` moved to `to`: by as many days on the calendar, and as much time on the clock. */
function shiftedLike(date: Date, from: Date, to: Date): Date {
  const days = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY_MS);
  const clock = (d: Date) => ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds() + clock(to) - clock(from));
}

export function updateEvent(
  obj: ParsedObject,
  occ: Pick<Occurrence, 'recurrenceId' | 'start'>,
  data: EventData,
  scope: EditScope,
): WriteOp[] {
  const root = cloneRoot(obj);
  const master = masterOf(root);

  if (!occ.recurrenceId || !master) {
    const comp = master ?? root.getFirstSubcomponent('vevent')!;
    applyEventData(comp, data, { rrule: !comp.hasProperty('recurrence-id') });
    return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
  }

  const rid = ridTime(master, occ.recurrenceId);
  const masterStart = master.getFirstPropertyValue('dtstart') as ICAL.Time;

  if (scope === 'future' && sameRecurrenceId(rid, masterStart)) scope = 'all';

  if (scope === 'single') {
    // The override drops the copies of the master's date and choice ensureException made.
    applyEventData(ensureException(root, master, rid), { ...data, rrule: undefined, since: undefined, hidden: undefined, persistent: undefined }, { rrule: false });
    // The date counted from, hiding and persistent notifications are the series': changed on one instance, they change on all.
    const sinceChanged = !sameSince(readSince(master), data.since);
    const hiddenChanged = readHidden(master) !== !!data.hidden;
    const persistentChanged = readPersistent(master) !== !!data.persistent;
    if (sinceChanged) writeSince(master, data.since);
    if (hiddenChanged) writeHidden(master, data.hidden);
    if (persistentChanged) writePersistent(master, data.persistent);
    if (sinceChanged || hiddenChanged || persistentChanged) touch(master, false);
    return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
  }

  if (scope === 'all') {
    // Shift the series by however much the clicked instance moved: by days on
    // the calendar and time on the clock, which an instance on the other side
    // of a change of the clocks than the first one keeps as it is.
    const duration = data.end.getTime() - data.start.getTime();
    const moved = shiftedLike(masterStart.toJSDate(), occ.start, data.start);
    const newStart = data.allDay && !masterStart.isDate ? new Date(new Date(moved).setHours(0, 0, 0, 0)) : moved;
    applyEventData(master, { ...data, start: newStart, end: new Date(newStart.getTime() + duration) }, { rrule: true });
    return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
  }

  // 'future': end the current series and start a new one, which carries on
  // the recurrence as written (with its later dates) when the user left it as
  // it was. A COUNT goes on with the instances the old series did not use.
  const unchanged = !!data.rrule && keepsRule(master, data.rrule, data.allDay);
  const rules = [...rulesFrom(master, rid), ...master.getAllProperties('exrule').map((p) => copyProperty(p))];
  const later = endSeriesBefore(root, master, rid);
  const carried =
    unchanged && data.rrule && rules.length === 1 ? { ...data, rrule: { ...data.rrule, count: (rules[0].getFirstValue() as ICAL.Recur).count ?? undefined } } : data;
  const uid = newUid();
  const ops: WriteOp[] = [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
  ops.push({ type: 'create', calendarId: obj.calendarId, uid, data: createEventIcs({ ...carried, uid }, [...rules, ...later]) });
  return ops;
}

export function deleteEvent(obj: ParsedObject, occ: Pick<Occurrence, 'recurrenceId'>, scope: EditScope): WriteOp[] {
  const root = cloneRoot(obj);
  const master = masterOf(root);
  if (!occ.recurrenceId || !master || scope === 'all') {
    return [{ type: 'delete', url: obj.url, etag: obj.etag }];
  }
  const rid = ridTime(master, occ.recurrenceId);
  const masterStart = master.getFirstPropertyValue('dtstart') as ICAL.Time;
  if (scope === 'future') {
    if (sameRecurrenceId(rid, masterStart)) return [{ type: 'delete', url: obj.url, etag: obj.etag }];
    endSeriesBefore(root, master, rid);
    return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
  }
  const exc = exceptionFor(root, rid);
  if (exc) root.removeSubcomponent(exc);
  const prop = new ICAL.Property('exdate');
  const tzid = rid.isDate ? undefined : rid.zone?.tzid;
  if (tzid && tzid !== 'UTC' && tzid !== 'floating') prop.setParameter('tzid', tzid);
  prop.resetType(rid.isDate ? 'date' : 'date-time');
  prop.setValue(rid);
  master.addProperty(prop);
  touch(master);
  return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
}

/**
 * Answers an invitation by setting the user's PARTSTAT. A reply is the
 * attendee's change, so SEQUENCE (which belongs to the organizer) stays put;
 * CalDAV servers with scheduling notify the organizer from this write.
 */
export function respondToEvent(
  obj: ParsedObject,
  occ: Pick<Occurrence, 'recurrenceId'>,
  self: ReadonlySet<string>,
  status: PartStat,
  scope: EditScope,
): WriteOp[] {
  const root = cloneRoot(obj);
  const master = masterOf(root);
  const reply = (comp: ICAL.Component) => {
    for (const p of comp.getAllProperties('attendee')) {
      if (!self.has(emailOf(p).toLowerCase())) continue;
      p.setParameter('partstat', status);
      p.removeParameter('rsvp');
    }
    touch(comp, false);
  };
  if (occ.recurrenceId && master && scope === 'single') reply(ensureException(root, master, ridTime(master, occ.recurrenceId)));
  else root.getAllSubcomponents('vevent').forEach(reply);
  return [{ type: 'update', url: obj.url, etag: obj.etag, data: serialize(root) }];
}

/** Copies an event into another calendar (used for "move" and "duplicate"). */
export function duplicateEventIcs(obj: ParsedObject, keepUid: boolean): { uid: string; data: string } {
  const root = cloneRoot(obj);
  const uid = keepUid ? obj.uid : newUid();
  for (const c of root.getAllSubcomponents('vevent')) {
    c.updatePropertyWithValue('uid', uid);
    if (!keepUid) {
      c.removeAllProperties('attendee');
      c.removeAllProperties('organizer');
      touch(c, false);
    }
  }
  return { uid, data: serialize(root) };
}
