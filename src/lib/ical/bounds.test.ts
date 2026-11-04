import { describe, expect, it, vi } from 'vitest';
import { createEventIcs, expandEvent, MAX_SERIES_DATES, MAX_SERIES_OVERRIDES, readEventData } from './events';
import { parseObject, type RawObject } from './parse';
import { MAX_ZONE_PARTS, ZONE_BUDGET } from './timezone';

// One object must never freeze the app: ical.js expands every part of a
// VTIMEZONE from its DTSTART, and sorts every listed date of a series, again
// at every expansion.

let n = 0;
const raw = (data: string): RawObject => ({ url: `https://x.test/cal/${n++}.ics`, etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') });
const parse = (data: string) => parseObject(raw(data))!;
const timed = <T>(f: () => T) => {
  const started = performance.now();
  const value = f();
  return { value, ms: performance.now() - started };
};

const event = (tzid: string, extra = '') => `BEGIN:VEVENT
UID:zone
DTSTART;TZID=${tzid}:20261012T090000
DTEND;TZID=${tzid}:20261012T100000
SUMMARY:One-off
${extra}END:VEVENT`;

const starts = (data: string, from = '2026-10-01', to = '2026-11-01') => expandEvent(parse(data), new Date(from), new Date(to)).map((o) => o.start.toISOString());

/** A zone of `parts` yearly rules starting in `year`, each passing the rule check on its own. */
function hostileZone(tzid: string, parts: number, year: number) {
  const lines = [`BEGIN:VTIMEZONE`, `TZID:${tzid}`];
  for (let i = 0; i < parts; i++) {
    const kind = i % 2 ? 'DAYLIGHT' : 'STANDARD';
    lines.push(`BEGIN:${kind}`, `DTSTART:${String(year).padStart(4, '0')}0101T0${i % 10}0000`, `TZOFFSETFROM:+0${i % 9}00`, `TZOFFSETTO:+0${(i + 1) % 9}00`, `RRULE:FREQ=YEARLY;BYMONTH=${(i % 12) + 1}`, `END:${kind}`);
  }
  return [...lines, 'END:VTIMEZONE'].join('\n');
}

/** Europe/Warsaw as a "full history" VTIMEZONE is written: many one-off parts, RDATE lists, rules with UNTIL. */
const WARSAW_FULL = `BEGIN:VTIMEZONE
TZID:Europe/Warsaw
BEGIN:STANDARD
DTSTART:18800101T000000
TZOFFSETFROM:+012400
TZOFFSETTO:+012400
TZNAME:WMT
END:STANDARD
BEGIN:STANDARD
DTSTART:19150805T000000
TZOFFSETFROM:+012400
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19160430T230000
RDATE:19170416T020000,19180415T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19161001T010000
RDATE:19170917T030000,19180916T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19400623T020000
RDATE:19430329T020000,19440403T020000,19450429T000000,19460414T000000,19470504T020000,19480418T020000,19490410T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19421102T030000
RDATE:19431004T030000,19441004T020000,19461007T030000,19471005T030000,19481003T030000,19491002T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19570602T010000
RDATE:19580330T010000,19590531T010000,19600403T010000,19610528T010000,19620527T010000,19630526T010000,19640531T010000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19570929T020000
RDATE:19580928T020000,19591004T020000,19601002T020000,19611001T020000,19620930T020000,19630929T020000,19640927T020000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19770403T010000
RRULE:FREQ=YEARLY;UNTIL=19800406T000000Z;BYMONTH=4;BYDAY=1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19770925T020000
RRULE:FREQ=YEARLY;UNTIL=19950924T000000Z;BYMONTH=9;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19810329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19961027T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
END:STANDARD
END:VTIMEZONE`;

/** As a well-known mail program writes its zones: from 1601, under a Windows name. */
const OUTLOOK = `BEGIN:VTIMEZONE
TZID:Central European Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE`;

const US_EASTERN = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
END:STANDARD
END:VTIMEZONE`;

describe('VTIMEZONE bounds', () => {
  it('keeps real zones and reads them as before: full history, 1601 rules, a short modern zone', () => {
    for (const [zone, tzid, summer, winter] of [
      [WARSAW_FULL, 'Europe/Warsaw', '2026-06-12T07:00:00.000Z', '2026-12-12T08:00:00.000Z'],
      [OUTLOOK, 'Central European Standard Time', '2026-06-12T07:00:00.000Z', '2026-12-12T08:00:00.000Z'],
      [US_EASTERN, 'America/New_York', '2026-06-12T13:00:00.000Z', '2026-12-12T14:00:00.000Z'],
    ]) {
      const data = `BEGIN:VCALENDAR\n${zone}\n${event(tzid, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=12;COUNT=12\n').replace('20261012', '20260112').replace('20261012', '20260112')}\nEND:VCALENDAR`;
      const obj = parse(data);
      expect(obj.root.getAllSubcomponents('vtimezone'), tzid).toHaveLength(1);
      const all = expandEvent(obj, new Date('2026-01-01'), new Date('2027-01-01')).map((o) => o.start.toISOString());
      expect(all, tzid).toHaveLength(12);
      expect(all, tzid).toContain(summer);
      expect(all, tzid).toContain(winter);
    }
  });

  it('keeps an event with several zones of 1601 rules', () => {
    const zones = ['Central European Standard Time', 'W. Europe Standard Time', 'GMT Standard Time', 'Romance Standard Time', 'E. Europe Standard Time'].map((name) => OUTLOOK.replace('Central European Standard Time', name));
    const obj = parse(`BEGIN:VCALENDAR\n${zones.join('\n')}\n${event('Central European Standard Time')}\nEND:VCALENDAR`);
    expect(obj.root.getAllSubcomponents('vtimezone')).toHaveLength(5);
  });

  it('drops a zone of many rules from year 1, which took seconds to read, and reads the time in the zone of its name', () => {
    const { value, ms } = timed(() => starts(`BEGIN:VCALENDAR\n${hostileZone('Europe/Warsaw', 50, 1)}\n${event('Europe/Warsaw')}\nEND:VCALENDAR`));
    expect(ms).toBeLessThan(1000);
    expect(value).toEqual(['2026-10-12T07:00:00.000Z']);
  });

  it('spends the budget once per object, on the zones that come first', () => {
    // Each fits alone; together they do not.
    const each = Math.floor(ZONE_BUDGET / 3);
    // A part costs itself and each year of its rule.
    const years = Math.floor(each / 4) - 1;
    const year = new Date().getFullYear() + 10 - years + 1;
    const zones = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E'].map((z) => hostileZone(z, 4, year));
    const obj = parse(`BEGIN:VCALENDAR\n${zones.join('\n')}\n${event('Zone A')}\nEND:VCALENDAR`);
    expect(obj.root.getAllSubcomponents('vtimezone').map((z) => z.getFirstPropertyValue('tzid'))).toEqual(['Zone A', 'Zone B', 'Zone C']);
  });

  it('drops a zone of more parts than any real one', () => {
    const lines = ['BEGIN:VTIMEZONE', 'TZID:Many'];
    for (let i = 0; i <= MAX_ZONE_PARTS; i++) lines.push('BEGIN:STANDARD', `DTSTART:${2000 + (i % 20)}0101T000000`, 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0100', 'END:STANDARD');
    lines.push('END:VTIMEZONE');
    const obj = parse(`BEGIN:VCALENDAR\n${lines.join('\n')}\n${event('Many')}\nEND:VCALENDAR`);
    expect(obj.root.getAllSubcomponents('vtimezone')).toHaveLength(0);
  });
});

