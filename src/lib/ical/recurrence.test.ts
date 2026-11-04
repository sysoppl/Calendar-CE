import ICAL from 'ical.js';
import { describe, expect, it, vi } from 'vitest';
import { createEventIcs, deleteEvent, eventDataFor, expandEvent, updateEvent, type WriteOp } from './events';
import { parseObject, type ParsedObject } from './parse';
import { detectPreset, presetRule, readRecurrence, recurToString } from './recurrence';
import { readTask, setTaskCompleted, updateTaskIcs } from './tasks';
import type { EventData, RecurrenceRule } from './types';

const parse = (data: string, url = 'https://x.test/cal/a.ics') => parseObject({ url, etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') })!;

/** A series from 5 January 2026, 9:00 in Warsaw, with `lines` (RRULE, RDATE, EXDATE, ...) in it. */
const series = (...lines: string[]) =>
  parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:written
DTSTART;TZID=Europe/Warsaw:20260105T090000
DTEND;TZID=Europe/Warsaw:20260105T100000
${lines.join('\n')}
SUMMARY:Review
END:VEVENT
END:VCALENDAR`);

const Q1: [Date, Date] = [new Date(2026, 0, 1), new Date(2026, 3, 1)];
const days = (obj: ParsedObject) => expandEvent(obj, ...Q1).map((o) => `${o.start.getMonth() + 1}/${o.start.getDate()}`);
/** The object a write leaves behind. */
function written(op: WriteOp) {
  if (op.type === 'delete') throw new Error('The write deletes the object');
  return parse(op.data);
}
/** The VEVENT's lines, ended by \n only so that `$` in a regular expression finds the end of one. */
const eventPart = (obj: ParsedObject) => obj.data.slice(obj.data.indexOf('BEGIN:VEVENT')).replace(/\r/g, '');

/** Saves `change` over the first instance for all events, as the editor does after the scope question. */
function saveAll(obj: ParsedObject, change: (data: EventData) => EventData) {
  const [occ] = expandEvent(obj, ...Q1);
  const [op] = updateEvent(obj, occ, change(eventDataFor(obj, occ)), 'all');
  return written(op);
}

const LAST_WORK_DAY = 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1';

describe('recurrences the editors cannot show', () => {
  it.each([
    ['BYSETPOS', LAST_WORK_DAY],
    ['HOURLY', 'RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=8'],
    ['BYHOUR', 'RRULE:FREQ=DAILY;BYHOUR=9,17'],
    ['ordinals on several days', 'RRULE:FREQ=MONTHLY;BYDAY=1MO,3WE'],
    ['a WKST that changes the dates', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU'],
    // FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5 is the yearly preset from 5 January (see below).
    ['BYMONTH', 'RRULE:FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=5'],
    ['two days of the month', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=5,20'],
    ['extra dates', 'RRULE:FREQ=WEEKLY;COUNT=3', 'RDATE;TZID=Europe/Warsaw:20260302T090000'],
    ['only extra dates', 'RDATE;TZID=Europe/Warsaw:20260302T090000,20260316T090000'],
    ['two rules', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=5', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=20'],
  ])('reads one with %s as written, not as a simpler rule', (_, ...lines) => {
    const data = eventDataFor(series(...lines), { start: new Date(2026, 0, 5, 9), end: new Date(2026, 0, 5, 10), recurrenceId: '2026-01-05T09:00:00' });
    expect(data.rrule).toBeUndefined();
    expect(data.ruleAsWritten).toBeDefined();
  });

  it.each([
    ['a weekly rule on two days', 'FREQ=WEEKLY;BYDAY=MO,TH'],
    ['a WKST that changes nothing', 'FREQ=WEEKLY;BYDAY=MO;WKST=SU'],
    ['the n-th weekday of the month', 'FREQ=MONTHLY;BYDAY=1MO;COUNT=3'],
    ['a day of the month', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5;UNTIL=20261231T225959Z'],
  ])('reads %s as a rule the editor shows', (_, rule) => {
    const data = eventDataFor(series(`RRULE:${rule}`), { start: new Date(2026, 0, 5, 9), end: new Date(2026, 0, 5, 10), recurrenceId: '2026-01-05T09:00:00' });
    expect(data.rrule).toBeDefined();
    expect(data.ruleAsWritten).toBeUndefined();
  });

  it('a series with BYSETPOS keeps its rule and EXDATEs when only the title changes', () => {
    const obj = series(LAST_WORK_DAY, 'EXDATE;TZID=Europe/Warsaw:20260227T090000');
    expect(days(obj)).toEqual(['1/30', '3/31']);
    const edited = saveAll(obj, (d) => ({ ...d, title: 'Monthly review' }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1$/m);
    expect(eventPart(edited)).toMatch(/^EXDATE;TZID=Europe\/Warsaw:20260227T090000$/m);
    expect(days(edited)).toEqual(['1/30', '3/31']);
  });

  it.each([
    ['BYSETPOS', [LAST_WORK_DAY, 'EXDATE;TZID=Europe/Warsaw:20260227T090000']],
    ['HOURLY', ['RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=8']],
    ['extra dates', ['RRULE:FREQ=WEEKLY;COUNT=3', 'RDATE;TZID=Europe/Warsaw:20260302T090000']],
    ['only extra dates', ['RDATE;TZID=Europe/Warsaw:20260302T090000']],
  ])('"Does not repeat" removes a recurrence with %s', (_, lines) => {
    const edited = saveAll(series(...lines), (d) => ({ ...d, rrule: undefined, ruleAsWritten: undefined }));
    expect(eventPart(edited)).not.toMatch(/^(RRULE|RDATE|EXDATE|EXRULE)/m);
    expect(days(edited)).toEqual(['1/5']);
  });

  it.each([
    ['BYSETPOS', [LAST_WORK_DAY, 'EXDATE;TZID=Europe/Warsaw:20260126T090000']],
    ['HOURLY', ['RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=8']],
    ['extra dates', ['RDATE;TZID=Europe/Warsaw:20260302T090000', 'EXRULE:FREQ=MONTHLY']],
  ])('"Weekly" replaces a recurrence with %s', (_, lines) => {
    const edited = saveAll(series(...lines), (d) => ({ ...d, rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO'], count: 4 } }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO$/m);
    expect(eventPart(edited)).not.toMatch(/BYSETPOS|HOURLY|^RDATE|^EXRULE/m);
    // A date taken out of the series stays out, as it does when any rule changes.
    expect(days(edited)).toEqual(lines[1]?.includes('20260126') ? ['1/5', '1/12', '1/19'] : ['1/5', '1/12', '1/19', '1/26']);
  });

  // ical.js leaves DTSTART out of a series made of RDATEs only.
  it('leaves a new event made from an instance without the recurrence (a copy of one instance)', () => {
    const obj = series(LAST_WORK_DAY);
    const [occ] = expandEvent(obj, ...Q1);
    const copy = parse(createEventIcs({ ...eventDataFor(obj, occ), uid: 'copy', rrule: undefined }), 'https://x.test/cal/copy.ics');
    expect(eventPart(copy)).not.toMatch(/^(RRULE|RDATE|EXDATE)/m);
    expect(days(copy)).toEqual(['1/30']);
  });

  it('keeps a series made of extra dates on a title edit', () => {
    const obj = series('RDATE;TZID=Europe/Warsaw:20260302T090000,20260316T090000');
    expect(days(obj)).toEqual(['3/2', '3/16']);
    expect(days(saveAll(obj, (d) => ({ ...d, title: 'Visit' })))).toEqual(['3/2', '3/16']);
  });

  it('turns UNTIL of a rule kept as written into a date when the series becomes all-day', () => {
    const obj = series('RRULE:FREQ=DAILY;BYHOUR=9,17;UNTIL=20260107T120000Z');
    const edited = saveAll(obj, (d) => ({ ...d, allDay: true, start: new Date(2026, 0, 5), end: new Date(2026, 0, 6) }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=DAILY;BYHOUR=9,17;UNTIL=20260107$/m);
  });

  it('"this and following" carries the later extra and deleted dates over to the new series', () => {
    const obj = series('RRULE:FREQ=WEEKLY;UNTIL=20260210T120000Z', 'RDATE;TZID=Europe/Warsaw:20260107T090000,20260301T090000', 'EXDATE;TZID=Europe/Warsaw:20260126T090000');
    expect(days(obj)).toEqual(['1/5', '1/7', '1/12', '1/19', '2/2', '2/9', '3/1']);
    const occs = expandEvent(obj, ...Q1);
    const third = occs.find((o) => o.start.getDate() === 12)!;
    const [old, fresh] = updateEvent(obj, third, { ...eventDataFor(obj, third), title: 'Later' }, 'future');
    expect(days(written(old))).toEqual(['1/5', '1/7']);
    const next = parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics');
    expect(expandEvent(next, ...Q1).map((o) => [`${o.start.getMonth() + 1}/${o.start.getDate()}`, o.title])).toEqual([
      ['1/12', 'Later'],
      ['1/19', 'Later'],
      ['2/2', 'Later'],
      ['2/9', 'Later'],
      ['3/1', 'Later'],
    ]);
  });

  it('a deleted instance stays deleted in the new series of a "this and following" edit of a plain weekly series', () => {
    const obj = series('RRULE:FREQ=WEEKLY;UNTIL=20260203T120000Z', 'EXDATE;TZID=Europe/Warsaw:20260126T090000');
    const second = expandEvent(obj, ...Q1)[1];
    const [, fresh] = updateEvent(obj, second, { ...eventDataFor(obj, second), title: 'Later' }, 'future');
    expect(days(parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics'))).toEqual(['1/12', '1/19', '2/2']);
  });

  it.each([
    ['a weekly rule the editor shows', ['RRULE:FREQ=WEEKLY;COUNT=6', 'EXDATE;TZID=Europe/Warsaw:20260202T090000'], 'RRULE:FREQ=WEEKLY;COUNT=4'],
    ['a BYSETPOS rule', [`${LAST_WORK_DAY};COUNT=6`], 'RRULE:FREQ=MONTHLY;COUNT=4;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'],
  ])('"this and following" of %s with a COUNT leaves the series as long as it was', (_, lines, rest) => {
    const YEAR: [Date, Date] = [new Date(2026, 0, 1), new Date(2027, 0, 1)];
    const obj = series(...lines);
    const before = expandEvent(obj, ...YEAR);
    const third = before[2];
    const [old, fresh] = updateEvent(obj, third, { ...eventDataFor(obj, third), title: 'Later' }, 'future');
    const next = parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics');
    const after = [...expandEvent(written(old), ...YEAR), ...expandEvent(next, ...YEAR)];
    expect(after.map((o) => o.start)).toEqual(before.map((o) => o.start));
    expect(eventPart(next)).toMatch(new RegExp(`^${rest}$`, 'm'));
    expect(eventPart(next).match(/^RRULE/gm)).toHaveLength(1);
  });

  it('"this and following" of two rules with a COUNT leaves out the one that is used up', () => {
    // From Monday 5 January: daily twice, and four Thursdays, the first on 8 January (counted as ical.js counts them).
    const obj = series('RRULE:FREQ=DAILY;COUNT=2', 'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=4');
    const thursday = { recurrenceId: '2026-01-08T09:00:00', start: new Date(2026, 0, 8, 9), end: new Date(2026, 0, 8, 10) };
    const [, fresh] = updateEvent(obj, thursday, { ...eventDataFor(obj, thursday), title: 'Later' }, 'future');
    // ical.js stops at the end of the first rule that ends, so this is read from the text.
    const next = eventPart(parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics'));
    expect(next.match(/^RRULE.*$/gm)).toEqual(['RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=TH']);
  });

  it('"this and following" with a changed rule starts the new series with that rule and its own COUNT', () => {
    const obj = series('RRULE:FREQ=WEEKLY;COUNT=6');
    const third = expandEvent(obj, ...Q1)[2];
    const [, fresh] = updateEvent(obj, third, { ...eventDataFor(obj, third), rrule: { freq: 'DAILY', interval: 1, count: 3 } }, 'future');
    expect(eventPart(parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics'))).toMatch(/^RRULE:FREQ=DAILY;COUNT=3$/m);
  });

  it('"delete this and following" ends every rule and drops the later extra dates', () => {
    const obj = series('RRULE:FREQ=MONTHLY;BYMONTHDAY=5', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=20', 'RDATE;TZID=Europe/Warsaw:20260310T090000');
    expect(days(obj)).toEqual(['1/5', '1/20', '2/5', '2/20', '3/5', '3/10', '3/20']);
    const feb = expandEvent(obj, ...Q1)[2];
    const [op] = deleteEvent(obj, feb, 'future');
    // ical.js stops at the end of the first rule that ends, so this is read from the text.
    const ended = eventPart(written(op));
    expect(ended).toMatch(/^RRULE:FREQ=MONTHLY;BYMONTHDAY=5;UNTIL=20260205T075959Z$/m);
    expect(ended).toMatch(/^RRULE:FREQ=MONTHLY;BYMONTHDAY=20;UNTIL=20260205T075959Z$/m);
    expect(ended).not.toMatch(/^RDATE/m);
  });

  it('"delete this and following" of a series made of extra dates removes those dates', () => {
    const obj = series('RDATE;TZID=Europe/Warsaw:20260302T090000,20260316T090000');
    const [op] = deleteEvent(obj, expandEvent(obj, ...Q1)[1], 'future');
    expect(days(written(op))).toEqual(['3/2']);
    expect(eventPart(written(op))).toMatch(/^RDATE;TZID=Europe\/Warsaw:20260302T090000$/m);
  });
});

describe('task recurrences the editor cannot show', () => {
  const task = (rule: string) =>
    parse(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:t-written
SUMMARY:Report
DUE;VALUE=DATE:20261030
${rule}
END:VTODO
END:VCALENDAR`);

  it('reads a BYSETPOS rule as written, keeps it on a title edit and when completed, and replaces it on request', () => {
    const o = task(LAST_WORK_DAY);
    const t = readTask(o)!;
    expect(t.rrule).toBeUndefined();
    expect(t.ruleAsWritten?.rules[0]).toMatchObject({ freq: 'MONTHLY', by: { BYDAY: ['MO', 'TU', 'WE', 'TH', 'FR'], BYSETPOS: [-1] } });
    expect(t.isRecurring).toBe(true);
    expect(updateTaskIcs(o, { ...t, title: 'Monthly report' })).toMatch(/RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\n/);
    expect(setTaskCompleted(o, true)).toMatch(/RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\n/);
    expect(updateTaskIcs(o, { ...t, ruleAsWritten: undefined })).not.toMatch(/RRULE/);
    expect(updateTaskIcs(o, { ...t, rrule: { freq: 'WEEKLY', interval: 1 } })).toMatch(/RRULE:FREQ=WEEKLY\r\n/);
  });

  it('reads an HOURLY rule as a recurring task and drops it with "Does not repeat"', () => {
    const o = task('RRULE:FREQ=HOURLY;INTERVAL=4');
    const t = readTask(o)!;
    expect(t.isRecurring).toBe(true);
    expect(updateTaskIcs(o, { ...t, title: 'Check' })).toMatch(/RRULE:FREQ=HOURLY;INTERVAL=4\r\n/);
    expect(updateTaskIcs(o, { ...t, ruleAsWritten: undefined })).not.toMatch(/RRULE/);
  });
});

