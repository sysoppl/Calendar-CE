import ICAL from 'ical.js';
import { describe, expect, it, vi } from 'vitest';
import { eventDataFor, expandEvent, updateEvent } from './events';
import { parseObject } from './parse';
import { buildVTimezone, ensureTimezone, ensureTimezonesFor, normalizeOffsetZone, offsetMinutes, resolveTzid } from './timezone';

describe('timezone helpers', () => {
  it('computes offsets across DST', () => {
    expect(offsetMinutes('Europe/Warsaw', new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(offsetMinutes('Europe/Warsaw', new Date('2026-07-15T12:00:00Z'))).toBe(120);
    expect(offsetMinutes('Asia/Kolkata', new Date('2026-07-15T12:00:00Z'))).toBe(330);
  });

  it('resolves Windows and prefixed zone names', () => {
    expect(resolveTzid('Central European Standard Time')).toBe('Europe/Warsaw');
    expect(resolveTzid('/freeassociation.sourceforge.net/Tzfile/Europe/Warsaw')).toBe('Europe/Warsaw');
    expect(resolveTzid('Nowhere/Land')).toBeUndefined();
  });

  it('builds a VTIMEZONE with EU rules', () => {
    const vtz = buildVTimezone('Europe/Warsaw', 2026)!;
    expect(vtz).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
    expect(vtz).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
    expect(vtz).toContain('TZOFFSETTO:+0200');
    expect(vtz).toContain('DTSTART:19700329T020000');
  });

  it('builds a VTIMEZONE with US rules (nth weekday)', () => {
    const vtz = buildVTimezone('America/New_York', 2026)!;
    expect(vtz).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(vtz).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
  });

  it('handles zones without DST', () => {
    const vtz = buildVTimezone('Asia/Tokyo', 2026)!;
    expect(vtz).toContain('TZOFFSETTO:+0900');
    expect(vtz).not.toContain('RRULE');
  });

  it('maps raw offset zones to valid TZIDs', () => {
    expect(normalizeOffsetZone('+00:00')).toBe('UTC');
    expect(normalizeOffsetZone('+02:00')).toBe('Etc/GMT-2');
    expect(normalizeOffsetZone('-05:00')).toBe('Etc/GMT+5');
    expect(normalizeOffsetZone('Europe/Warsaw')).toBe('Europe/Warsaw');
  });

  it('registers zones so ical.js converts correctly', () => {
    expect(ensureTimezone('Australia/Sydney')).toBe('Australia/Sydney');
    const comp = new ICAL.Component(
      ICAL.parse('BEGIN:VEVENT\r\nDTSTART;TZID=Australia/Sydney:20260115T090000\r\nEND:VEVENT'),
    );
    const t = comp.getFirstPropertyValue('dtstart') as ICAL.Time;
    expect(t.toJSDate().toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });
});


describe('the scan for the zones a text needs', () => {
  const wrap = (...lines: string[]) =>
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261012T090000Z', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

  it('takes time in proportion to the text', () => {
    // A megabyte of zone starts that never get a TZID: each used to send the scan to the end of the text.
    const text = wrap(`DESCRIPTION:${'BEGIN:VTIMEZONE '.repeat(65536)}`);
    const started = performance.now();
    ensureTimezonesFor(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('reads TZID from parameters, folded or quoted, and not from values', () => {
    ensureTimezonesFor(
      wrap(
        'DESCRIPTION:see ;TZID=Pacific/Chatham: for details',
        'DTEND;TZID=America/Argentina/Bu\r\n enos_Aires:20261012T100000',
        'RDATE;TZID="Africa/Lagos":20261013T090000',
      ),
    );
    expect(ICAL.TimezoneService.has('Pacific/Chatham')).toBe(false);
    // Under the platform's name for it, which may be an older one.
    expect(ICAL.TimezoneService.has(resolveTzid('America/Argentina/Buenos_Aires')!)).toBe(true);
    expect(ICAL.TimezoneService.has('Africa/Lagos')).toBe(true);
  });

  it('makes up a bounded number of zones per text and works out each real zone once', () => {
    const scans = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const names = Array.from({ length: 1000 }, (_, i) => `/x${i}/Asia/Kathmandu`);
    const renamed = ensureTimezonesFor(wrap(...names.map((n) => `EXDATE;TZID=${n}:20261012T090000`)));
    // The platform's name for the zone, which may be an older one (Asia/Katmandu).
    expect(renamed.get(names[0])).toBe(resolveTzid('Asia/Kathmandu'));
    expect(renamed.size).toBe(32);
    expect(names.filter((n) => ICAL.TimezoneService.has(n))).toEqual([]);
    // One year of the zone is scanned once (a few hundred calls), not once per name.
    expect(scans.mock.calls.length).toBeLessThan(1000);
    scans.mockRestore();
  });

  it('registers nothing for a name it cannot place', () => {
    expect(ensureTimezonesFor(wrap('EXDATE;TZID=Nowhere/Land:20261012T090000'))).toEqual(new Map());
    expect(ensureTimezone('Nowhere/Land')).toBeUndefined();
    expect(ICAL.TimezoneService.has('Nowhere/Land')).toBe(false);
  });
});

describe('other names for a zone', () => {
  const NEW_YORK = '/mozilla.org/20050126_1/America/New_York';
  let serial = 0;
  /** One stored object, as a CalDAV server or a shared calendar hands it over, without VTIMEZONE. */
  const object = (...lines: string[]) => {
    const id = `alias-${serial++}`;
    const data = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', `UID:${id}`, ...lines, 'SUMMARY:Call', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    return parseObject({ url: `https://dav.test/cal/${id}.ics`, etag: '"1"', calendarId: 'cal', data })!;
  };
  const only = (obj: ReturnType<typeof object>) => {
    const occs = expandEvent(obj, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(occs).toHaveLength(1);
    return occs[0];
  };

  it('are never used up by one calendar for the others', () => {
    // A hostile server's objects, each naming as many made-up zones as one may.
    for (let n = 0; n < 40; n++) {
      only(object('DTSTART:20261012T090000Z', ...Array.from({ length: 32 }, (_, i) => `EXDATE;TZID=/h${n}-${i}/America/New_York:20261013T090000`)));
    }

    const occ = only(object(`DTSTART;TZID=${NEW_YORK}:20261020T090000`, `DTEND;TZID=${NEW_YORK}:20261020T100000`));
    expect(occ.start.toISOString()).toBe('2026-10-20T13:00:00.000Z');
    expect(occ.floating).toBe(false);
    expect(ensureTimezone('/late/Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('register the zone once and none of its names, however many there are', () => {
    const names = ['/a/Europe/Warsaw', 'europe/warsaw', 'EUROPE/WARSAW', ' Europe/Warsaw', 'Central European Standard Time'];
    for (const name of names) {
      const occ = only(object(`DTSTART;TZID="${name}":20261020T090000`));
      expect(occ.start.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    }
    expect(ICAL.TimezoneService.has('Europe/Warsaw')).toBe(true);
    for (const name of names) expect(ICAL.TimezoneService.has(name)).toBe(false);
  });

  it('are saved as the zone, not as floating time', () => {
    for (const name of [NEW_YORK, 'Eastern Standard Time']) {
      const obj = object(`DTSTART;TZID=${name}:20261020T090000`, `DTEND;TZID=${name}:20261020T100000`);
      const occ = only(obj);
      const data = eventDataFor(obj, occ);
      expect(data.timezone).toBe('America/New_York');
      const [op] = updateEvent(obj, occ, { ...data, title: 'Renamed' }, 'all');
      const text = (op as { data: string }).data;
      expect(text).toMatch(/^DTSTART;TZID=America\/New_York:20261020T090000\r$/m);
      const again = only(parseObject({ url: obj.url, etag: '"2"', calendarId: 'cal', data: text })!);
      expect(again.start.toISOString()).toBe('2026-10-20T13:00:00.000Z');
      expect(again.floating).toBe(false);
    }
  });
});