describe('a calendar object that does not parse', () => {
  it('is logged by the kind of error, without the text the parser quotes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseObject(raw('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Secret diagnosis\nmeeting with Dr Who\nEND:VEVENT\nEND:VCALENDAR'))).toBeNull();
      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls.flat().map((v) => (v instanceof Error ? `${v.name} ${v.message}` : String(v))).join(' ');
      expect(logged).not.toMatch(/Dr Who|Secret/);
      expect(logged).toMatch(/Error/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('values copied into a new object', () => {
  it('cannot start lines of their own from a URL or COLOR written as TEXT', () => {
    const obj = parse(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:inject
DTSTART:20261012T090000Z
DTEND:20261012T100000Z
SUMMARY:Line\\nbreak kept
URL;VALUE=TEXT:https://example.com/a\\nX-INJ:1\\nATTENDEE:mailto:evil@example.com
COLOR;VALUE=TEXT:rgb(1,2,3)\\nEND:VEVENT\\nBEGIN:VEVENT
END:VEVENT
END:VCALENDAR`);
    const data = readEventData(obj.root.getFirstSubcomponent('vevent')!);
    expect(data.url).toContain('\n');
    const ics = createEventIcs({ ...data, uid: 'copy' });
    const lines = ics.split(/\r?\n/);
    expect(lines.some((l) => /^(X-INJ|ATTENDEE)/.test(l))).toBe(false);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toContain('URL:https://example.com/aX-INJ:1ATTENDEE:mailto:evil@example.com');
    // A TEXT value keeps its line break, escaped.
    expect(ics).toContain('SUMMARY:Line\\nbreak kept');
  });
});

describe('series bounds', () => {
  const series = (extra: string, after = '') => `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:s
DTSTART:20260901T090000Z
DTEND:20260901T100000Z
RRULE:FREQ=DAILY
${extra}SUMMARY:Standup
END:VEVENT
${after}END:VCALENDAR`;
  const exdates = (count: number) =>
    Array.from({ length: count }, (_, i) => `EXDATE:${new Date(Date.UTC(1990, 0, 1) + i * 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, '')}T090000Z\n`).join('');
  const overrides = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(Date.UTC(2030, 0, 1) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      return `BEGIN:VEVENT\nUID:s\nRECURRENCE-ID:${d}T090000Z\nDTSTART:${d}T100000Z\nDTEND:${d}T110000Z\nSUMMARY:Moved\nEND:VEVENT\n`;
    }).join('');

  it('expands a series with as many listed dates and overrides as real ones have', () => {
    expect(starts(series(exdates(MAX_SERIES_DATES)), '2026-10-01', '2026-10-04')).toHaveLength(3);
    expect(starts(series('', overrides(300)), '2026-10-01', '2026-10-04')).toHaveLength(3);
  });

  it('keeps expanding a series with more listed dates than that, with those nearest to now, quickly every time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    try {
      // Thousands of exceptions long past, and one tomorrow.
      const data = series(`${exdates(MAX_SERIES_DATES + 1)}EXDATE:20261002T090000Z\n`);
      const obj = parse(data);
      const { value, ms } = timed(() => {
        let last: Date[] = [];
        for (let i = 0; i < 20; i++) last = expandEvent(obj, new Date('2026-10-01'), new Date('2026-10-05')).map((o) => o.start);
        return last;
      });
      expect(value.map((d) => d.toISOString())).toEqual(['2026-10-01T09:00:00.000Z', '2026-10-03T09:00:00.000Z', '2026-10-04T09:00:00.000Z']);
      expect(ms).toBeLessThan(2000);
      // The object itself keeps every one of them.
      expect(obj.root.getFirstSubcomponent('vevent')!.getAllProperties('exdate')).toHaveLength(MAX_SERIES_DATES + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps expanding a series with more overrides than that, with those nearest to now', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    try {
      const near = 'BEGIN:VEVENT\nUID:s\nRECURRENCE-ID:20261002T090000Z\nDTSTART:20261002T100000Z\nDTEND:20261002T110000Z\nSUMMARY:Moved near\nEND:VEVENT\n';
      const obj = parse(series('', near + overrides(MAX_SERIES_OVERRIDES)));
      const occ = expandEvent(obj, new Date('2026-10-01'), new Date('2026-10-04'));
      expect(occ.map((o) => [o.start.toISOString(), o.title, o.isRecurring])).toEqual([
        ['2026-10-01T09:00:00.000Z', 'Standup', true],
        ['2026-10-02T10:00:00.000Z', 'Moved near', true],
        ['2026-10-03T09:00:00.000Z', 'Standup', true],
      ]);
      // An override kept: one of the near ones of 2030.
      expect(expandEvent(obj, new Date('2030-01-01'), new Date('2030-01-02')).map((o) => o.title)).toEqual(['Moved']);
      // The one furthest away is left out: its instance is the series' own.
      const last = new Date(Date.UTC(2030, 0, 1) + (MAX_SERIES_OVERRIDES - 1) * 86400000);
      const day = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
      expect(expandEvent(obj, last, day(last, 1)).map((o) => [o.start.toISOString(), o.title])).toEqual([[`${last.toISOString().slice(0, 10)}T09:00:00.000Z`, 'Standup']]);
      expect(obj.root.getAllSubcomponents('vevent')).toHaveLength(MAX_SERIES_OVERRIDES + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
