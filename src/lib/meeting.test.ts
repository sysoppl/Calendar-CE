import { describe, expect, it } from 'vitest';
import { findMeetingLink } from './meeting';
import { parseEmails, selfEmailsByAccount } from './identity';

describe('findMeetingLink', () => {
  it('recognises common providers', () => {
    expect(findMeetingLink('https://us02web.zoom.us/j/123456789?pwd=abc')).toEqual({ provider: 'Zoom', url: 'https://us02web.zoom.us/j/123456789?pwd=abc' });
    expect(findMeetingLink('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0')?.provider).toBe('Microsoft Teams');
    expect(findMeetingLink('https://meet.jit.si/team-standup')?.provider).toBe('Jitsi');
    expect(findMeetingLink('https://meet.goto.com/123456789')?.provider).toBe('GoTo');
    expect(findMeetingLink('https://acme.webex.com/meet/anna')?.provider).toBe('Webex');
    expect(findMeetingLink('https://whereby.com/standup')?.provider).toBe('Whereby');
    expect(findMeetingLink('https://join.skype.com/abcDEF123')?.provider).toBe('Skype');
  });

  it('takes any link on a "meet." host as a meeting without naming a provider', () => {
    expect(findMeetingLink('https://meet.example.com/abc-defg-hij')).toEqual({ host: 'meet.example.com', url: 'https://meet.example.com/abc-defg-hij' });
    expect(findMeetingLink('https://meet.example.com/join/id-abc#pwd-x')).toEqual({ host: 'meet.example.com', url: 'https://meet.example.com/join/id-abc#pwd-x' });
    expect(findMeetingLink('https://MEET.Example.com:8443/room/42?lang=pl')).toEqual({ host: 'meet.example.com:8443', url: 'https://MEET.Example.com:8443/room/42?lang=pl' });
    expect(findMeetingLink('https://meet.intranet/standup/')?.url).toBe('https://meet.intranet/standup/');
    expect(findMeetingLink('https://meet.example.com/abc')?.provider).toBeUndefined();
  });

  it('names the host of a link without a provider, since whoever wrote the event chose it', () => {
    expect(findMeetingLink('Join: https://meet.secure-login-portal.example/abc')).toEqual({
      host: 'meet.secure-login-portal.example',
      url: 'https://meet.secure-login-portal.example/abc',
    });
    // A known service is named instead.
    expect(findMeetingLink('https://meet.jit.si/standup')?.host).toBeUndefined();
    // An address no browser would open is not offered.
    expect(findMeetingLink('https://meet.example.com:99999/abc')).toBeUndefined();
  });

  it('does not take other links for meetings', () => {
    // Only the front page: there is no room to join.
    expect(findMeetingLink('https://meet.example.com/')).toBeUndefined();
    expect(findMeetingLink('See https://meet.example.com/.')).toBeUndefined();
    expect(findMeetingLink('https://meet.example.com')).toBeUndefined();
    // "meet" has to be the first label of the host.
    expect(findMeetingLink('https://meetup.example.com/events/1')).toBeUndefined();
    expect(findMeetingLink('https://www.meet.example.com/abc')).toBeUndefined();
    expect(findMeetingLink('https://example.com/meet.example.com/abc')).toBeUndefined();
    // Never over plain HTTP.
    expect(findMeetingLink('http://meet.example.com/abc-defg-hij')).toBeUndefined();
    expect(findMeetingLink('https://example.com/board')).toBeUndefined();
  });

  it('finds a link inside text and drops trailing punctuation', () => {
    expect(findMeetingLink('Agenda attached.\nJoin: https://meet.example.com/abc-defg-hij.')?.url).toBe('https://meet.example.com/abc-defg-hij');
    expect(findMeetingLink('Call (https://zoom.us/j/987654321) at noon')?.url).toBe('https://zoom.us/j/987654321');
    expect(findMeetingLink('<a href="https://meet.example.com/abc">Join</a>')?.url).toBe('https://meet.example.com/abc');
  });

  it('checks the texts in order and prefers a known provider within one text', () => {
    expect(findMeetingLink('Room 4.02', undefined, 'see https://meet.jit.si/later')?.url).toBe('https://meet.jit.si/later');
    expect(findMeetingLink('https://zoom.us/j/1', 'https://meet.example.com/abc-defg-hij')?.provider).toBe('Zoom');
    expect(findMeetingLink('https://meet.example.com/abc-defg-hij', 'https://zoom.us/j/1')?.url).toBe('https://meet.example.com/abc-defg-hij');
    expect(findMeetingLink('Backup https://meet.example.com/abc, main https://zoom.us/j/1')?.provider).toBe('Zoom');
    expect(findMeetingLink('https://example.com/board', 'http://meet.example.com/abc-defg-hij')).toBeUndefined();
    expect(findMeetingLink(undefined, '')).toBeUndefined();
  });
});

