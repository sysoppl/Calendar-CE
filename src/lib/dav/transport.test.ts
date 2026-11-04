import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { assertHttpUrl, crossOriginRedirect, DavNetworkError, DirectFetchUnavailable, directTransport, fetchFeedDirect, normalizeServerUrl, proxyTransport, resolveRedirect, sendsInClear } from './transport';

const TARGET = 'https://dav.example.com/calendars/me/';

function proxyAnswer(status: number, body: object | string, proxyError = true): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (proxyError) headers.set('x-dav-proxy-error', '1');
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

async function failure(answer: Response | Error): Promise<DavNetworkError> {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }));
  try {
    await proxyTransport()({ method: 'PROPFIND', url: TARGET });
  } catch (err) {
    expect(err).toBeInstanceOf(DavNetworkError);
    return err as DavNetworkError;
  }
  throw new Error('no failure');
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSettings.getState().update({ language: 'en' });
});

describe('proxyTransport', () => {
  it('words the proxy\'s own refusals in the user\'s language', async () => {
    useSettings.getState().update({ language: 'en' });
    expect((await failure(proxyAnswer(502, { error: 'Upstream request failed: ECONNREFUSED', code: 'upstream' }))).message).toBe('No connection to the calendar server (ECONNREFUSED).');
    expect((await failure(proxyAnswer(403, { error: 'Host dav.example.com is not allowed by CALENDAR_PROXY_ALLOW', code: 'host-not-allowed' }))).message).toBe('The built-in proxy of this server does not connect to dav.example.com.');
    vi.stubGlobal('fetch', vi.fn(async () => proxyAnswer(403, { error: 'Port 25 belongs to other protocols than DAV', code: 'port-not-allowed' })));
    await expect(proxyTransport()({ method: 'PROPFIND', url: 'https://dav.example.com:25/' })).rejects.toThrow('The built-in proxy does not connect to port 25, which belongs to services other than calendars.');
    useSettings.getState().update({ language: 'pl' });
    expect((await failure(proxyAnswer(504, { error: 'The server did not answer in time', code: 'timeout' }))).message).toBe('Serwer kalendarza nie odpowiedział na czas.');
  });

  it.each([
    ['en', 'https-required', 400, 'The built-in proxy connects to dav.example.com only over https://, so that the password does not cross the internet unencrypted. Change the server address to https://.'],
    ['pl', 'https-required', 400, 'Wbudowane proxy łączy się z dav.example.com tylko przez https://, aby hasło nie było przesyłane przez internet bez szyfrowania. Należy zmienić adres serwera na https://.'],
    ['en', 'misdirected', 421, 'The app’s server does not relay requests for the address this page was opened at. Open the app at its usual address.'],
    ['pl', 'misdirected', 421, 'Serwer aplikacji nie przekazuje żądań dla adresu, pod którym otwarto tę stronę. Należy otworzyć aplikację pod jej zwykłym adresem.'],
  ] as const)('words the newer refusals too (%s, %s)', async (language, code, status, text) => {
    useSettings.getState().update({ language });
    expect((await failure(proxyAnswer(status, { error: 'The proxy says so in English', code }))).message).toBe(text);
  });

  it('passes on refusals it has no text for, and answers that are not JSON, cut short', async () => {
    expect((await failure(proxyAnswer(405, { error: 'Method TRACE is not supported by the proxy', code: 'method' }))).message).toBe('Method TRACE is not supported by the proxy');
    expect((await failure(proxyAnswer(400, '<html><body><h1>Bad request</h1></body></html>'))).message).toBe('Bad request');
    // Whatever arrives ends up in the account's error, which is stored: never as much as was sent.
    const page = `<html><body>${'<p>gateway</p>'.repeat(80_000)}</body></html>`;
    expect((await failure(proxyAnswer(502, page))).message.length).toBeLessThanOrEqual(200);
    expect((await failure(proxyAnswer(403, { error: 'x'.repeat(1_000_000), code: 'cross-site' }))).message.length).toBeLessThanOrEqual(200);
  });

  it('tells a reverse proxy in front of the app\'s server apart from the calendar server', async () => {
    // nginx answers for the app's server when that is down: nothing of the proxy's on it.
    const nginx = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>';
    for (const status of [502, 503, 504]) {
      expect((await failure(proxyAnswer(status, nginx, false))).message).toBe('The app’s server could not be reached. Check the internet connection.');
    }
    // The same status relayed from the calendar server is that server's answer, for the client to word.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${'x'.repeat(6 * 1024 * 1024)}</html>`, { status: 502, headers: { 'x-dav-proxy-relay': '1' } })));
    const relayed = await proxyTransport()({ method: 'PROPFIND', url: TARGET });
    expect(relayed.status).toBe(502);
  });

  it('turns a lost connection and an answer cut off half-way into network errors', async () => {
    expect((await failure(new TypeError('Failed to fetch'))).message).toMatch(/server could not be reached/);
    const cut = new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('network error')) }), { status: 207 });
    expect((await failure(cut)).message).toBe('The connection broke while the answer was arriving (network error).');
  });

  it('hands over the server\'s own answers as they are', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<multistatus/>', { status: 207, headers: { 'x-dav-location': 'https://dav.example.com/x/' } })));
    const answer = await proxyTransport()({ method: 'PROPFIND', url: TARGET });
    expect(answer).toMatchObject({ status: 207, body: '<multistatus/>', location: 'https://dav.example.com/x/' });
  });
});

