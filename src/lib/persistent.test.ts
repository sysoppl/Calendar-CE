import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { createEventIcs, duplicateEventIcs, eventDataFor, expandEvent, updateEvent } from './ical/events';
import { parseObject, type RawObject } from './ical/parse';
import { createTaskIcs, emptyTask, readTask, setTaskCompleted, updateTaskIcs } from './ical/tasks';
import type { EventData } from './ical/types';
import { readPersistent, writePersistent } from './persistent';

const raw = (data: string, url = 'https://x.test/cal/p.ics'): RawObject => ({ url, etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') });
const parse = (data: string) => parseObject(raw(data))!;
const vevent = (...lines: string[]) => new ICAL.Component(ICAL.parse(['BEGIN:VEVENT', 'UID:p', ...lines, 'END:VEVENT'].join('\r\n')) as unknown as unknown[]);
const out = (op: unknown) => (op as { data: string }).data;
const IN_2026: [Date, Date] = [new Date(2026, 0, 1), new Date(2027, 0, 1)];

const SERIES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:pills-1
DTSTART:20260612T080000Z
DTEND:20260612T081500Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Take the pills
X-PATRYKPRO-PERSISTENT:TRUE
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT5M
END:VALARM
END:VEVENT
END:VCALENDAR`;

const data = (over: Partial<EventData> = {}): EventData => ({
  uid: 'u1',
  title: 'Call the bank',
  description: '',
  location: '',
  start: new Date(2026, 5, 12, 10),
  end: new Date(2026, 5, 12, 11),
  allDay: false,
  timezone: 'floating',
  alarms: [10],
  busy: true,
  attendees: [],
  categories: [],
  ...over,
});

describe('X-PATRYKPRO-PERSISTENT', () => {
  it('is TRUE in any case, and anything else is not', () => {
    expect(readPersistent(vevent('X-PATRYKPRO-PERSISTENT:TRUE'))).toBe(true);
    expect(readPersistent(vevent('X-PATRYKPRO-PERSISTENT:true'))).toBe(true);
    expect(readPersistent(vevent('X-PATRYKPRO-PERSISTENT:FALSE'))).toBe(false);
    expect(readPersistent(vevent('X-PATRYKPRO-PERSISTENT:'))).toBe(false);
    expect(readPersistent(vevent('SUMMARY:x'))).toBe(false);
  });

  it('is written and removed', () => {
    const comp = vevent('SUMMARY:x');
    writePersistent(comp, true);
    expect(comp.toString()).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    writePersistent(comp, false);
    expect(comp.toString()).not.toContain('X-PATRYKPRO-PERSISTENT');
  });
});

describe('persistent events', () => {
  it('are created, kept by a move and a duplicate, and turned off again', () => {
    const obj = parse(createEventIcs(data({ persistent: true })));
    expect(obj.root.toString()).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    const occ = expandEvent(obj, ...IN_2026)[0];
    expect(occ.persistent).toBe(true);
    expect(eventDataFor(obj, occ).persistent).toBe(true);
    const [moved] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), start: new Date(2026, 5, 13, 10), end: new Date(2026, 5, 13, 11) }, 'all');
    expect(out(moved)).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    expect(duplicateEventIcs(obj, false).data).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    const [off] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), persistent: false }, 'all');
    expect(out(off)).not.toContain('X-PATRYKPRO-PERSISTENT');
  });

  it('belong to the series: one instance edited carries no copy, and the choice made there is made for all', () => {
    const obj = parse(SERIES);
    const occs = expandEvent(obj, ...IN_2026);
    expect(occs.map((o) => o.persistent)).toEqual([true, true, true]);
    const [kept] = updateEvent(obj, occs[1], { ...eventDataFor(obj, occs[1]), title: 'Take the pills with water' }, 'single');
    expect(out(kept).match(/X-PATRYKPRO-PERSISTENT/g)).toHaveLength(1);
    const keptObj = parse(out(kept));
    expect(expandEvent(keptObj, ...IN_2026).every((o) => o.persistent)).toBe(true);

    const edited = expandEvent(keptObj, ...IN_2026)[1];
    expect(edited.isException).toBe(true);
    const [off] = updateEvent(keptObj, edited, { ...eventDataFor(keptObj, edited), persistent: false }, 'single');
    expect(expandEvent(parse(out(off)), ...IN_2026).map((o) => o.persistent)).toEqual([false, false, false]);
  });

  it('go on in the later part of a split series', () => {
    const obj = parse(SERIES);
    const occ = expandEvent(obj, ...IN_2026)[1];
    const ops = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Pills' }, 'future');
    expect(out(ops.find((o) => o.type === 'create'))).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    expect(out(ops.find((o) => o.type === 'update'))).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
  });
});

describe('persistent tasks', () => {
  const due = new Date(2026, 5, 12, 18);

  it('are created, read and turned off again', () => {
    const obj = parse(createTaskIcs(emptyTask({ uid: 't1', title: 'Pay rent', due, dueAllDay: false, alarms: [0], persistent: true })));
    const task = readTask(obj)!;
    expect(task.persistent).toBe(true);
    expect(updateTaskIcs(obj, { ...task, title: 'Pay the rent' })).toContain('X-PATRYKPRO-PERSISTENT:TRUE');
    expect(updateTaskIcs(obj, { ...task, persistent: false })).not.toContain('X-PATRYKPRO-PERSISTENT');
    expect(readTask(parse(createTaskIcs(emptyTask({ uid: 't2', title: 'Water the plants', due }))))!.persistent).toBe(false);
  });

  it('stay persistent when a repeating one moves on to its next date, and when one is done', () => {
    const obj = parse(createTaskIcs(emptyTask({ uid: 't3', title: 'Take out the bins', due, dueAllDay: false, alarms: [0], persistent: true, rrule: { freq: 'WEEKLY', interval: 1 } })));
    const next = readTask(parse(setTaskCompleted(obj, true)))!;
    expect([next.completed, next.persistent, next.due!.getTime() > due.getTime()]).toEqual([false, true, true]);
    const single = parse(createTaskIcs(emptyTask({ uid: 't4', title: 'Pay rent', due, dueAllDay: false, alarms: [0], persistent: true })));
    const done = readTask(parse(setTaskCompleted(single, true)))!;
    expect([done.completed, done.persistent]).toEqual([true, true]);
  });
});
