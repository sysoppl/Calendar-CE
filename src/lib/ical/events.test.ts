import { describe, expect, it } from 'vitest';
import { createEventIcs, deleteEvent, eventDataFor, expandEvent, updateEvent } from './events';
import { parseObject, type ParsedObject, type RawObject } from './parse';
import type { EventData } from './types';


const raw = (data: string, url = 'https://x.test/cal/a.ics'): RawObject => ({
  url,
  etag: '"1"',
  calendarId: 'cal',
  data: data.replace(/\r?\n/g, '\r\n'),
});

const parse = (data: string) => parseObject(raw(data))!;

const WEEKLY = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:weekly-1
DTSTART;TZID=Europe/Warsaw:20261005T090000
DTEND;TZID=Europe/Warsaw:20261005T100000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Warsaw:20261019T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID;TZID=Europe/Warsaw:20261012T090000
DTSTART;TZID=Europe/Warsaw:20261012T110000
DTEND;TZID=Europe/Warsaw:20261012T120000
SUMMARY:Standup (moved)
END:VEVENT
END:VCALENDAR`;

describe('expandEvent', () => {
  it('expands a single timed event with an unknown-to-ical.js IANA zone', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART;TZID=America/New_York:20261012T090000
DTEND;TZID=America/New_York:20261012T100000
SUMMARY:NY call
END:VEVENT
END:VCALENDAR`);
    const occ = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(occ).toHaveLength(1);
    expect(occ[0].start.toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(occ[0].isRecurring).toBe(false);
  });

  it('expands all-day events with exclusive end', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:b
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261014
SUMMARY:Trip
END:VEVENT
END:VCALENDAR`);
    const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(occ.allDay).toBe(true);
    expect(occ.start).toEqual(new Date(2026, 9, 12));
    expect(occ.end).toEqual(new Date(2026, 9, 14));
  });

  it('defaults a missing DTEND on all-day events to one day', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261012
SUMMARY:Holiday
END:VEVENT
END:VCALENDAR`);
    const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(occ.end).toEqual(new Date(2026, 9, 13));
  });

  it('applies overrides and EXDATEs in recurring series', () => {
    const occ = expandEvent(parse(WEEKLY), new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(occ.map((o) => [o.start.getDate(), o.start.getHours(), o.title])).toEqual([
      [5, 9, 'Standup'],
      [12, 11, 'Standup (moved)'],
      [26, 9, 'Standup'],
    ]);
    expect(occ[1].isException).toBe(true);
    expect(new Set(occ.map((o) => o.key)).size).toBe(3);
  });

  it('keeps wall-clock time across the DST change', () => {
    const occ = expandEvent(parse(WEEKLY), new Date(2026, 9, 20), new Date(2026, 10, 10));
    // 26 Oct is CET (UTC+1), 2 Nov too; 5 Oct was CEST.
    expect(occ.map((o) => o.start.getHours())).toEqual([9, 9, 9]);
  });

  it('only returns occurrences in range', () => {
    const occ = expandEvent(parse(WEEKLY), new Date(2027, 0, 1), new Date(2027, 0, 8));
    expect(occ).toHaveLength(1);
    expect(occ[0].start).toEqual(new Date(2027, 0, 4, 9));
  });
});

const baseData = (over: Partial<EventData> = {}): EventData => ({
  uid: 'new-1',
  title: 'Lunch',
  description: 'With team',
  location: 'Cafe',
  start: new Date(2026, 9, 14, 12),
  end: new Date(2026, 9, 14, 13),
  allDay: false,
  timezone: 'Europe/Warsaw',
  alarms: [10],
  busy: true,
  attendees: [],
  categories: [],
  ...over,
});

