import ICAL from 'ical.js';
import { describe, expect, it, vi } from 'vitest';
import { clearParseCache, parseIcs, parseObject } from './parse';

/** A zone written the way calendar programs write it (a made-up name, so the platform's never stands in). */
const ZONE = (offset = '+0100') => `BEGIN:VTIMEZONE
TZID:Test/Shared
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:${offset}
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:${offset}
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE`;

const event = (uid: string, zone = ZONE()) =>
  `BEGIN:VCALENDAR
VERSION:2.0
${zone}
BEGIN:VEVENT
UID:${uid}
SUMMARY:Private title ${uid}
DTSTART;TZID=Test/Shared:20260701T090000
DTEND;TZID=Test/Shared:20260701T100000
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

const startOf = (root: ICAL.Component) => (root.getFirstSubcomponent('vevent')!.getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate().toISOString();

describe('time zones of parsed objects', () => {
  it('are read once for every object that defines them alike', () => {
    clearParseCache();
    const a = parseIcs(event('a'));
    const b = parseIcs(event('b'));
    expect(a.getTimeZoneByID('Test/Shared')).toBe(b.getTimeZoneByID('Test/Shared'));
    // Summer time: +02:00.
    expect(startOf(a)).toBe('2026-07-01T07:00:00.000Z');
    expect(startOf(b)).toBe('2026-07-01T07:00:00.000Z');
  });

  it('hold nothing of the item they came from', () => {
    clearParseCache();
    const zone = parseIcs(event('secret')).getTimeZoneByID('Test/Shared')!;
    expect(zone.component.parent).toBeNull();
    expect(zone.component.toString()).not.toContain('Private title');
  });

  it('stay apart when the definitions differ under the same name', () => {
    clearParseCache();
    const a = parseIcs(event('a'));
    const c = parseIcs(event('c', ZONE('+0000')));
    expect(a.getTimeZoneByID('Test/Shared')).not.toBe(c.getTimeZoneByID('Test/Shared'));
    // In winter the two zones differ by an hour.
    const winter = (root: ICAL.Component) => ICAL.Time.fromData({ year: 2026, month: 1, day: 10, hour: 9 }, root.getTimeZoneByID('Test/Shared')!).toJSDate().toISOString();
    expect(winter(a)).toBe('2026-01-10T08:00:00.000Z');
    expect(winter(c)).toBe('2026-01-10T09:00:00.000Z');
  });
});

describe('an object that cannot be read', () => {
  it('is logged by the kind of failure alone: no address of a server, no content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const url = 'https://dav.private.example/alice/cal/x.ics';
      expect(parseObject({ url, etag: '"1"', calendarId: 'c', data: 'BEGIN:VCALENDAR\r\nSUMMARY;X=":Secret plans\r\n' })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain('dav.private.example');
      expect(logged).not.toContain('Secret');
    } finally {
      warn.mockRestore();
    }
  });
});
