import { describe, expect, it } from 'vitest';
import { externalLink, MAX_LINK_LENGTH } from './externalLink';
import { splitLinks } from './describe';

const web = { native: false, appHost: 'calendar.example.com' };
const app = { native: true, appHost: 'localhost' };

describe('externalLink', () => {
  it('lets web pages elsewhere through, as the browser will open them', () => {
    expect(externalLink('https://example.com/agenda', web)).toBe('https://example.com/agenda');
    expect(externalLink('http://intranet.example/a b', web)).toBe('http://intranet.example/a%20b');
    expect(externalLink('HTTPS://Example.COM/x', app)).toBe('https://example.com/x');
    expect(externalLink('https://[2001:db8::1]/room', app)).toBe('https://[2001:db8::1]/room');
  });

  it('refuses what is not an http(s) URL', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'content://com.example/x', 'intent://x#Intent;end', 'Room 4.02', '', undefined]) {
      expect(externalLink(text, web)).toBeUndefined();
    }
  });

  it('refuses an address with a user name or password, whose real host hides after them', () => {
    expect(externalLink('https://bank.example@evil.example/')).toBeUndefined();
    expect(externalLink('https://user:pass@example.com/')).toBeUndefined();
  });

  it("never links to the app's own host", () => {
    expect(externalLink('https://calendar.example.com/settings', web)).toBeUndefined();
    expect(externalLink('https://CALENDAR.example.com./x', web)).toBeUndefined();
    expect(externalLink('http://calendar.example.com:8080/x', web)).toBeUndefined();
    // In the browser a server on the user's own machine is an ordinary link.
    expect(externalLink('http://localhost:5232/', web)).toBe('http://localhost:5232/');
  });

  it("in the apps, never to Capacitor's routes, a loopback host or a single-label host", () => {
    for (const text of [
      'https://localhost/_capacitor_file_/x',
      'https://localhost/_capacitor_content_/com.example.provider/x.html',
      'https://LOCALHOST./_capacitor_file_/x',
      'http://localhost:8080/x',
      'https://sub.localhost/x',
      'https://127.0.0.1/x',
      'https://127.1/x',
      'https://2130706433/x',
      'https://0x7f.0.0.1/x',
      'https://[::1]/x',
      'https://[::ffff:127.0.0.1]/x',
      'https://0.0.0.0/x',
      'https://intranet/x',
    ]) {
      expect(externalLink(text, app), text).toBeUndefined();
    }
  });

  it('refuses addresses longer than any real one', () => {
    const long = `https://example.com/${'a'.repeat(MAX_LINK_LENGTH)}`;
    expect(externalLink(long, web)).toBeUndefined();
    expect(externalLink(long.slice(0, MAX_LINK_LENGTH), web)).toBe(long.slice(0, MAX_LINK_LENGTH));
  });
});

describe('splitLinks', () => {
  it('links web addresses inside text and leaves the punctuation after them', () => {
    expect(splitLinks('Agenda: https://example.com/a. See you', web)).toEqual([
      { text: 'Agenda: ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: '. See you' },
    ]);
  });

  it("keeps links to the app's own origin as plain text", () => {
    const text = 'Open https://localhost/_capacitor_file_/x or https://example.com/y';
    expect(splitLinks(text, app)).toEqual([
      { text: 'Open https://localhost/_capacitor_file_/x or ' },
      { text: 'https://example.com/y', href: 'https://example.com/y' },
    ]);
    expect(splitLinks('https://calendar.example.com/settings?x=1', web)).toEqual([{ text: 'https://calendar.example.com/settings?x=1' }]);
    expect(splitLinks('https://localhost/_capacitor_file_/x', app).every((p) => !p.href)).toBe(true);
  });

  it('goes through a long text in linear time', () => {
    const started = performance.now();
    const parts = splitLinks(`https://example.com/${'.'.repeat(400_000)}a ${'https://'.repeat(50_000)}`, web);
    expect(performance.now() - started).toBeLessThan(1000);
    // An address over 2,048 characters is text.
    expect(parts.every((p) => !p.href)).toBe(true);
  });
});