describe('writing events', () => {
  it('creates an event that round-trips', () => {
    const ics = createEventIcs(baseData({ rrule: { freq: 'WEEKLY', interval: 2, byDay: ['WE'], count: 5 } }));
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('DTSTART;TZID=Europe/Warsaw:20261014T120000');
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY.*INTERVAL=2/);
    expect(ics).toContain('TRIGGER:-PT10M');
    const obj = parse(ics);
    const data = eventDataFor(obj, { start: new Date(2026, 9, 14, 12), end: new Date(2026, 9, 14, 13) });
    expect(data).toMatchObject({ title: 'Lunch', location: 'Cafe', alarms: [10], timezone: 'Europe/Warsaw' });
    expect(data.rrule).toMatchObject({ freq: 'WEEKLY', interval: 2, count: 5 });
    expect(expandEvent(obj, new Date(2026, 9, 1), new Date(2027, 1, 1))).toHaveLength(5);
  });

  it('writes all-day events as DATE values', () => {
    const ics = createEventIcs(baseData({ allDay: true, start: new Date(2026, 9, 14), end: new Date(2026, 9, 15) }));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261014');
    expect(ics).toContain('DTEND;VALUE=DATE:20261015');
    expect(ics).not.toContain('VTIMEZONE');
  });

  it('edits a single occurrence by adding an override', () => {
    const obj = parse(WEEKLY);
    const [, , third] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    const data = eventDataFor(obj, third);
    const ops = updateEvent(obj, third, { ...data, title: 'Retro' }, 'single');
    expect(ops).toHaveLength(1);
    const updated = parse((ops[0] as { data: string }).data);
    const titles = expandEvent(updated, new Date(2026, 9, 1), new Date(2026, 10, 1)).map((o) => o.title);
    expect(titles).toEqual(['Standup', 'Standup (moved)', 'Retro']);
  });

  it('edits all occurrences shifting the series by the instance delta', () => {
    const obj = parse(WEEKLY);
    const occs = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    const third = occs[2];
    const data = eventDataFor(obj, third);
    const ops = updateEvent(
      obj,
      third,
      { ...data, start: new Date(2026, 9, 26, 10), end: new Date(2026, 9, 26, 11), title: 'Daily' },
      'all',
    );
    const updated = parse((ops[0] as { data: string }).data);
    const next = expandEvent(updated, new Date(2026, 10, 1), new Date(2026, 10, 10));
    expect(next.map((o) => [o.start.getHours(), o.title])).toEqual([[10, 'Daily'], [10, 'Daily']]);
  });

  it('splits the series for "this and future" edits', () => {
    const obj = parse(WEEKLY);
    const third = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1))[2];
    const ops = updateEvent(obj, third, { ...eventDataFor(obj, third), title: 'New standup' }, 'future');
    expect(ops.map((o) => o.type)).toEqual(['update', 'create']);
    const old = parse((ops[0] as { data: string }).data);
    expect(expandEvent(old, new Date(2026, 9, 20), new Date(2027, 1, 1))).toHaveLength(0);
    const fresh = parseObject(raw((ops[1] as { data: string }).data, 'https://x.test/cal/b.ics'))!;
    const nextOcc = expandEvent(fresh, new Date(2026, 9, 20), new Date(2026, 10, 10));
    expect(nextOcc.map((o) => o.title)).toEqual(['New standup', 'New standup', 'New standup']);
  });

  it('deletes a single occurrence with EXDATE', () => {
    const obj = parse(WEEKLY);
    const first = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1))[0];
    const ops = deleteEvent(obj, first, 'single');
    const updated = parse((ops[0] as { data: string }).data);
    expect(expandEvent(updated, new Date(2026, 9, 1), new Date(2026, 10, 1))).toHaveLength(2);
  });

  it('deletes the whole object for "all" scope', () => {
    const obj = parse(WEEKLY);
    expect(deleteEvent(obj, { recurrenceId: '2026-10-05T09:00:00' }, 'all')).toEqual([
      { type: 'delete', url: obj.url, etag: obj.etag },
    ]);
  });
});