describe('findMeetingLink on hostile text', () => {
  // Each took seconds to minutes when the trailing punctuation was cut with a pattern anchored at the end.
  const timed = (text: string) => {
    const started = performance.now();
    const found = findMeetingLink(text);
    return { found, ms: performance.now() - started };
  };

  it('cuts a long run of punctuation after a link in linear time', () => {
    const long = timed(`https://zoom.us/j/1${'.'.repeat(400_000)}a`);
    expect(long.ms).toBeLessThan(500);
    // Cut at 64 KiB, inside the run of dots, which go.
    expect(long.found?.url).toBe('https://zoom.us/j/1');
    const within = timed(`https://zoom.us/j/1${'.'.repeat(60_000)}a`);
    expect(within.ms).toBeLessThan(500);
    // Longer than any real address: not offered.
    expect(within.found).toBeUndefined();
  });

  it('stays fast for every kind of link and for runs of brackets', () => {
    for (const prefix of ['https://zoom.us/j/1', 'https://meet.jit.si/x', 'https://meet.example.com/x', 'https://acme.webex.com/x']) {
      for (const run of ['.', ')', ']', '!?', '.,;:']) {
        const { ms } = timed(`${prefix}${run.repeat(Math.ceil(80_000 / run.length))}a`);
        expect(ms, `${prefix} ${run}`).toBeLessThan(500);
      }
    }
  });

  it('still trims the punctuation of a link of ordinary length', () => {
    expect(findMeetingLink(`Join: https://zoom.us/j/1${'.'.repeat(1000)}`)?.url).toBe('https://zoom.us/j/1');
    expect(findMeetingLink('https://meet.example.com/abc?!).')?.url).toBe('https://meet.example.com/abc');
  });

  it('searches only the first 64 KiB of a text', () => {
    expect(findMeetingLink(`${'x '.repeat(40_000)}https://zoom.us/j/1`)).toBeUndefined();
    expect(findMeetingLink(`${'x '.repeat(30_000)}https://zoom.us/j/1`)?.url).toBe('https://zoom.us/j/1');
    // A later text is still searched.
    expect(findMeetingLink('x'.repeat(100_000), 'https://zoom.us/j/2')?.url).toBe('https://zoom.us/j/2');
  });
});

describe('identity', () => {
  it('parses address lists', () => {
    expect(parseEmails('Me@Example.com, work@example.com;  me@example.com not-an-address')).toEqual(['me@example.com', 'work@example.com']);
    expect(parseEmails('')).toEqual([]);
  });

  it('collects the addresses of each account', () => {
    const map = selfEmailsByAccount(
      [
        { id: 'local', kind: 'local', name: 'On this device', useProxy: false },
        { id: 'a', kind: 'caldav', name: 'Work', useProxy: true, username: 'Anna@Corp.example', email: 'anna.nowak@corp.example' },
        { id: 'b', kind: 'caldav', name: 'Home', useProxy: true, username: 'anna' },
      ],
      'private@example.com',
    );
    expect([...map.get('local')!]).toEqual(['private@example.com']);
    expect([...map.get('a')!].sort()).toEqual(['anna.nowak@corp.example', 'anna@corp.example', 'private@example.com']);
    expect([...map.get('b')!]).toEqual(['private@example.com']);
  });
});
