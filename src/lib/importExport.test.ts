import { describe, expect, it } from 'vitest';
import { mergeObjects, splitIcsFile } from './importExport';

const FILE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VTIMEZONE
TZID:Custom/Zone
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0300
TZOFFSETTO:+0300
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:a
DTSTART;TZID=Custom/Zone:20261012T090000
SUMMARY:A
RRULE:FREQ=DAILY
END:VEVENT
BEGIN:VEVENT
UID:a
RECURRENCE-ID;TZID=Custom/Zone:20261013T090000
DTSTART;TZID=Custom/Zone:20261013T100000
SUMMARY:A moved
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261020
SUMMARY:No uid
END:VEVENT
BEGIN:VTODO
UID:t
SUMMARY:Todo
END:VTODO
END:VCALENDAR`.replace(/\n/g, '\r\n');

describe('import/export', () => {
  it('splits a file into one object per UID with its timezones', () => {
    const items = splitIcsFile(FILE);
    expect(items).toHaveLength(3);
    const a = items.find((i) => i.uid === 'a')!;
    expect(a.data.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(a.data).toContain('TZID:Custom/Zone');
    expect(items.find((i) => i.kind === 'task')!.uid).toBe('t');
    // An event without a UID gets a fresh one, a random id at the app's domain.
    expect(items.some((i) => /^[0-9a-f-]{36}@[a-z0-9.-]+$/.test(i.uid))).toBe(true);
  });

  it('splits a file of many objects that share one UID in linear time', () => {
    const event = 'BEGIN:VEVENT\r\nUID:same\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260101T100000Z\r\nSUMMARY:x\r\nEND:VEVENT\r\n';
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//t//EN\r\n' + event.repeat(40000) + 'END:VCALENDAR\r\n';
    const started = performance.now();
    const items = splitIcsFile(text);
    expect(items).toHaveLength(1);
    // Copying the group on every add took about 10 s for these 40,000; pushing onto it takes about 1.5 s.
    expect(performance.now() - started).toBeLessThan(6000);
  });

  it('merges objects and de-duplicates timezones', () => {
    const items = splitIcsFile(FILE);
    const merged = mergeObjects(
      items.map((i) => ({ url: i.uid, etag: '', calendarId: 'c', data: i.data })),
      'My cal',
    );
    expect(merged.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
    expect(merged.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(merged).toContain('X-WR-CALNAME:My cal');
  });
});