// Rules written in another form of a rule the editor writes, as other clients
// often write them, are read as the editor's rule when -- and only when -- they
// have the same dates from their DTSTART (editorSpelling, sameDates).

/** A series named Birthday from `start`: a local date and time in Warsaw, or a date (all-day). */
const from = (start: string, rule: string) =>
  parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:folded
${start.length === 8 ? `DTSTART;VALUE=DATE:${start}` : `DTSTART;TZID=Europe/Warsaw:${start}`}
RRULE:${rule}
SUMMARY:Birthday
END:VEVENT
END:VCALENDAR`);
const veventOf = (obj: ParsedObject) => obj.root.getFirstSubcomponent('vevent')!;
const startOf = (obj: ParsedObject) => (veventOf(obj).getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate();
const readRecurrenceOf = (obj: ParsedObject) => readRecurrence(veventOf(obj));
/** The event data the editor opens on the first instance of the series with. */
function modelOf(obj: ParsedObject) {
  const occ = expandEvent(obj, startOf(obj), new Date(startOf(obj).getFullYear() + 3, 0, 1))[0];
  return eventDataFor(obj, occ);
}
/** Starts of the instances in `years` years from the start of the series, as the app expands it. */
const instants = (obj: ParsedObject, years: number) =>
  expandEvent(obj, startOf(obj), new Date(startOf(obj).getFullYear() + years, 0, 1)).map((o) => o.start.getTime());

describe('rules in another form of a rule the editor writes', () => {
  // Each pair has the same dates by RFC 5545 3.3.10, and the test shows that
  // the app expands them alike over a long window:
  // - INTERVAL=1 is the default interval, and WKST changes nothing in a rule
  //   with an interval of 1 (it only groups days into weeks that get skipped);
  // - FREQ=YEARLY takes the month and the day from DTSTART, so naming the
  //   month of DTSTART, and its day, says nothing more;
  // - BYDAY lists a set of days, so their order says nothing;
  // - a daily rule limited to some weekdays from a DTSTART on one of them has
  //   every such day from DTSTART on, as the weekly rule on them has.
  it.each<[string, string, string, RecurrenceRule, string, number]>([
    ['yearly with INTERVAL=1, the month, the day and WKST', '20260105T090000', 'FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=5;BYMONTH=1;WKST=SU', { freq: 'YEARLY', interval: 1 }, 'yearly', 120],
    ['yearly with the month only', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1', { freq: 'YEARLY', interval: 1 }, 'yearly', 120],
    ['a birthday (all-day)', '19900312', 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=12', { freq: 'YEARLY', interval: 1 }, 'yearly', 120],
    ['yearly on the 31st', '20260131T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=31', { freq: 'YEARLY', interval: 1 }, 'yearly', 120],
    ['monthly with INTERVAL=1 and WKST', '20260105T090000', 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5;WKST=SU', { freq: 'MONTHLY', interval: 1, byMonthDay: [5] }, 'monthly', 30],
    ['weekly with INTERVAL=1 and WKST', '20260105T090000', 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=SU', { freq: 'WEEKLY', interval: 1, byDay: ['MO'] }, 'weekly', 4],
    ['weekdays in another order', '20260105T090000', 'FREQ=WEEKLY;BYDAY=FR,TH,WE,TU,MO', { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, 'weekdays', 4],
    ['weekdays as a daily rule', '20260105T090000', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, 'weekdays', 4],
    ['weekdays as a daily rule with WKST, from a Wednesday', '20260107T090000', 'FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;WKST=SU', { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, 'weekdays', 4],
    ['daily with INTERVAL=1', '20260105T090000', 'FREQ=DAILY;INTERVAL=1;WKST=SU', { freq: 'DAILY', interval: 1 }, 'daily', 2],
    // Not presets, but rules the custom editor shows in full.
    ['yearly with a COUNT', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5;COUNT=10', { freq: 'YEARLY', interval: 1, count: 10 }, 'custom', 120],
    ['every other year until a date', '20260105T090000', 'FREQ=YEARLY;INTERVAL=2;BYMONTHDAY=5;BYMONTH=1;UNTIL=20400105T080000Z', { freq: 'YEARLY', interval: 2, until: new Date(Date.UTC(2040, 0, 5, 8)) }, 'custom', 120],
    ['a daily rule on two days with a COUNT', '20260105T090000', 'FREQ=DAILY;BYDAY=TH,MO;COUNT=7', { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TH'], count: 7 }, 'custom', 4],
    // Weeks from Sunday and from Monday put Monday and Wednesday after a Monday DTSTART into the same weeks.
    ['every other week with a WKST that leaves each day in its week', '20260105T090000', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;WKST=SU', { freq: 'WEEKLY', interval: 2, byDay: ['MO', 'WE'] }, 'custom', 4],
  ])('reads %s as the editor would write it', (_, start, rule, model, preset, years) => {
    const obj = from(start, rule);
    const data = modelOf(obj);
    expect(data.ruleAsWritten).toBeUndefined();
    expect(data.rrule).toEqual(model);
    expect(detectPreset(data.rrule, startOf(obj))).toBe(preset);
    // The editor's own rule has the same dates over the window: every kind of
    // year (and 2100, which has no 29 February) for a yearly rule, and
    // hundreds of the one-week patterns of a weekly one.
    const own = from(start, recurToString(data.rrule!, start.length === 8));
    const dates = instants(obj, years);
    expect(dates.length).toBeGreaterThan(0);
    expect(instants(own, years)).toEqual(dates);
  });

  it.each([
    ['a day of the month other than the start’s', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=6'],
    ['a month other than the start’s', '20260105T090000', 'FREQ=YEARLY;BYMONTH=2'],
    ['two months', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=5'],
    // RFC 5545: the 5th of every month. ical.js expands it once a year, but other apps do not.
    ['a day of the month without the month', '20260105T090000', 'FREQ=YEARLY;BYMONTHDAY=5'],
    // ical.js moves the plain yearly rule to 1 March in other years and skips those with BYMONTHDAY=29.
    ['29 February', '20240229', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29'],
    // The same in ical.js, and by RFC 5545, but left alone with the rest of 29 February.
    ['the month of 29 February', '20240229', 'FREQ=YEARLY;BYMONTH=2'],
    ['a weekday of the month of the start', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1;BYDAY=1MO'],
    ['BYSETPOS over weekdays', '20260130T090000', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'],
    ['BYSETPOS over days of the month', '20260105T090000', 'FREQ=MONTHLY;BYMONTHDAY=5,20;BYSETPOS=-1'],
    ['several weekdays with ordinals', '20260105T090000', 'FREQ=MONTHLY;BYDAY=1MO,3WE'],
    ['BYHOUR', '20260105T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5;BYHOUR=9,17'],
    // RFC 5545 leaves a DTSTART on none of the days open; ical.js counts it for the daily rule, not for the weekly one.
    ['weekdays as a daily rule from a Saturday', '20260103T090000', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'],
    ['every other day on weekdays', '20260105T090000', 'FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR'],
    ['a daily rule on a weekday in one month', '20260105T090000', 'FREQ=DAILY;BYDAY=MO;BYMONTH=1'],
    // Weeks from Sunday put the Sunday before a Monday DTSTART into its week.
    ['a WKST that moves a day into another week', '20260105T090000', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU'],
  ])('keeps a rule with %s as written', (_, start, rule) => {
    const obj = from(start, rule);
    const data = modelOf(obj);
    expect(data.rrule).toBeUndefined();
    expect(data.ruleAsWritten).toBeDefined();
    const [occ] = expandEvent(obj, startOf(obj), new Date(startOf(obj).getFullYear() + 3, 0, 1));
    const [op] = updateEvent(obj, occ, { ...data, title: 'Renamed' }, 'all');
    expect(eventPart(written(op))).toMatch(new RegExp(`^RRULE:${rule}$`, 'm'));
  });

  it.each<[string, string, RecurrenceRule]>([
    ['a monthly rule on another day than the start’s', 'FREQ=MONTHLY;BYMONTHDAY=20', { freq: 'MONTHLY', interval: 1, byMonthDay: [20] }],
    ['a weekly rule on another day than the start’s', 'FREQ=WEEKLY;BYDAY=TU', { freq: 'WEEKLY', interval: 1, byDay: ['TU'] }],
  ])('leaves %s to the custom rule, not the preset of the start', (_, rule, model) => {
    const obj = from('20260105T090000', rule);
    expect(readRecurrenceOf(obj).rrule).toEqual(model);
    expect(detectPreset(model, startOf(obj))).toBe('custom');
  });

  it('folds the same rule from one DTSTART and not from another', () => {
    expect(readRecurrenceOf(from('20260105T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5')).rrule).toEqual({ freq: 'YEARLY', interval: 1 });
    expect(readRecurrenceOf(from('20260106T090000', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5')).rrule).toBeUndefined();
    expect(readRecurrenceOf(from('20260105T090000', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')).rrule).toBeDefined();
    expect(readRecurrenceOf(from('20260104T090000', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')).rrule).toBeUndefined();
  });

  it('never folds a rule into one with other dates, from any day of a leap year and of two weeks', () => {
    /** The first `n` dates of `rule` from `start`, as ical.js expands it. */
    const first = (rule: string, start: ICAL.Time, n: number) => {
      const iter = ICAL.Recur.fromString(rule).iterator(start);
      const out: string[] = [];
      for (let next = iter.next(); next && out.length < n; next = iter.next()) out.push(next.toString());
      return out;
    };
    /** Whether the rule is folded from `start`; when it is, the editor's rule has the same first `n` dates. */
    const folds = (start: ICAL.Time, rule: string, n: number) => {
      const lines = ['BEGIN:VEVENT', 'UID:sweep', `DTSTART${start.isDate ? ';VALUE=DATE' : ''}:${start.toICALString()}`, `RRULE:${rule}`, 'END:VEVENT'];
      const model = readRecurrence(new ICAL.Component(ICAL.parse(lines.join('\r\n')) as unknown as unknown[])).rrule;
      if (!model) return false;
      expect(first(recurToString(model, start.isDate), start, n), `${rule} from ${start.toString()}`).toEqual(first(rule, start, n));
      return true;
    };
    let yearly = 0;
    // Every day of 2028, 29 February included, on each yearly form: 60 years of dates, every kind of year.
    for (const day = ICAL.Time.fromData({ year: 2028, month: 1, day: 1, isDate: true }); day.year === 2028; day.adjust(1, 0, 0, 0)) {
      for (const rule of [`FREQ=YEARLY;BYMONTH=${day.month};BYMONTHDAY=${day.day}`, `FREQ=YEARLY;BYMONTH=${day.month}`, `FREQ=YEARLY;BYMONTHDAY=${day.day}`]) {
        if (folds(day.clone(), rule, 60)) yearly++;
      }
    }
    // The first two forms from every day but 29 February, and never the third (the day in every month).
    expect(yearly).toBe(2 * 365);
    let weekly = 0;
    // Two weeks of starts on each weekly form: 200 dates.
    for (const day = ICAL.Time.fromData({ year: 2026, month: 1, day: 1, hour: 9 }); day.day <= 14; day.adjust(1, 0, 0, 0)) {
      for (const rule of [
        'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
        'FREQ=DAILY;BYDAY=SA,SU',
        'FREQ=WEEKLY;BYDAY=FR,MO',
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU',
        'FREQ=WEEKLY;INTERVAL=3;BYDAY=TH,TU;WKST=SA',
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;WKST=SU',
      ]) {
        if (folds(day.clone(), rule, 200)) weekly++;
      }
    }
    // Weekdays and weekend days from one of them; any start for the order of
    // days; never a Sunday in weeks from Sunday; Tuesday and Thursday in
    // weeks from Saturday from a start on Monday to Friday; Sunday alone from
    // a Sunday.
    expect(weekly).toBe(10 + 4 + 14 + 0 + 10 + 2);
  }, 30_000);

  it('keeps the spelling of a folded rule when only the title changes', () => {
    const edited = saveAll(series('RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=5;BYMONTH=1;WKST=SU'), (d) => ({ ...d, title: 'Anniversary' }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=5;BYMONTH=1;WKST=SU$/m);
  });

  // The editor's "Every year on <date>" follows the start when it moves (RecurrenceFields), so a folded rule does too.
  it('moves a folded "every year" with the start to the new date', () => {
    const obj = series('RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5');
    const start = new Date(2026, 1, 10, 9);
    const edited = saveAll(obj, (d) => ({ ...d, start, end: new Date(2026, 1, 10, 10), rrule: presetRule('yearly', start) }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=YEARLY$/m);
    expect(expandEvent(edited, new Date(2026, 0, 1), new Date(2029, 0, 1)).map((o) => o.start)).toEqual([2026, 2027, 2028].map((y) => new Date(y, 1, 10, 9)));
  });

  it('keeps the spelling of a folded "every year" when the start moves within the month the rule names', () => {
    const obj = series('RRULE:FREQ=YEARLY;BYMONTH=1');
    const start = new Date(2026, 0, 27, 9);
    const edited = saveAll(obj, (d) => ({ ...d, start, end: new Date(2026, 0, 27, 10), rrule: presetRule('yearly', start) }));
    expect(eventPart(edited)).toMatch(/^RRULE:FREQ=YEARLY;BYMONTH=1$/m);
    expect(expandEvent(edited, new Date(2026, 0, 1), new Date(2028, 0, 1)).map((o) => o.start)).toEqual([new Date(2026, 0, 27, 9), new Date(2027, 0, 27, 9)]);
  });

  it('moves a folded "every year" to the new date for this and the following events', () => {
    const obj = series('RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5');
    const occ = expandEvent(obj, new Date(2028, 0, 1), new Date(2029, 0, 1))[0];
    const start = new Date(2028, 1, 10, 9);
    const data = { ...eventDataFor(obj, occ), start, end: new Date(2028, 1, 10, 10), rrule: presetRule('yearly', start) };
    const [old, fresh] = updateEvent(obj, occ, data, 'future');
    expect(expandEvent(written(old), new Date(2026, 0, 1), new Date(2031, 0, 1)).map((o) => o.start.getFullYear())).toEqual([2026, 2027]);
    const next = parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics');
    expect(eventPart(next)).toMatch(/^RRULE:FREQ=YEARLY$/m);
    expect(expandEvent(next, new Date(2026, 0, 1), new Date(2031, 0, 1)).map((o) => o.start)).toEqual([2028, 2029, 2030].map((y) => new Date(y, 1, 10, 9)));
  });

  it('carries a folded rule on as written in a "this and following" title edit', () => {
    const obj = series('RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR');
    const occ = expandEvent(obj, ...Q1)[3];
    const [, fresh] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Stand-up' }, 'future');
    expect(eventPart(parse((fresh as { data: string }).data, 'https://x.test/cal/b.ics'))).toMatch(/^RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR$/m);
  });
});

describe('task rules in another form of a rule the editor writes', () => {
  const task = (rule: string) =>
    parse(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:t-folded
SUMMARY:Insurance
DUE;VALUE=DATE:20261030
RRULE:${rule}
END:VTODO
END:VCALENDAR`);

  it('reads a yearly rule on the month and day of DUE as the yearly preset and keeps its spelling', () => {
    const o = task('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30');
    const t = readTask(o)!;
    expect(t.rrule).toEqual({ freq: 'YEARLY', interval: 1 });
    expect(t.ruleAsWritten).toBeUndefined();
    expect(detectPreset(t.rrule, t.due!)).toBe('yearly');
    expect(updateTaskIcs(o, { ...t, title: 'Car insurance' })).toMatch(/RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30\r\n/);
    // Completing it moves DUE a year on, from where the rule still has the same dates.
    const done = setTaskCompleted(o, true);
    expect(done).toMatch(/DUE;VALUE=DATE:20271030\r\n/);
    expect(done).toMatch(/RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30\r\n/);
  });

  it('follows DUE to another date', () => {
    const o = task('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30');
    const t = readTask(o)!;
    const due = new Date(2026, 10, 3);
    const out = updateTaskIcs(o, { ...t, due, rrule: presetRule('yearly', due) });
    expect(out).toMatch(/DUE;VALUE=DATE:20261103\r\n/);
    expect(out).toMatch(/RRULE:FREQ=YEARLY\r\n/);
  });

  it('keeps a yearly rule on another day than DUE as written', () => {
    const o = task('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31');
    const t = readTask(o)!;
    expect(t.rrule).toBeUndefined();
    expect(updateTaskIcs(o, { ...t, title: 'Car insurance' })).toMatch(/RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31\r\n/);
  });

  // 1200 tasks parsed and read once, each rule expanded on that first read: over a second of
  // real work, several on a busy machine, so the test has more than the default five seconds.
  it('are read again without expanding their rules again, however many the list holds', { timeout: 20_000 }, () => {
    // As the task list reads them on every change of the store: the same ones, in the same order.
    const many = Array.from({ length: 1200 }, (_, i) => {
      const due = new Date(2027, 0, 1 + i);
      const date = `${due.getFullYear()}${String(due.getMonth() + 1).padStart(2, '0')}${String(due.getDate()).padStart(2, '0')}`;
      const day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][due.getDay()];
      return parse(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:t-many-${i}
SUMMARY:Water the plants
DUE;VALUE=DATE:${date}
RRULE:FREQ=WEEKLY;BYDAY=SA,${day}
END:VTODO
END:VCALENDAR`);
    });
    for (const o of many) expect(readTask(o)!.rrule?.freq).toBe('WEEKLY');
    const expanded = vi.spyOn(ICAL.Recur.prototype, 'iterator');
    try {
      for (const o of many) readTask(o);
      expect(expanded).not.toHaveBeenCalled();
    } finally {
      expanded.mockRestore();
    }
  });
});

describe('the end of a series the editor writes', () => {
  it('keeps the instance on the last day of a timed series', () => {
    // As the editor picks the day: the end of it (RecurrenceFields), or a date at its midnight.
    for (const until of [new Date(2026, 0, 26, 23, 59, 59), new Date(2026, 0, 26)]) {
      const obj = saveAll(series('RRULE:FREQ=WEEKLY'), (data) => ({ ...data, rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO'], until } }));
      expect(eventPart(obj)).toMatch(/UNTIL=20260126T225959Z/);
      expect(days(obj)).toEqual(['1/5', '1/12', '1/19', '1/26']);
    }
  });

  it('is a date for an all-day series', () => {
    expect(recurToString({ freq: 'DAILY', interval: 1, until: new Date(2026, 0, 26, 23, 59, 59) }, true)).toBe('FREQ=DAILY;UNTIL=20260126');
  });
});
