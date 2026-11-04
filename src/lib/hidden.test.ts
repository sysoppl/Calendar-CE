import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { translate, type TFunction } from '@/i18n';
import { createEventIcs, duplicateEventIcs, eventDataFor, expandEvent, updateEvent } from './ical/events';
import { parseObject, type RawObject } from './ical/parse';
import type { EventData } from './ical/types';
import { readHidden, shownTitle, writeHidden } from './hidden';

const t: TFunction = (key, vars) => translate('en', key, vars);
const raw = (data: string, url = 'https://x.test/cal/h.ics'): RawObject => ({ url, etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') });
const parse = (data: string) => parseObject(raw(data))!;
const vevent = (...lines: string[]) => new ICAL.Component(ICAL.parse(['BEGIN:VEVENT', 'UID:h', ...lines, 'END:VEVENT'].join('\r\n')) as unknown as unknown[]);
const out = (op: unknown) => (op as { data: string }).data;
const IN_2026: [Date, Date] = [new Date(2026, 0, 1), new Date(2027, 0, 1)];

const SERIES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:party-1
DTSTART;VALUE=DATE:20260612
DTEND;VALUE=DATE:20260613
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Surprise party for Ola
LOCATION:Ola's flat
X-PATRYKPRO-HIDDEN:TRUE
END:VEVENT
END:VCALENDAR`;

const data = (over: Partial<EventData> = {}): EventData => ({
  uid: 'u1',
  title: 'Gift shopping',
  description: '',
  location: '',
  start: new Date(2026, 5, 12, 10),
  end: new Date(2026, 5, 12, 11),
  allDay: false,
  timezone: 'floating',
  alarms: [],
  busy: true,
  attendees: [],
  categories: [],
  ...over,
});

describe('X-PATRYKPRO-HIDDEN', () => {
  it('is TRUE in any case, and anything else is not', () => {
    expect(readHidden(vevent('X-PATRYKPRO-HIDDEN:TRUE'))).toBe(true);
    expect(readHidden(vevent('X-PATRYKPRO-HIDDEN:true'))).toBe(true);
    expect(readHidden(vevent('X-PATRYKPRO-HIDDEN:FALSE'))).toBe(false);
    expect(readHidden(vevent('X-PATRYKPRO-HIDDEN:'))).toBe(false);
    expect(readHidden(vevent('SUMMARY:x'))).toBe(false);
    // The standard classification is the server's business, not this screen's.
    expect(readHidden(vevent('CLASS:PRIVATE'))).toBe(false);
  });

  it('is written and removed', () => {
    const comp = vevent('SUMMARY:x');
    writeHidden(comp, true);
    expect(comp.toString()).toContain('X-PATRYKPRO-HIDDEN:TRUE');
    writeHidden(comp, false);
    expect(comp.toString()).not.toContain('X-PATRYKPRO-HIDDEN');
  });
});

describe('shownTitle', () => {
  it('names a hidden event only as one, without the years of a birthday', () => {
    const start = new Date(2026, 4, 12);
    expect(shownTitle({ title: 'Surprise', start, hidden: true }, t)).toBe('Hidden event');
    expect(shownTitle({ title: 'Anna’s birthday', since: new Date(1990, 4, 12), start, hidden: true }, t)).toBe('Hidden event');
    expect(shownTitle({ title: 'Anna’s birthday', since: new Date(1990, 4, 12), start }, t)).toBe('Anna’s birthday (36)');
    expect(shownTitle({ title: '', start }, t)).toBe(t('grid.noTitle'));
  });
});

describe('hidden events', () => {
  it('are hidden on every instance, and the editor gets the real title', () => {
    const obj = parse(SERIES);
    const occs = expandEvent(obj, ...IN_2026);
    expect(occs.map((o) => [o.hidden, shownTitle(o, t)])).toEqual([
      [true, 'Hidden event'],
      [true, 'Hidden event'],
      [true, 'Hidden event'],
    ]);
    const edited = eventDataFor(obj, occs[1]);
    expect([edited.title, edited.location, edited.hidden]).toEqual(['Surprise party for Ola', "Ola's flat", true]);
  });

  it('are created, kept by a move and a duplicate, and shown again', () => {
    const obj = parse(createEventIcs(data({ hidden: true })));
    expect(out({ data: obj.root.toString() })).toContain('X-PATRYKPRO-HIDDEN:TRUE');
    const occ = expandEvent(obj, ...IN_2026)[0];
    expect(occ.hidden).toBe(true);
    const [moved] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), start: new Date(2026, 5, 13, 10), end: new Date(2026, 5, 13, 11) }, 'all');
    expect(out(moved)).toContain('X-PATRYKPRO-HIDDEN:TRUE');
    expect(duplicateEventIcs(obj, false).data).toContain('X-PATRYKPRO-HIDDEN:TRUE');
    const [shown] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), hidden: false }, 'all');
    expect(out(shown)).not.toContain('X-PATRYKPRO-HIDDEN');
  });

  it('leave events without the property as they were', () => {
    const obj = parse(SERIES.replace('X-PATRYKPRO-HIDDEN:TRUE\n', ''));
    const occ = expandEvent(obj, ...IN_2026)[0];
    expect([occ.hidden, shownTitle(occ, t)]).toEqual([false, 'Surprise party for Ola']);
    expect(out(updateEvent(obj, occ, { ...eventDataFor(obj, occ), description: 'x' }, 'all')[0])).not.toContain('X-PATRYKPRO-HIDDEN');
  });

  it('belong to the series: one instance edited carries no copy, and hiding or showing it there does it for all', () => {
    const obj = parse(SERIES);
    const occ = expandEvent(obj, ...IN_2026)[1];
    const [kept] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), location: 'Park' }, 'single');
    expect(out(kept).match(/X-PATRYKPRO-HIDDEN/g)).toHaveLength(1);
    const keptObj = parse(out(kept));
    expect(expandEvent(keptObj, ...IN_2026).every((o) => o.hidden)).toBe(true);

    const moved = expandEvent(keptObj, ...IN_2026)[1];
    expect(moved.isException).toBe(true);
    const [shown] = updateEvent(keptObj, moved, { ...eventDataFor(keptObj, moved), hidden: false }, 'single');
    expect(expandEvent(parse(out(shown)), ...IN_2026).map((o) => o.hidden)).toEqual([false, false, false]);
  });

  it('go on hidden in the later part of a split series', () => {
    const obj = parse(SERIES);
    const occ = expandEvent(obj, ...IN_2026)[1];
    const ops = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Surprise party!' }, 'future');
    expect(out(ops.find((o) => o.type === 'create'))).toContain('X-PATRYKPRO-HIDDEN:TRUE');
    expect(out(ops.find((o) => o.type === 'update'))).toContain('X-PATRYKPRO-HIDDEN:TRUE');
  });
});
