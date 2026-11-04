// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settings';
import { CalDavClient, normalizeColor, siteOf, summarizeError } from './client';
import type { DavRequest, Transport } from './transport';
import { parseMultistatus } from './xml';

type Handler = (req: DavRequest) => { status: number; body?: string; headers?: Record<string, string> } | undefined;

function mockTransport(handlers: Handler[]): { transport: Transport; log: DavRequest[] } {
  const log: DavRequest[] = [];
  const transport: Transport = async (req) => {
    log.push(req);
    for (const h of handlers) {
      const r = h(req);
      if (r) {
        const headers = new Headers(r.headers);
        return { status: r.status, headers, body: r.body ?? '', location: headers.get('location') ?? undefined };
      }
    }
    return { status: 404, headers: new Headers(), body: '' };
  };
  return { transport, log };
}

const ms = (inner: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">${inner}</d:multistatus>`;

describe('parseMultistatus', () => {
  it('parses propstats and statuses', () => {
    const res = parseMultistatus(
      ms(`<d:response><d:href>/cal/a.ics</d:href>
        <d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        <d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
      </d:response><d:sync-token>tok-2</d:sync-token>`),
    );
    expect(res.responses).toHaveLength(1);
    expect(res.responses[0].propstats.map((p) => p.status)).toEqual([200, 404]);
    expect(res.syncToken).toBe('tok-2');
  });

  it('rejects non-multistatus documents', () => {
    expect(() => parseMultistatus('<x/>')).toThrow();
  });
});

describe('normalizeColor', () => {
  it('drops the alpha channel Apple clients append', () => {
    expect(normalizeColor('#FF8800FF')).toBe('#ff8800');
    expect(normalizeColor('#123456')).toBe('#123456');
    expect(normalizeColor('red')).toBeUndefined();
  });
});

describe('redirects', () => {
  const client = (handlers: Handler[]) => {
    const { transport, log } = mockTransport(handlers);
    return { client: new CalDavClient(transport, { username: 'a', password: 'b' }), log };
  };

  it('never carries credentials from https to http', async () => {
    const { client: c, log } = client([() => ({ status: 302, headers: { location: 'http://dav.example.com/dav/' } })]);
    await expect(c.request('PROPFIND', 'https://dav.example.com/')).rejects.toThrow(/unencrypted/);
    expect(log).toHaveLength(1);
  });

  it('refuses non-http redirect targets', async () => {
    const { client: c, log } = client([() => ({ status: 302, headers: { location: 'file:///etc/passwd' } })]);
    await expect(c.request('GET', 'https://dav.example.com/')).rejects.toThrow(/unsupported/);
    expect(log).toHaveLength(1);
  });

  it('follows upgrades and same-scheme redirects', async () => {
    const { client: c, log } = client([
      (req) => (req.url === 'http://dav.example.com/' ? { status: 301, headers: { location: 'https://dav.example.com/' } } : undefined),
      (req) => (req.url === 'https://dav.example.com/' ? { status: 200, body: 'ok' } : undefined),
    ]);
    expect((await c.request('GET', 'http://dav.example.com/')).body).toBe('ok');
    expect(log).toHaveLength(2);
    expect(log[1].headers?.Authorization).toMatch(/^Basic /);
  });

  it('never repeats a request with the password at another origin', async () => {
    for (const target of ['https://evil.example.net/dav/', 'https://other.example.com/', 'https://dav.example.com:8443/', 'http://dav.example.com:8080/']) {
      const from = target.startsWith('http://') ? 'http://dav.example.com/' : 'https://dav.example.com/';
      const { client: c, log } = client([(req) => (req.url === from ? { status: 302, headers: { location: target } } : { status: 200, body: 'leaked' })]);
      await expect(c.request('PROPFIND', from), target).rejects.toThrow(/redirected to .*not sent to another address/);
      // The only request made is the one to the server the user named.
      expect(log.map((r) => r.url), target).toEqual([from]);
    }
  });

  it('does not treat a port change as an upgrade of the same server', async () => {
    const { client: c, log } = client([() => ({ status: 301, headers: { location: 'https://dav.example.com:8443/' } })]);
    await expect(c.request('GET', 'http://dav.example.com:8080/')).rejects.toThrow(/redirected to dav\.example\.com:8443/);
    expect(log).toHaveLength(1);
  });

  it('names the other server when discovery is sent elsewhere', async () => {
    const { client: c, log } = client([() => ({ status: 301, headers: { location: 'https://caldav.provider.example/' } })]);
    await expect(c.discover('example.com')).rejects.toThrow(/caldav\.provider\.example/);
    expect(log.every((r) => new URL(r.url).host === 'example.com')).toBe(true);
  });

  it('rejects server addresses that are not http(s)', async () => {
    const { client: c, log } = client([]);
    await expect(c.discover('ftp://dav.example.com/')).rejects.toThrow(/http/);
    expect(log).toHaveLength(0);
  });
});

describe('CalDavClient', () => {
  const principalHandler: Handler = (req) => {
    if (req.method === 'PROPFIND' && req.body?.includes('current-user-principal')) {
      if (req.url === 'https://dav.example.com/.well-known/caldav') {
        return { status: 301, headers: { location: '/dav/' } };
      }
      if (req.url === 'https://dav.example.com/dav/') {
        return {
          status: 207,
          body: ms(`<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav/principals/alice/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
        };
      }
      return { status: 404 };
    }
    if (req.method === 'PROPFIND' && req.body?.includes('calendar-home-set')) {
      return {
        status: 207,
        body: ms(`<d:response><d:href>/dav/principals/alice/</d:href><d:propstat><d:prop>
          <c:calendar-home-set><d:href>/dav/calendars/alice/</d:href></c:calendar-home-set>
          <d:displayname>Alice</d:displayname>
          <c:calendar-user-address-set><d:href>mailto:alice@example.com</d:href><d:href>/dav/principals/alice/</d:href></c:calendar-user-address-set>
        </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
      };
    }
    return undefined;
  };

  it('discovers principal and home via .well-known redirect and keeps auth', async () => {
    const { transport, log } = mockTransport([principalHandler]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'zażółć' });
    const info = await client.discover('dav.example.com');
    expect(info).toEqual({
      principalUrl: 'https://dav.example.com/dav/principals/alice/',
      homeUrl: 'https://dav.example.com/dav/calendars/alice/',
      displayName: 'Alice',
      email: 'alice@example.com',
    });
    expect(log.every((r) => r.headers?.Authorization?.startsWith('Basic '))).toBe(true);
  });

  it('lists calendars with components, colors and privileges', async () => {
    const { transport } = mockTransport([
      () => ({
        status: 207,
        body: ms(`
          <d:response><d:href>/dav/calendars/alice/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/dav/calendars/alice/work/</d:href><d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <d:displayname>Work</d:displayname>
            <ic:calendar-color>#069C8DFF</ic:calendar-color>
            <cs:getctag>ctag-1</cs:getctag>
            <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
            <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/dav/calendars/alice/todo/</d:href><d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
            <d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
      }),
    ]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    const cals = await client.listCalendars('https://dav.example.com/dav/calendars/alice/');
    expect(cals).toHaveLength(2);
    expect(cals[0]).toMatchObject({ displayName: 'Work', color: '#069c8d', components: ['VEVENT'], readOnly: true, ctag: 'ctag-1' });
    expect(cals[1]).toMatchObject({ displayName: 'todo', components: ['VTODO'], readOnly: false });
  });

  it('lists objects excluding the collection itself', async () => {
    const { transport } = mockTransport([
      () => ({
        status: 207,
        body: ms(`
          <d:response><d:href>/cal/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:getetag>"c"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/cal/work/a.ics</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
      }),
    ]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    expect(await client.listObjects('https://x.test/cal/work')).toEqual([{ url: 'https://x.test/cal/work/a.ics', etag: '"1"' }]);
  });

  it('uses If-None-Match for creates and If-Match for updates', async () => {
    const { transport, log } = mockTransport([() => ({ status: 201, headers: { etag: '"new"' } })]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    expect(await client.putObject('https://x.test/c/1.ics', 'BEGIN:VCALENDAR')).toBe('"new"');
    await client.putObject('https://x.test/c/1.ics', 'BEGIN:VCALENDAR', 'update', '"old"');
    expect(log[0].headers?.['If-None-Match']).toBe('*');
    expect(log[1].headers?.['If-Match']).toBe('"old"');
    expect(log[1].headers?.['If-None-Match']).toBeUndefined();
  });

  it('updates an object the server gave no etag for without a precondition', async () => {
    // "If-None-Match: *" here would fail for ever: the object exists.
    const { transport, log } = mockTransport([() => ({ status: 204 })]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    await client.putObject('https://x.test/c/1.ics', 'BEGIN:VCALENDAR', 'update');
    expect(log[0].headers?.['If-None-Match']).toBeUndefined();
    expect(log[0].headers?.['If-Match']).toBeUndefined();
  });

  it("words a refused save from the start of the server's answer, fast whatever the answer is", async () => {
    // Tag stripping is quadratic on a run of '<' without '>': a 400 KB answer took minutes.
    const { transport } = mockTransport([() => ({ status: 507, body: '<'.repeat(400_000) })]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    const started = performance.now();
    const err = await client.putObject('https://x.test/c/1.ics', 'x').catch((e: Error) => e);
    expect(performance.now() - started).toBeLessThan(500);
    expect((err as Error).message).toContain('507');
    expect(summarizeError(`<html><body><h1>Quota</h1> exceeded</body></html>${'<'.repeat(400_000)}`)).toBe(`Quota exceeded ${'<'.repeat(200)}`.slice(0, 160));
    expect(summarizeError('')).toBe('no details');
  });

  it('reports a conflict on 412', async () => {
    const { transport } = mockTransport([() => ({ status: 412 })]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    await expect(client.putObject('https://x.test/c/1.ics', 'x', 'update', '"e"')).rejects.toMatchObject({ status: 412 });
  });

  it('parses sync-collection changes and deletions', async () => {
    const { transport } = mockTransport([
      () => ({
        status: 207,
        body: ms(`
          <d:response><d:href>/c/a.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/c/b.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
          <d:sync-token>t2</d:sync-token>`),
      }),
    ]);
    const client = new CalDavClient(transport, { username: 'a', password: 'b' });
    expect(await client.syncCollection('https://x.test/c/', 't1')).toEqual({
      changed: [{ url: 'https://x.test/c/a.ics', etag: '"2"' }],
      deleted: ['https://x.test/c/b.ics'],
      syncToken: 't2',
    });
  });
});

describe('canonicalHref', () => {
  it('treats encoded and unencoded reserved characters alike without double encoding', async () => {
    const { canonicalHref } = await import('./xml');
    expect(canonicalHref('/cal/x-1%40calendar.example.org.ics')).toBe('/cal/x-1@calendar.example.org.ics');
    expect(canonicalHref('/cal/x-1@calendar.example.org.ics')).toBe('/cal/x-1@calendar.example.org.ics');
    expect(canonicalHref('/cal/a b%20c.ics')).toBe('/cal/a%20b%20c.ics');
    expect(canonicalHref('/cal/zaż%C3%B3łć.ics')).toBe('/cal/za%C5%BC%C3%B3%C5%82%C4%87.ics');
    expect(canonicalHref('https://h.test:8443/dav/%7Euser/')).toBe('https://h.test:8443/dav/~user/');
  });

  it('leaves the host of an absolute URL alone', async () => {
    const { canonicalHref } = await import('./xml');
    expect(canonicalHref('http://[::1]:5232/alice/cal/a%40b.ics')).toBe('http://[::1]:5232/alice/cal/a@b.ics');
    expect(canonicalHref('https://[2001:db8::1]/dav/')).toBe('https://[2001:db8::1]/dav/');
    expect(new URL(canonicalHref('http://[::1]:5232/alice/')).hostname).toBe('[::1]');
  });
});

// Every request carries the password, so an address a server names in an
// answer gets the same checks as a redirect.
describe('addresses in answers', () => {
  const principalAt = (home: string): Handler => (req) => {
    if (req.body?.includes('current-user-principal')) {
      return { status: 207, body: ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principals/alice/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`) };
    }
    if (req.body?.includes('calendar-home-set')) {
      return { status: 207, body: ms(`<d:response><d:href>/principals/alice/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`) };
    }
    return undefined;
  };

  it('refuses an http calendar home named by an https server', async () => {
    const { transport, log } = mockTransport([principalAt('http://dav.example.com/cal/alice/')]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    await expect(client.discover('https://dav.example.com/')).rejects.toThrow(/unencrypted \(http\) address .* not sent there/);
    expect(log.every((r) => r.url.startsWith('https://dav.example.com/'))).toBe(true);
  });

  it('refuses a calendar home that is not http(s)', async () => {
    const { transport } = mockTransport([principalAt('javascript:alert(1)')]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    await expect(client.discover('https://dav.example.com/')).rejects.toThrow(/cannot be used/);
  });

  it('accepts a calendar home on another https host, as some providers use', async () => {
    const { transport } = mockTransport([principalAt('https://p07-caldav.example.com/123/calendars/')]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    expect(await client.discover('https://dav.example.com/')).toMatchObject({ homeUrl: 'https://p07-caldav.example.com/123/calendars/' });
  });

  it('refuses a calendar home or a principal on another site, and sends the password no further', async () => {
    for (const handler of [
      principalAt('https://caldav.attacker.example/alice/'),
      // The principal named elsewhere.
      (req: DavRequest) =>
        req.body?.includes('current-user-principal')
          ? { status: 207, body: ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>https://example.net/principals/alice/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`) }
          : undefined,
    ]) {
      const { transport, log } = mockTransport([handler]);
      const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
      await expect(client.discover('https://dav.example.com/')).rejects.toThrow(/password is not sent to another address/);
      expect(log.every((r) => new URL(r.url).hostname === 'dav.example.com')).toBe(true);
    }
  });

  it('accepts a home on another host of the same site under a country\'s second level', async () => {
    const { transport } = mockTransport([principalAt('https://calendars.example.co.uk/alice/')]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    expect(await client.discover('https://dav.example.co.uk/')).toMatchObject({ homeUrl: 'https://calendars.example.co.uk/alice/' });
    const other = mockTransport([principalAt('https://calendars.other.co.uk/alice/')]);
    await expect(new CalDavClient(other.transport, { username: 'alice', password: 'S3cret!' }).discover('https://dav.example.co.uk/')).rejects.toThrow(/not sent to another address/);
  });

  it('takes the last two labels of a name for its site, or three under a country\'s second level', () => {
    expect(siteOf('p42-caldav.icloud.com')).toBe('icloud.com');
    expect(siteOf('caldav.icloud.com')).toBe('icloud.com');
    expect(siteOf('dav.example.com.pl')).toBe('example.com.pl');
    expect(siteOf('cal.firma.com.br')).toBe('firma.com.br');
    expect(siteOf('Mail.Example.PL.')).toBe('example.pl');
    expect(siteOf('192.168.1.10')).toBe('192.168.1.10');
    expect(siteOf('[::1]')).toBe('[::1]');
    expect(siteOf('nas')).toBe('nas');
  });

  const response = (href: string, props = '<d:getetag>"1"</d:getetag>') =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

  it('leaves out what a collection names on another server', async () => {
    const elsewhere = 'https://collector.example.net/x/a.ics';
    const { transport, log } = mockTransport([
      (req) => (req.method === 'PROPFIND' ? { status: 207, body: ms(response('/cal/work/a.ics') + response(elsewhere)) } : undefined),
      (req) =>
        req.method === 'REPORT' && req.body?.includes('sync-collection')
          ? { status: 207, body: ms(response('/cal/work/b.ics') + response(elsewhere) + '<d:sync-token>t2</d:sync-token>') }
          : undefined,
      (req) =>
        req.method === 'REPORT'
          ? { status: 207, body: ms(response('/cal/work/a.ics', '<d:getetag>"1"</d:getetag><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>') + response(elsewhere, '<d:getetag>"9"</d:getetag><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>')) }
          : undefined,
    ]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    expect((await client.listObjects('https://dav.example.com/cal/work/')).map((o) => o.url)).toEqual(['https://dav.example.com/cal/work/a.ics']);
    expect((await client.syncCollection('https://dav.example.com/cal/work/', 't1'))!.changed.map((o) => o.url)).toEqual(['https://dav.example.com/cal/work/b.ics']);
    expect((await client.multiget('https://dav.example.com/cal/work/', ['https://dav.example.com/cal/work/a.ics'])).map((o) => o.url)).toEqual(['https://dav.example.com/cal/work/a.ics']);
    expect(log.every((r) => r.url.startsWith('https://dav.example.com/'))).toBe(true);
  });

  it('refuses an object address that goes down to http, and a calendar on another server is left out', async () => {
    const { transport } = mockTransport([
      (req) =>
        req.body?.includes('getctag')
          ? {
              status: 207,
              body: ms(
                ['/cal/work/', 'https://evil.example.net/cal/'].map((href) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join(''),
              ),
            }
          : { status: 207, body: ms(response('http://dav.example.com/cal/work/a.ics')) },
    ]);
    const client = new CalDavClient(transport, { username: 'alice', password: 'S3cret!' });
    expect((await client.listCalendars('https://dav.example.com/cal/')).map((c) => c.url)).toEqual(['https://dav.example.com/cal/work/']);
    await expect(client.listObjects('https://dav.example.com/cal/work/')).rejects.toThrow(/unencrypted/);
  });
});

describe('messages', () => {
  afterEach(() => useSettings.getState().update({ language: 'en' }));
  const URL_A = 'https://dav.example.com/cal/work/a.ics';
  const answering = (status: number, body = '', headers?: Record<string, string>) =>
    new CalDavClient(mockTransport([() => ({ status, body, headers })]).transport, { username: 'a', password: 'b' });

  it('are in the user\'s language, and keep the status the store goes by', async () => {
    useSettings.getState().update({ language: 'pl' });
    await expect(answering(401).request('PROPFIND', 'https://dav.example.com/')).rejects.toMatchObject({
      status: 401,
      message: 'Logowanie nie powiodło się. Należy sprawdzić nazwę użytkownika i hasło.',
    });
    await expect(answering(403).request('PUT', URL_A)).rejects.toMatchObject({ status: 403, message: `Serwer odmówił dostępu (PUT ${URL_A}).` });
    await expect(answering(302, '', { location: '/again/' }).request('GET', 'https://dav.example.com/')).rejects.toThrow('Serwer przekierowywał zbyt wiele razy.');
    await expect(answering(500).listCalendars('https://dav.example.com/cal/')).rejects.toMatchObject({
      status: 500,
      message: 'Serwer odpowiedział na PROPFIND https://dav.example.com/cal/ kodem HTTP 500.',
    });
    await expect(answering(507).createCalendar('https://dav.example.com/cal/', { displayName: 'X', components: ['VEVENT'] })).rejects.toThrow('Nie udało się utworzyć kalendarza (HTTP 507).');
    await expect(answering(500).updateCalendar('https://dav.example.com/cal/work/', { displayName: 'Y' })).rejects.toThrow('Nie udało się zmienić kalendarza (HTTP 500).');
    const refused = ms('<d:response><d:href>/cal/work/</d:href><d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>');
    await expect(answering(207, refused).updateCalendar('https://dav.example.com/cal/work/', { displayName: 'Y' })).rejects.toThrow('Serwer nie przyjął niektórych właściwości kalendarza.');
    await expect(answering(500).deleteCalendar('https://dav.example.com/cal/work/')).rejects.toThrow('Nie udało się usunąć kalendarza (HTTP 500).');
    await expect(answering(500).syncCollection('https://dav.example.com/cal/work/', 't1')).rejects.toThrow('Nie udało się pobrać zmian (HTTP 500).');
    await expect(answering(500).getObject(URL_A)).rejects.toThrow(`Serwer odpowiedział na GET ${URL_A} kodem HTTP 500.`);
    const changed = 'Ten element zmieniono w międzyczasie na serwerze. Należy spróbować ponownie za chwilę.';
    await expect(answering(412).putObject(URL_A, 'x', 'update', '"e"')).rejects.toMatchObject({ status: 412, message: changed });
    await expect(answering(412).deleteObject(URL_A, '"e"')).rejects.toMatchObject({ status: 412, message: changed });
    await expect(answering(507, '<d:error xmlns:d="DAV:"><d:quota-not-exceeded/>Quota exceeded</d:error>').putObject(URL_A, 'x')).rejects.toThrow('Nie udało się zapisać (HTTP 507): Quota exceeded');
    await expect(answering(507).putObject(URL_A, 'x')).rejects.toThrow('Nie udało się zapisać (HTTP 507): brak szczegółów');
    await expect(answering(500).deleteObject(URL_A)).rejects.toThrow('Nie udało się usunąć (HTTP 500).');
    await expect(answering(207, ms('')).discover('https://dav.example.com/')).rejects.toThrow('Pod tym adresem nie znaleziono usługi CalDAV.');
    await expect(answering(207, '<not xml').listCalendars('https://dav.example.com/cal/')).rejects.toThrow(/^Odpowiedź serwera nie jest poprawnym dokumentem XML \(/);
    await expect(answering(207, '<html/>').listCalendars('https://dav.example.com/cal/')).rejects.toThrow('Serwer wysłał nieoczekiwaną odpowiedź (html).');
  });

  it('never quote a user name or password typed into the address', async () => {
    const typed = 'https://alice:S3cret!@dav.example.com/cal/';
    for (const status of [403, 500]) {
      const err = (await answering(status).listCalendars(typed).catch((e: unknown) => e)) as Error;
      expect(err.message).toContain('dav.example.com/cal/');
      expect(err.message).not.toMatch(/alice|S3cret/);
    }
  });

  it('name a calendar without a display name after its address, even a malformed one', async () => {
    const calendarAt = (href: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const listing = ms(calendarAt('/cal/Holidays%20PL/') + calendarAt('/cal/bad%E0%A4%A/') + calendarAt('/cal/work/'));
    const names = (await answering(207, listing).listCalendars('https://dav.example.com/cal/')).map((c) => c.displayName);
    expect(names).toEqual(['Holidays PL', 'bad%E0%A4%A', 'work']);
  });
});