describe('messages outside the proxy', () => {
  it('are in the user\'s language', async () => {
    useSettings.getState().update({ language: 'pl' });
    expect(() => resolveRedirect('https://dav.example.com/', 'http://dav.example.com/')).toThrow('Serwer dav.example.com przekierował pod adres bez szyfrowania (http). Przekierowanie nie zostało wykonane.');
    expect(() => resolveRedirect('https://dav.example.com/', 'ftp://dav.example.com/')).toThrow('Serwer dav.example.com przekierował pod nieobsługiwany adres.');
    expect(() => resolveRedirect('https://dav.example.com/', 'http://[')).toThrow('Serwer dav.example.com wysłał nieprawidłowe przekierowanie.');
    expect(crossOriginRedirect('https://a.example/', 'https://b.example/').message).toBe(
      'Serwer a.example przekierował pod adres b.example. Hasło nie jest wysyłane pod inny adres. Jeśli b.example jest zaufany, należy go podać jako adres serwera.',
    );
    expect(() => assertHttpUrl('ftp://dav.example.com/')).toThrow('Obsługiwane są tylko adresy http i https.');
    expect(() => assertHttpUrl('not an address')).toThrow('To nie jest prawidłowy adres.');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(directTransport({ method: 'PROPFIND', url: TARGET })).rejects.toThrow(
      'Nie udało się połączyć z dav.example.com (Failed to fetch). Serwer prawdopodobnie nie przyjmuje żądań z przeglądarki. Należy włączyć wbudowane proxy w ustawieniach konta.',
    );
  });

  it("summarises the start of a long proxy answer only, in linear time", async () => {
    const started = performance.now();
    const err = await failure(proxyAnswer(502, '<'.repeat(400_000)));
    expect(performance.now() - started).toBeLessThan(500);
    expect(err.message.length).toBeLessThanOrEqual(160);
  });
});

describe('fetchFeedDirect', () => {
  const FEED = 'https://feeds.example.net/basic.ics';
  /** A body sent in `chunks` pieces of `size` bytes, without a length. */
  const streamed = (chunks: number, size: number) =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (chunks-- > 0) controller.enqueue(new Uint8Array(size).fill(65));
          else controller.close();
        },
      }),
    );

  it('reads the answer as text, any status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('BEGIN:VCALENDAR X-NAME:Zażółć', { status: 200 })));
    expect(await fetchFeedDirect(FEED)).toMatchObject({ status: 200, body: 'BEGIN:VCALENDAR X-NAME:Zażółć' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    expect(await fetchFeedDirect(FEED)).toMatchObject({ status: 403, body: 'no' });
  });

  it('says the browser could not fetch it when fetch fails (CORS, network)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchFeedDirect(FEED)).rejects.toBeInstanceOf(DirectFetchUnavailable);
  });

  it('stops a body without a length once it passes the limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed(10, 1000)));
    expect((await fetchFeedDirect(FEED, { maxBytes: 10_000 })).body).toHaveLength(10_000);
    vi.stubGlobal('fetch', vi.fn(async () => streamed(11, 1000)));
    const err = await fetchFeedDirect(FEED, { maxBytes: 10_000 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DavNetworkError);
    expect(err).not.toBeInstanceOf(DirectFetchUnavailable);
  });

  it('gives up after the time limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))),
    );
    const err = await fetchFeedDirect(FEED, { timeoutMs: 20 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DavNetworkError);
    expect((err as Error).message).toBe('The subscribed calendar did not load in time.');
  });
});

describe('sendsInClear', () => {
  it('is true for plain http to a host on the internet', () => {
    for (const url of ['http://dav.example.com/', 'HTTP://Dav.Example.com:8080/dav', 'http://203.0.113.7/', 'http://[2001:db8::1]/', 'http://172.32.0.1/', 'http://192.169.0.1/', 'http://nas.local.example.com/']) {
      expect(sendsInClear(url), url).toBe(true);
    }
  });

  it('is false for https, no scheme (read as https) and the local network', () => {
    for (const url of [
      'https://dav.example.com/',
      'dav.example.com',
      'posteo.de:8443/',
      'http://localhost:5232/',
      'http://radicale.localhost/',
      'http://127.0.0.1:5232/',
      'http://10.0.0.5/',
      'http://172.16.4.2/',
      'http://192.168.1.10:5232/',
      'http://169.254.10.1/',
      'http://100.101.102.103/',
      'http://[::1]:5232/',
      'http://[fd12:3456::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:192.168.1.10]/',
      'http://nas.local/',
      'http://nas.lan/',
      'http://nas.home.arpa/',
      'http://nas/',
      '',
      undefined,
      'http://',
    ]) {
      expect(sendsInClear(url), String(url)).toBe(false);
    }
  });
});

describe('normalizeServerUrl', () => {
  it('reads an address as discovery does', () => {
    expect(normalizeServerUrl(' posteo.de:8443/ ')).toBe('https://posteo.de:8443/');
    expect(normalizeServerUrl('localhost:5232')).toBe('https://localhost:5232/');
    expect(normalizeServerUrl('http://localhost:5232/')).toBe('http://localhost:5232/');
    expect(normalizeServerUrl('https://Dav.Example.com/dav.php')).toBe('https://dav.example.com/dav.php');
  });

  it('refuses a user name or password in the address', () => {
    expect(() => normalizeServerUrl('https://anna:secret@dav.example.com/')).toThrow('Enter the user name and password in their own fields');
    expect(() => normalizeServerUrl('anna@dav.example.com')).toThrow(DavNetworkError);
    expect(() => normalizeServerUrl('ftp://dav.example.com/')).toThrow(DavNetworkError);
  });
});
