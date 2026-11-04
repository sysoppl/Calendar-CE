// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://calendar.example/"}
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser's bundle at its https address: feeds are fetched by the browser first.
vi.setConfig({ testTimeout: 30_000 });

const FEED = 'https://feeds.example.net/private/token-abc/basic.ics';
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART:20261012T090000Z\r\nDTEND:20261012T100000Z\r\nSUMMARY:Team day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

type Call = { url: string; init?: RequestInit };
let calls: Call[];

/** `direct` answers a request to the feed's own server; the proxy answers requests to /dav-proxy. */
function network(direct: (url: string) => Response | Error, proxy: () => Response = () => new Response(ICS, { status: 200, headers: { 'x-dav-proxy-relay': '1' } })) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init });
      if (input === '/dav-proxy') return proxy();
      const answer = direct(input);
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  );
}

async function boot() {
  vi.resetModules();
  const { useData } = await import('./data');
  await useData.getState().init();
  return useData;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  calls = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('subscribed feeds in the browser', () => {
  it('are fetched by the browser itself, without credentials or referrer, and never pass the proxy', async () => {
    network(() => new Response(ICS, { status: 200, headers: { 'content-type': 'text/calendar' } }));
    const data = await boot();
    const cal = await data.getState().addSubscription({ url: FEED.replace('https://', 'webcal://'), name: 'Team', color: '#2d772a' });
    expect(Object.values(data.getState().objects[cal.id]).map((o) => o.data)).toEqual([expect.stringContaining('SUMMARY:Team day')]);
    expect(calls.map((c) => c.url)).toEqual([FEED]);
    expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', redirect: 'follow', cache: 'no-store' });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fall back to the proxy when the browser may not read them, and go there first afterwards in this tab', async () => {
    // What a missing CORS header looks like to a script.
    network(() => new TypeError('Failed to fetch'));
    const data = await boot();
    const cal = await data.getState().addSubscription({ url: FEED, name: 'Team', color: '#2d772a' });
    expect(calls.map((c) => c.url)).toEqual([FEED, '/dav-proxy']);
    expect((calls[1].init?.headers as Record<string, string>)['X-Dav-Target']).toBe(FEED);
    expect(Object.keys(data.getState().objects[cal.id])).toHaveLength(1);

    await data.getState().refreshSubscription(cal.id, true);
    expect(calls.map((c) => c.url)).toEqual([FEED, '/dav-proxy', '/dav-proxy']);
  });

  it('keep trying the browser first while the proxy fails too (offline)', async () => {
    network(
      () => new TypeError('Failed to fetch'),
      () => {
        throw new TypeError('Failed to fetch');
      },
    );
    const data = await boot();
    await expect(data.getState().addSubscription({ url: FEED, name: 'Team', color: '#2d772a' })).rejects.toThrow();
    await expect(data.getState().addSubscription({ url: FEED, name: 'Team', color: '#2d772a' })).rejects.toThrow();
    expect(calls.map((c) => c.url)).toEqual([FEED, '/dav-proxy', FEED, '/dav-proxy']);
  });

  it("report the feed server's own refusal without asking the proxy", async () => {
    network(() => new Response('gone', { status: 404, headers: { 'access-control-allow-origin': '*' } }));
    const data = await boot();
    await expect(data.getState().addSubscription({ url: FEED, name: 'Team', color: '#2d772a' })).rejects.toThrow('HTTP 404');
    expect(calls.map((c) => c.url)).toEqual([FEED]);
  });

  it('go through the proxy at once when plain http (the page would block it as mixed content)', async () => {
    network(() => new Error('not to be asked'));
    const data = await boot();
    await data.getState().addSubscription({ url: 'http://feeds.example.net/basic.ics', name: 'Team', color: '#2d772a' });
    expect(calls.map((c) => c.url)).toEqual(['/dav-proxy']);
  });

  it('are refused with a user name or password in the address, before anything is fetched', async () => {
    network(() => new Response(ICS, { status: 200 }));
    const data = await boot();
    await expect(data.getState().addSubscription({ url: 'webcal://anna:secret@feeds.example.net/x.ics', name: 'Team', color: '#2d772a' })).rejects.toThrow(
      'Enter the user name and password in their own fields',
    );
    expect(calls).toEqual([]);
    expect(data.getState().calendars.some((c) => c.subscriptionUrl)).toBe(false);
  });

  it('are refused over the size the proxy allows, and not fetched again through it', async () => {
    network(() => new Response(ICS, { status: 200, headers: { 'content-length': String(65 * 1024 * 1024) } }));
    const data = await boot();
    await expect(data.getState().addSubscription({ url: FEED, name: 'Team', color: '#2d772a' })).rejects.toThrow('larger than 64 MiB');
    expect(calls.map((c) => c.url)).toEqual([FEED]);
  });
});