// ical.js looks for the next instance of a rule without a limit. Without the
// guard in recurrence.ts each of these never returns, which stops the run.
describe('rules that cannot be followed', () => {
  const single = (rule: string, extra = '') =>
    parse(`BEGIN:VCALENDAR
${extra}BEGIN:VEVENT
UID:hostile
DTSTART:20261006T090000Z
DTEND:20261006T100000Z
RRULE:${rule}
SUMMARY:Hostile
END:VEVENT
END:VCALENDAR`);

  it.each([
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;BYMONTHDAY=31;BYMONTH=4',
    'FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;BYMONTHDAY=-1',
    'FREQ=DAILY;INTERVAL=7;BYDAY=MO',
    'FREQ=WEEKLY;BYWEEKNO=1;BYMONTH=6',
    'FREQ=SECONDLY;BYMONTH=3',
  ])('expands %s to its first instance and returns', (rule) => {
    const started = performance.now();
    const occ = expandEvent(single(rule), new Date('2026-10-01'), new Date('2026-12-01'));
    expect(occ.map((o) => o.start.toISOString())).toEqual(['2026-10-06T09:00:00.000Z']);
    // A second look at the same object does not pay for the search again.
    expect(expandEvent(single(rule), new Date('2026-12-01'), new Date('2027-02-01'))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('sets up a yearly rule whose parts never meet without looking through the years up to 20000, every time it is shown', () => {
    // The first Monday of April that falls on the 15th: ical.js would look for one until the year 20000.
    const obj = single('FREQ=YEARLY;BYMONTH=4;BYDAY=1MO;BYMONTHDAY=15');
    const started = performance.now();
    for (let i = 0; i < 20; i++) expect(expandEvent(obj, new Date('2026-10-01'), new Date('2027-12-01'))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('does not walk a series it stopped following again for a range past the point where it stopped', () => {
    // One instance a minute: the most instances one series shows are used up two weeks in.
    const obj = single('FREQ=SECONDLY;BYSECOND=0');
    expect(expandEvent(obj, new Date('2027-10-01'), new Date('2027-11-01'))).toEqual([]);
    const started = performance.now();
    for (let i = 0; i < 20; i++) expect(expandEvent(obj, new Date('2027-10-01'), new Date('2027-11-01'))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
    // What was found before that is still shown.
    const first = expandEvent(obj, new Date('2026-10-06T09:00:00Z'), new Date('2026-10-06T09:03:00Z'));
    expect(first.map((o) => o.start.toISOString())).toEqual(['2026-10-06T09:00:00.000Z', '2026-10-06T09:01:00.000Z', '2026-10-06T09:02:00.000Z']);
  });

  it('follows a costly rule only as far as its budget goes', () => {
    const occ = expandEvent(single('FREQ=MINUTELY'), new Date('2026-10-06T09:00:00Z'), new Date('2026-10-06T09:05:00Z'));
    expect(occ).toHaveLength(5);
    const started = performance.now();
    expandEvent(single('FREQ=SECONDLY'), new Date('2027-01-01'), new Date('2027-01-02'));
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it.each([
    ['a rule that never matches', 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30'],
    ['a rule of every second', 'FREQ=SECONDLY'],
  ])('ignores a VTIMEZONE with %s and reads the event in the zone of its name', (_, rule) => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Europe/Warsaw
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:${rule}
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:zone
DTSTART;TZID=Europe/Warsaw:20261012T090000
DTEND;TZID=Europe/Warsaw:20261012T100000
SUMMARY:One-off
END:VEVENT
END:VCALENDAR`);
    const occ = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(occ.map((o) => o.start.toISOString())).toEqual(['2026-10-12T07:00:00.000Z']);
  });

  it('keeps a VTIMEZONE whose rules are ordinary, also with the hour in them', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Notes Zone
BEGIN:STANDARD
DTSTART:19501029T030000
TZOFFSETFROM:+0400
TZOFFSETTO:+0300
RRULE:FREQ=YEARLY;BYMINUTE=0;BYHOUR=3;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19500326T020000
TZOFFSETFROM:+0300
TZOFFSETTO:+0400
RRULE:FREQ=YEARLY;BYMINUTE=0;BYHOUR=2;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:custom
DTSTART;TZID=Notes Zone:20260612T090000
DTEND;TZID=Notes Zone:20260612T100000
RRULE:FREQ=MONTHLY;COUNT=6
SUMMARY:Custom zone
END:VEVENT
END:VCALENDAR`);
    expect(obj.root.getAllSubcomponents('vtimezone')).toHaveLength(1);
    const starts = expandEvent(obj, new Date('2026-06-01'), new Date('2026-12-01')).map((o) => o.start.toISOString());
    expect(starts[0]).toBe('2026-06-12T05:00:00.000Z');
    expect(starts.at(-1)).toBe('2026-11-12T06:00:00.000Z');
  });
});

describe('rules the editor does not show in full', () => {
  const series = (rule: string, extra = '') =>
    parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:kept-rule
DTSTART;TZID=Europe/Warsaw:20260105T090000
DTEND;TZID=Europe/Warsaw:20260105T100000
RRULE:${rule}
${extra}SUMMARY:Review
END:VEVENT
END:VCALENDAR`);
  const Q1: [Date, Date] = [new Date(2026, 0, 1), new Date(2026, 3, 1)];
  const retitle = (obj: ParsedObject) => {
    const [occ] = expandEvent(obj, ...Q1);
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Monthly review' }, 'all');
    return parse((op as { data: string }).data);
  };

  it('a title edit keeps BYSETPOS, WKST and the EXDATEs', () => {
    const obj = series('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;WKST=SU', 'EXDATE;TZID=Europe/Warsaw:20260227T090000\n');
    expect(expandEvent(obj, ...Q1).map((o) => o.start.getDate())).toEqual([30, 31]);
    const edited = retitle(obj);
    expect(edited.data).toMatch(/BYSETPOS=-1/);
    expect(edited.data).toMatch(/WKST=SU/);
    expect(expandEvent(edited, ...Q1).map((o) => [o.start.getDate(), o.title])).toEqual([
      [30, 'Monthly review'],
      [31, 'Monthly review'],
    ]);
  });

  it('a title edit keeps an HOURLY rule and its EXDATEs', () => {
    const obj = series('FREQ=HOURLY;INTERVAL=6;COUNT=8', 'EXDATE;TZID=Europe/Warsaw:20260105T150000\n');
    expect(expandEvent(obj, ...Q1)).toHaveLength(7);
    const edited = retitle(obj);
    expect(edited.data).toMatch(/RRULE:FREQ=HOURLY/);
    expect(expandEvent(edited, ...Q1)).toHaveLength(7);
  });

  it('a change of the rule replaces it', () => {
    const obj = series('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    const [occ] = expandEvent(obj, ...Q1);
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), rrule: { freq: 'WEEKLY', interval: 1, byDay: ['FR'] } }, 'all');
    const edited = parse((op as { data: string }).data);
    expect(edited.data).not.toMatch(/BYSETPOS/);
    expect(edited.data).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=FR/);
  });

  it.each([
    ['BYSETPOS', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 2],
    // The first of the eight instances stays with the old series.
    ['HOURLY', 'FREQ=HOURLY;INTERVAL=6;COUNT=8', 'FREQ=HOURLY;INTERVAL=6;COUNT=7', 7],
  ])('a "this and following" edit of a %s series starts the new one under the same rule', (_, rule, rest, count) => {
    const obj = series(rule);
    const occs = expandEvent(obj, ...Q1);
    const ops = updateEvent(obj, occs[1], { ...eventDataFor(obj, occs[1]), title: 'Later' }, 'future');
    const fresh = parseObject(raw((ops[1] as { data: string }).data, 'https://x.test/cal/later.ics'))!;
    const parts = (text: string) => new Set(text.trim().split(';'));
    const event = fresh.data.slice(fresh.data.indexOf('BEGIN:VEVENT'));
    expect(parts(/^RRULE:(.*)$/m.exec(event)![1])).toEqual(parts(rest));
    const later = expandEvent(fresh, ...Q1);
    expect(later).toHaveLength(count);
    expect(later[0].start.getTime()).toBe(occs[1].start.getTime());
  });

  it.each([
    ['BYSETPOS', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', /RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;UNTIL=/],
    ['HOURLY', 'FREQ=HOURLY;INTERVAL=6;COUNT=8', /RRULE:FREQ=HOURLY;INTERVAL=6;UNTIL=/],
  ])('ending a %s series keeps the rest of its rule', (_, rule, kept) => {
    const obj = series(rule);
    const occs = expandEvent(obj, ...Q1);
    const [op] = deleteEvent(obj, occs[1], 'future');
    const ended = parse((op as { data: string }).data);
    expect(ended.data).toMatch(kept);
    expect(expandEvent(ended, ...Q1).map((o) => o.start.getTime())).toEqual([occs[0].start.getTime()]);
  });
});

describe('an event\'s own COLOR', () => {
  const withColor = (line: string, uid = 'colour') =>
    parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:${uid}
DTSTART:20261012T090000Z
DTEND:20261012T100000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Painted
${line}
END:VEVENT
BEGIN:VEVENT
UID:${uid}
RECURRENCE-ID:20261013T090000Z
DTSTART:20261013T110000Z
DTEND:20261013T120000Z
SUMMARY:Painted (moved)
${line}
END:VEVENT
END:VCALENDAR`);
  const colours = (obj: ParsedObject) => {
    const occs = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(occs).toHaveLength(2);
    return [...occs.map((o) => o.color), ...occs.map((o) => eventDataFor(obj, o).color)];
  };

  it.each([
    ['a url()', 'COLOR:url(https://tracker.example/beacon?u=victim)'],
    ['an expression()', 'COLOR:expression(alert(1))'],
    ['a value that ends the declaration', 'COLOR:red;}body{background:url(https://tracker.example/x)}'],
    ['the same, escaped', String.raw`COLOR:red\;}body{background:url(https://tracker.example/x)}`],
    ['a colour with more after it', String.raw`COLOR:#ff0000\; background-image: url(x)`],
    ['a word that is no colour', 'COLOR:notacolor'],
    ['a very long value', `COLOR:${'a'.repeat(200_000)}`],
    ['a colour padded to a very long value', `COLOR:#fff${' '.repeat(10_000)}x`],
  ])('drops %s when the object is read', (label, line) => {
    expect(colours(withColor(line, `c-${label.length}`))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('keeps a hex colour or a colour keyword', () => {
    expect(colours(withColor('COLOR:#3a7', 'hex'))).toEqual(['#3a7', '#3a7', '#3a7', '#3a7']);
    expect(colours(withColor('COLOR:Turquoise', 'name'))).toEqual(['turquoise', 'turquoise', 'turquoise', 'turquoise']);
  });

  const single = (line: string) =>
    parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:saved
DTSTART:20261012T090000Z
DTEND:20261012T100000Z
SUMMARY:Painted
${line}
END:VEVENT
END:VCALENDAR`);
  const saved = (obj: ParsedObject, edit: (data: EventData) => EventData) => {
    const [occ] = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    const [op] = updateEvent(obj, occ, edit(eventDataFor(obj, occ)), 'all');
    return (op as { data: string }).data;
  };

  it('keeps a hex colour with an alpha channel and shows it', () => {
    expect(colours(withColor('COLOR:#ff000080', 'alpha'))).toEqual(['#ff000080', '#ff000080', '#ff000080', '#ff000080']);
    expect(saved(single('COLOR:#f008'), (d) => ({ ...d, title: 'Renamed' }))).toMatch(/^COLOR:#f008\r$/m);
  });

  it.each([
    'COLOR:rgb(1,2,3)',
    'COLOR:url(https://tracker.example/beacon)',
    String.raw`COLOR:red\;}body{background:url(https://tracker.example/x)}`,
    'COLOR:hsl(120 50% 50% / 0.5)',
  ])('keeps %s as written when something else is saved, without showing it', (line) => {
    const obj = single(line);
    const [occ] = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(occ.color).toBeUndefined();
    expect(eventDataFor(obj, occ).color).toBeUndefined();
    const data = saved(obj, (d) => ({ ...d, title: 'Renamed' }));
    expect(data).toMatch(/SUMMARY:Renamed/);
    expect(data.split('\r\n')).toContain(line);
  });

  it('drops a COLOR it cannot show once the calendar colour is chosen, and replaces it with a picked one', () => {
    const obj = single('COLOR:rgb(1,2,3)');
    expect(saved(obj, (d) => ({ ...d, color: undefined, colorAsWritten: undefined }))).not.toMatch(/COLOR/);
    expect(saved(obj, (d) => ({ ...d, color: '#3a7' }))).toMatch(/^COLOR:#3a7\r$/m);
    expect(saved(single('COLOR:#3a7'), (d) => ({ ...d, color: undefined }))).not.toMatch(/COLOR/);
  });
});

describe('floating times', () => {
  const event = (lines: string, uid = 'f') =>
    parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:${uid}
SUMMARY:Wake up
${lines}
END:VEVENT
END:VCALENDAR`);
  const RANGE = [new Date(2026, 9, 1), new Date(2026, 10, 1)] as const;

  it('marks an occurrence whose start names no zone', () => {
    const [floating] = expandEvent(event('DTSTART:20261012T070000\nDTEND:20261012T080000', 'f1'), ...RANGE);
    expect(floating).toMatchObject({ allDay: false, floating: true, start: new Date(2026, 9, 12, 7) });
    const [allDay] = expandEvent(event('DTSTART;VALUE=DATE:20261012', 'f2'), ...RANGE);
    expect(allDay).toMatchObject({ allDay: true, floating: true });
    const [zoned] = expandEvent(event('DTSTART;TZID=Europe/Warsaw:20261012T070000\nDTEND;TZID=Europe/Warsaw:20261012T080000', 'f3'), ...RANGE);
    expect(zoned.floating).toBe(false);
    const [utc] = expandEvent(event('DTSTART:20261012T070000Z\nDTEND:20261012T080000Z', 'f4'), ...RANGE);
    expect(utc.floating).toBe(false);
  });

  it('reads a zone it does not know as local time, which is what a floating time is', () => {
    const [occ] = expandEvent(event('DTSTART;TZID=Mars/Olympus:20261012T070000', 'f5'), ...RANGE);
    expect(occ).toMatchObject({ floating: true, start: new Date(2026, 9, 12, 7) });
  });

  it('marks every instance of a floating series, but not an override given a zone', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:series
DTSTART:20261012T070000
DTEND:20261012T080000
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Wake up
END:VEVENT
BEGIN:VEVENT
UID:series
RECURRENCE-ID:20261013T070000
DTSTART;TZID=Europe/Warsaw:20261013T090000
DTEND;TZID=Europe/Warsaw:20261013T100000
SUMMARY:Wake up late
END:VEVENT
END:VCALENDAR`);
    expect(expandEvent(obj, ...RANGE).map((o) => [o.title, o.floating])).toEqual([
      ['Wake up', true],
      ['Wake up late', false],
      ['Wake up', true],
    ]);
  });

  it('tells alarms at a fixed instant apart from those relative to the start', () => {
    const [occ] = expandEvent(
      event(`DTSTART:20261012T070000
DTEND:20261012T080000
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;VALUE=DATE-TIME:20261012T050000Z
END:VALARM`, 'f6'),
      ...RANGE,
    );
    const fixed = Math.round((new Date(2026, 9, 12, 7).getTime() - Date.UTC(2026, 9, 12, 5)) / 60000);
    expect(occ.alarms).toEqual([15, fixed].sort((a, b) => a - b));
    expect(occ.fixedAlarms).toEqual(fixed === 15 ? undefined : [fixed]);
    const [relative] = expandEvent(event('DTSTART:20261012T070000\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nEND:VALARM', 'f7'), ...RANGE);
    expect(relative.fixedAlarms).toBeUndefined();
  });
});

describe('the reminders of an all-day event', () => {
  // A week before at midnight, as an instant: 25 October 2026 is when Poland's clocks go back.
  const ALL_DAY = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:fixed-1
DTSTART;VALUE=DATE:20261101
DTEND;VALUE=DATE:20261102
SUMMARY:All Saints
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;VALUE=DATE-TIME:20261024T220000Z
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-P1D
END:VALARM
END:VEVENT
END:VCALENDAR`;

  it('shows and edits a fixed instant by the clock on the wall, across a change of the clocks', () => {
    const obj = parse(ALL_DAY);
    const data = eventDataFor(obj, { start: new Date(2026, 10, 1), end: new Date(2026, 10, 2) });
    expect(data.alarms).toEqual([1440, 10080]);
  });

  it('fires a fixed instant at that instant', () => {
    const [occ] = expandEvent(parse(ALL_DAY), new Date(2026, 9, 1), new Date(2026, 11, 1));
    expect(occ.alarms).toContain(10140);
    expect(new Date(occ.start.getTime() - 10140 * 60000).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(occ.fixedAlarms).toEqual([10140]);
  });
});

describe('an event that does not repeat', () => {
  const ONE = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:one-1
DTSTART;TZID=Europe/Warsaw:20261110T090000
DTEND;TZID=Europe/Warsaw:20261110T100000
SUMMARY:Once
ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com
END:VEVENT
END:VCALENDAR`;

  it('is read once and found by any range that holds it', () => {
    const obj = parse(ONE);
    const [first] = expandEvent(obj, new Date(2026, 10, 1), new Date(2026, 11, 1));
    const [again] = expandEvent(obj, new Date(2026, 10, 9), new Date(2026, 10, 16));
    expect(again).toBe(first);
    expect(expandEvent(obj, new Date(2026, 10, 11), new Date(2026, 10, 12))).toEqual([]);
    expect(expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 10, 9))).toEqual([]);
  });

  it('is read again with other addresses of the user', () => {
    const obj = parse(ONE);
    const range = [new Date(2026, 10, 1), new Date(2026, 11, 1)] as const;
    expect(expandEvent(obj, ...range)[0].selfStatus).toBeUndefined();
    expect(expandEvent(obj, ...range, new Set(['me@example.com']))[0].selfStatus).toBe('DECLINED');
    // The same addresses in a set of their own: what was read stands.
    const [read] = expandEvent(obj, ...range, new Set(['me@example.com']));
    expect(expandEvent(obj, ...range, new Set(['me@example.com']))[0]).toBe(read);
  });
});

describe('an override naming its instance in UTC', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:utc-rid
DTSTART;TZID=Europe/Warsaw:20261005T090000
DTEND;TZID=Europe/Warsaw:20261005T100000
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:utc-rid
RECURRENCE-ID:20261012T070000Z
DTSTART;TZID=Europe/Warsaw:20261012T110000
DTEND;TZID=Europe/Warsaw:20261012T120000
SUMMARY:Standup (moved)
END:VEVENT
END:VCALENDAR`;

  it('shows the instance once, as the override has it', () => {
    const occ = expandEvent(parse(ics), new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(occ.map((o) => [o.start.getDate(), o.start.getHours(), o.title])).toEqual([
      [5, 9, 'Standup'],
      [12, 11, 'Standup (moved)'],
      [19, 9, 'Standup'],
    ]);
  });

  it('shows it once moved into the range from an instance outside of it, and once moved out of it', () => {
    const moved = parse(ics.replace('DTSTART;TZID=Europe/Warsaw:20261012T110000\nDTEND;TZID=Europe/Warsaw:20261012T120000', 'DTSTART;TZID=Europe/Warsaw:20261030T110000\nDTEND;TZID=Europe/Warsaw:20261030T120000'));
    expect(expandEvent(moved, new Date(2026, 9, 20), new Date(2026, 10, 1)).map((o) => [o.start.getDate(), o.title])).toEqual([[30, 'Standup (moved)']]);
    expect(expandEvent(moved, new Date(2026, 9, 1), new Date(2026, 10, 1)).map((o) => [o.start.getDate(), o.title])).toEqual([
      [5, 'Standup'],
      [30, 'Standup (moved)'],
      [19, 'Standup'],
    ]);
  });
});

describe("an attendee's reply as written", () => {
  it('is read whatever its case, and one the app does not know is none', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:partstat
DTSTART:20261012T070000Z
SUMMARY:Review
ORGANIZER:mailto:boss@example.com
ATTENDEE;PARTSTAT=accepted:mailto:ann@example.com
ATTENDEE;PARTSTAT=Declined:mailto:me@example.com
ATTENDEE;PARTSTAT=X-SOMETHING:mailto:bob@example.com
END:VEVENT
END:VCALENDAR`);
    const data = eventDataFor(obj, { start: new Date(), end: new Date() });
    expect(data.attendees.map((a) => a.status)).toEqual(['ACCEPTED', 'DECLINED', undefined]);
    const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1), new Set(['me@example.com']));
    expect(occ.selfStatus).toBe('DECLINED');
    const [bob] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1), new Set(['bob@example.com']));
    expect(bob.selfStatus).toBe('NEEDS-ACTION');
  });
});

