import { describe, expect, it } from 'vitest';
import { expandEvent, respondToEvent } from './events';
import { parseObject, type RawObject } from './parse';

const raw = (data: string): RawObject => ({ url: 'https://x.test/cal/a.ics', etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') });
const parse = (data: string) => parseObject(raw(data))!;
const updated = (ops: ReturnType<typeof respondToEvent>) => parse((ops[0] as { data: string }).data);

const ME = new Set(['me@example.com']);
const OCTOBER = [new Date(2026, 9, 1), new Date(2026, 10, 1)] as const;

const INVITE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:invite-1
SEQUENCE:3
DTSTART:20261014T080000Z
DTEND:20261014T090000Z
SUMMARY:Offsite kickoff
ORGANIZER;CN=Anna:mailto:anna@example.com
ATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:Me@Example.com
ATTENDEE;CN=Tom;PARTSTAT=ACCEPTED:mailto:tom@example.com
END:VEVENT
END:VCALENDAR`;

const SERIES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:series-1
DTSTART:20261005T080000Z
DTEND:20261005T090000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Review
ORGANIZER:mailto:anna@example.com
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com
END:VEVENT
END:VCALENDAR`;

describe('invitations', () => {
  it("reads the user's own reply, matching addresses case-insensitively", () => {
    const obj = parse(INVITE);
    expect(expandEvent(obj, ...OCTOBER, ME)[0].selfStatus).toBe('NEEDS-ACTION');
    expect(expandEvent(obj, ...OCTOBER, new Set(['tom@example.com']))[0].selfStatus).toBe('ACCEPTED');
  });

  it('has no reply for outsiders, for the organizer, or without known addresses', () => {
    const obj = parse(INVITE);
    expect(expandEvent(obj, ...OCTOBER, new Set(['someone@example.com']))[0].selfStatus).toBeUndefined();
    expect(expandEvent(obj, ...OCTOBER, new Set(['anna@example.com']))[0].selfStatus).toBeUndefined();
    expect(expandEvent(obj, ...OCTOBER)[0].selfStatus).toBeUndefined();
  });

  it('sets only the own PARTSTAT and leaves SEQUENCE to the organizer', () => {
    const obj = parse(INVITE);
    const [occ] = expandEvent(obj, ...OCTOBER, ME);
    const ops = respondToEvent(obj, occ, ME, 'ACCEPTED', 'all');
    expect(ops).toHaveLength(1);
    const data = (ops[0] as { data: string }).data;
    expect(data).toMatch(/SEQUENCE:3\r\n/);
    expect(data.replace(/\r\n /g, '')).toMatch(/ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:Me@Example\.com/);
    expect(data).not.toMatch(/RSVP=TRUE/);
    const after = updated(ops);
    expect(expandEvent(after, ...OCTOBER, ME)[0].selfStatus).toBe('ACCEPTED');
    expect(expandEvent(after, ...OCTOBER, new Set(['tom@example.com']))[0].selfStatus).toBe('ACCEPTED');
  });

  it('answers a whole series', () => {
    const obj = parse(SERIES);
    const occs = expandEvent(obj, ...OCTOBER, ME);
    const after = updated(respondToEvent(obj, occs[1], ME, 'DECLINED', 'all'));
    expect(expandEvent(after, ...OCTOBER, ME).map((o) => o.selfStatus)).toEqual(['DECLINED', 'DECLINED', 'DECLINED', 'DECLINED']);
  });

  it('answers a single occurrence through an override', () => {
    const obj = parse(SERIES);
    const occs = expandEvent(obj, ...OCTOBER, ME);
    const after = updated(respondToEvent(obj, occs[1], ME, 'TENTATIVE', 'single'));
    const result = expandEvent(after, ...OCTOBER, ME);
    expect(result.map((o) => o.selfStatus)).toEqual(['NEEDS-ACTION', 'TENTATIVE', 'NEEDS-ACTION', 'NEEDS-ACTION']);
    // The override keeps the instance where it was.
    expect(result[1].start.getTime()).toBe(occs[1].start.getTime());
    expect(result[1].isException).toBe(true);
  });
});