describe('a reminder relative to the end', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:end-alarm
DTSTART:20261012T070000Z
DTEND:20261012T090000Z
SUMMARY:Exam
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;RELATED=END:-PT30M
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT10M
END:VALARM
END:VEVENT
END:VCALENDAR`;

  it('reminds of the instance before its end, which the editor does not show', () => {
    const obj = parse(ics);
    const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    // Half an hour before the end of a two-hour event: 90 minutes after the start.
    expect(occ.alarms).toEqual([-90, 10]);
    expect(eventDataFor(obj, occ).alarms).toEqual([10]);
  });

  it('stays as written when the event is saved', () => {
    const obj = parse(ics);
    const [occ] = expandEvent(obj, new Date(2026, 9, 1), new Date(2026, 10, 1));
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Final exam', alarms: [60] }, 'all');
    const data = (op as { data: string }).data;
    expect(data).toContain('TRIGGER;RELATED=END:-PT30M');
    expect(data).toContain('TRIGGER:-PT1H');
    expect(data).not.toContain('TRIGGER:-PT10M');
  });
});

describe('editing every instance from one across a change of the clocks', () => {
  it('moves the series by days and time on the clock, not by hours', () => {
    // Weekly on Saturdays at 10:00 from 17 October; the clocks go back in the night to Sunday 25 October.
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dst-all
DTSTART;TZID=Europe/Warsaw:20261017T100000
DTEND;TZID=Europe/Warsaw:20261017T110000
RRULE:FREQ=WEEKLY
SUMMARY:Market
END:VEVENT
END:VCALENDAR`);
    const occ = expandEvent(obj, new Date(2026, 9, 24), new Date(2026, 9, 25))[0];
    expect(occ.start).toEqual(new Date(2026, 9, 24, 10));
    // Moved on by a day, to Sunday 10:00: 25 hours later by the clock that went back.
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), start: new Date(2026, 9, 25, 10), end: new Date(2026, 9, 25, 11) }, 'all');
    const next = expandEvent(parse((op as { data: string }).data), new Date(2026, 9, 1), new Date(2026, 10, 2));
    expect(next.map((o) => [o.start.getDate(), o.start.getHours()])).toEqual([
      [18, 10],
      [25, 10],
      [1, 10],
    ]);
  });
});
