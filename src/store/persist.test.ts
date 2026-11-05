// @vitest-environment jsdom
// What is stored under `calendar.data`: migration of older states, and CalDAV
// passwords, which are wrapped by a key in IndexedDB instead of sitting there
// in clear.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DavRequest, Transport } from '@/lib/dav/transport';

// Every test starts the store from fresh modules; the first start of a run
// also compiles them, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

// The CalDAV password of the fixtures. The tests look for it in localStorage,
// where it must not stay once it can be wrapped.
const PASSWORD = 'correct horse zażółć';

type Answer = { status: number; body?: string; headers?: Record<string, string> };

const ms = (inner: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">${inner}</d:multistatus>`;

/** A CalDAV server with one empty calendar, enough to add an account and sync it. */
const server = (req: DavRequest): Answer | undefined => {
  if (req.method !== 'PROPFIND') return undefined;
  if (req.body?.includes('current-user-principal')) {
    return { status: 207, body: ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/alice/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`) };
  }
  if (req.body?.includes('calendar-home-set')) {
    return { status: 207, body: ms(`<d:response><d:href>/alice/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/alice/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`) };
  }
  if (req.body?.includes('getctag')) {
    return {
      status: 207,
      body: ms(`<d:response><d:href>/alice/work/</d:href><d:propstat><d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><cs:getctag>c1</cs:getctag>
      </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
    };
  }
  return { status: 207, body: ms('') };
};

/** The app starting over whatever localStorage and IndexedDB hold. */
async function boot(handler: (req: DavRequest) => Answer | undefined | Promise<Answer | undefined> = server) {
  const log: DavRequest[] = [];
  const transport: Transport = async (req) => {
    log.push(req);
    const r = (await handler(req)) ?? { status: 404 };
    const headers = new Headers(r.headers);
    return { status: r.status, headers, body: r.body ?? '', location: headers.get('location') ?? undefined };
  };
  vi.resetModules();
  vi.doMock('@/lib/platform', () => ({ isNative: false, transportFor: () => transport }));
  const data = await import('./data');
  await data.useData.getState().init();
  return { ...data, state: () => data.useData.getState(), log };
}

const raw = () => localStorage.getItem('calendar.data') ?? '';
const persisted = () => JSON.parse(raw());
const basic = (password: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`alice:${password}`)))}`;

/** What version 1 of the app left behind: no `remoteId`, the password in clear. */
const V1 = {
  state: {
    accounts: [
      { id: 'local', kind: 'local', name: 'On this device', useProxy: false },
      {
        id: 'acc-1',
        kind: 'caldav',
        name: 'Work',
        serverUrl: 'https://dav.example.com/',
        username: 'alice',
        // PASSWORD, spelled out: this is the text version 1 wrote to disk.
        // 'an install of version 1' checks that the two are the same.
        password: 'correct horse zażółć',
        principalUrl: 'https://dav.example.com/alice/',
        homeUrl: 'https://dav.example.com/alice/',
        email: 'alice@example.com',
        useProxy: true,
        lastSync: 1760000000000,
      },
    ],
    calendars: [
      { id: 'local|personal', accountId: 'local', name: 'My calendar', color: '#8080ff', components: ['VEVENT'], readOnly: false, visible: true, order: 0 },
      { id: 'local|sub-1234', accountId: 'local', name: 'Feed', color: '#112233', components: ['VEVENT', 'VTODO'], readOnly: true, visible: false, order: 3, subscriptionUrl: 'https://example.com/feed.ics', lastFetched: 4102444800000 },
      {
        id: 'acc-1|https://dav.example.com/alice/work/',
        accountId: 'acc-1',
        url: 'https://dav.example.com/alice/work/',
        name: 'Work',
        color: '#069c8d',
        components: ['VEVENT'],
        readOnly: false,
        visible: false,
        ctag: 'c1',
        order: 100,
      },
    ],
  },
  version: 1,
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock('@/lib/platform');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('migrateData', () => {
  it('gives every calendar of version 1 its id on the backend', async () => {
    const { migrateData, DATA_VERSION } = await boot();
    expect(DATA_VERSION).toBe(2);
    const migrated = migrateData(V1.state, 1);
    expect(migrated.accounts).toEqual(V1.state.accounts);
    expect(migrated.calendars.map((c) => [c.id, c.remoteId])).toEqual([
      ['local|personal', 'personal'],
      ['local|sub-1234', 'sub-1234'],
      ['acc-1|https://dav.example.com/alice/work/', 'https://dav.example.com/alice/work/'],
    ]);
    for (const c of migrated.calendars) expect(c.id).toBe(`${c.accountId}|${c.remoteId}`);
    // Everything else is carried over untouched.
    expect(migrated.calendars[2]).toEqual({ ...V1.state.calendars[2], remoteId: 'https://dav.example.com/alice/work/' });
  });

  it('does not touch a current state, and survives a broken one', async () => {
    const { migrateData } = await boot();
    const current = migrateData(V1.state, 1);
    expect(migrateData(current, 2)).toEqual(current);
    expect(migrateData(undefined, 1)).toEqual({ accounts: [], calendars: [] });
    expect(migrateData({ accounts: 'nonsense' }, 1)).toEqual({ accounts: [], calendars: [] });
  });

  it('stores a CalDAV address typed without a scheme as discovery read it, and nothing else', async () => {
    const { migrateData } = await boot();
    const caldav = { kind: 'caldav', name: 'Mail', username: 'anna', useProxy: true };
    const migrated = migrateData(
      {
        accounts: [
          { ...caldav, id: 'a', serverUrl: 'posteo.de:8443/' },
          { ...caldav, id: 'b', serverUrl: ' localhost:5232' },
          { ...caldav, id: 'c', serverUrl: 'http://192.168.1.10:5232/' },
          { ...caldav, id: 'd', serverUrl: 'https://dav.example.com' },
          { ...caldav, id: 'e', serverUrl: 'not a host' },
          { id: 'local', kind: 'local', name: 'On this device', useProxy: false },
        ],
        calendars: [],
      },
      2,
    );
    expect(migrated.accounts.map((a) => a.serverUrl)).toEqual(['https://posteo.de:8443/', 'https://localhost:5232/', 'http://192.168.1.10:5232/', 'https://dav.example.com', 'not a host', undefined]);
    // Its id, and so its calendars' ids, stay as they are.
    expect(migrated.accounts.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'local']);
  });
});

describe('an install of version 1', () => {
  it('keeps its accounts and calendars across the version change', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const { state } = await boot();
    expect(state().accounts.map((a) => a.id)).toEqual(['local', 'acc-1']);
    expect(state().calendars.map((c) => [c.id, c.remoteId, c.visible])).toEqual([
      ['local|personal', 'personal', true],
      ['local|sub-1234', 'sub-1234', false],
      ['acc-1|https://dav.example.com/alice/work/', 'https://dav.example.com/alice/work/', false],
    ]);
    expect(persisted().version).toBe(2);
    expect(persisted().state.calendars.every((c: { remoteId?: string }) => !!c.remoteId)).toBe(true);
    // Nothing was added to an install that already exists.
    expect(state().calendars).toHaveLength(3);
  });

  it('takes the password out of localStorage and keeps it in memory', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    expect(raw()).toContain(PASSWORD);
    const { state } = await boot();

    const account = state().accounts.find((a) => a.id === 'acc-1')!;
    expect(account.password).toBe(PASSWORD);
    expect(account.passwordBox).toMatch(/^v1\./);
    const stored = persisted().state.accounts.find((a: { id: string }) => a.id === 'acc-1');
    expect(stored.password).toBeUndefined();
    expect(stored.passwordBox).toBe(account.passwordBox);
    expect(stored).toMatchObject({ username: 'alice', homeUrl: 'https://dav.example.com/alice/', lastSync: 1760000000000 });
    expect(raw()).not.toContain(PASSWORD);
    expect(raw()).not.toContain('zażółć');
  });

  it('has the password again after the next start, and signs in with it', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    await boot();
    const { state, log } = await boot();
    expect(state().accounts.find((a) => a.id === 'acc-1')!.password).toBe(PASSWORD);
    expect(raw()).not.toContain(PASSWORD);

    await state().syncAccount('acc-1');
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.headers?.Authorization === basic(PASSWORD))).toBe(true);
    expect(state().accounts.find((a) => a.id === 'acc-1')!.error).toBeUndefined();
    // Still not in clear after the sync wrote the account again.
    expect(raw()).not.toContain(PASSWORD);
  });
});

describe('where the password cannot be wrapped', () => {
  it('stays stored as before when there is no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const { state, log } = await boot();
    const account = state().accounts.find((a) => a.id === 'acc-1')!;
    expect(account.password).toBe(PASSWORD);
    expect(account.passwordBox).toBeUndefined();
    expect(persisted().state.accounts.find((a: { id: string }) => a.id === 'acc-1').password).toBe(PASSWORD);

    await state().syncAccount('acc-1');
    expect(log.every((r) => r.headers?.Authorization === basic(PASSWORD))).toBe(true);

    // And it still works on the next start.
    const again = await boot();
    expect(again.state().accounts.find((a) => a.id === 'acc-1')!.password).toBe(PASSWORD);
  });

  it('stays stored as before when there is no WebCrypto', async () => {
    vi.stubGlobal('crypto', { randomUUID: crypto.randomUUID.bind(crypto), getRandomValues: crypto.getRandomValues.bind(crypto) });
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const { state } = await boot();
    const account = state().accounts.find((a) => a.id === 'acc-1')!;
    expect(account.password).toBe(PASSWORD);
    expect(account.passwordBox).toBeUndefined();
    expect(persisted().state.accounts.find((a: { id: string }) => a.id === 'acc-1').password).toBe(PASSWORD);
  });

  it('wraps it later, once the browser can', async () => {
    vi.stubGlobal('indexedDB', undefined);
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    await boot();
    expect(raw()).toContain(PASSWORD);

    vi.stubGlobal('indexedDB', new IDBFactory());
    const { state } = await boot();
    expect(state().accounts.find((a) => a.id === 'acc-1')!.password).toBe(PASSWORD);
    expect(raw()).not.toContain(PASSWORD);
  });
});

describe('a password entered where it cannot be wrapped', () => {
  it('is kept in memory for the session and never stored in clear', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { state, log, passwordInMemoryOnly } = await boot();
    const account = await state().addCalDavAccount({ serverUrl: 'dav.example.com', username: 'alice', password: PASSWORD, useProxy: true });
    expect(account.passwordBox).toBeUndefined();
    expect(state().accounts.find((a) => a.id === account.id)!.password).toBe(PASSWORD);
    expect(raw()).not.toContain(PASSWORD);
    // The account card says it is not saved, not that it is saved unencrypted.
    expect(passwordInMemoryOnly(account.id)).toBe(true);
    expect(passwordInMemoryOnly('acc-1')).toBe(false);
    await state().setAccountPassword(account.id, 'another one');
    expect(raw()).not.toContain('another one');
    await state().syncAccount(account.id);
    expect(log.at(-1)?.headers?.Authorization).toBe(basic('another one'));

    // The next session asks for it again.
    const again = await boot();
    expect(again.state().accounts.find((a) => a.id === account.id)!.password).toBeUndefined();
  });
});

describe('when the key is gone', () => {
  it('keeps the account, asks nothing of the server and says what to do', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    await boot();
    // IndexedDB was cleared, localStorage was not.
    vi.stubGlobal('indexedDB', new IDBFactory());
    const { state, log } = await boot();

    const account = state().accounts.find((a) => a.id === 'acc-1')!;
    expect(account.password).toBeUndefined();
    expect(account.passwordBox).toMatch(/^v1\./);
    expect(state().calendars.some((c) => c.accountId === 'acc-1')).toBe(true);

    await expect(state().syncAccount('acc-1')).rejects.toMatchObject({ code: 'locked' });
    // Not one request: each would be a failed login with an empty password.
    expect(log).toEqual([]);
    expect(state().accounts.find((a) => a.id === 'acc-1')!.error).toMatch(/password .* can no longer be read/);

    // Entering the password again repairs it.
    await state().setAccountPassword('acc-1', PASSWORD);
    await state().syncAccount('acc-1');
    expect(log.every((r) => r.headers?.Authorization === basic(PASSWORD))).toBe(true);
    expect(state().accounts.find((a) => a.id === 'acc-1')!.error).toBeUndefined();
    expect(raw()).not.toContain(PASSWORD);
  });

  it('does not accept the wrapped password of another account', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    await boot();
    const stored = persisted();
    // Somebody edits localStorage to attach the box to an account with another server.
    stored.state.accounts.push({ ...stored.state.accounts[1], id: 'acc-evil', homeUrl: 'https://evil.example.net/' });
    localStorage.setItem('calendar.data', JSON.stringify(stored));
    const { state } = await boot();
    expect(state().accounts.find((a) => a.id === 'acc-1')!.password).toBe(PASSWORD);
    expect(state().accounts.find((a) => a.id === 'acc-evil')!.password).toBeUndefined();
  });
});

describe('a new CalDAV account', () => {
  it('never has its password stored in clear', async () => {
    const { state, log } = await boot();
    const account = await state().addCalDavAccount({ serverUrl: 'dav.example.com', username: ' alice ', password: PASSWORD, useProxy: true });
    expect(account).toMatchObject({ kind: 'caldav', username: 'alice', password: PASSWORD, homeUrl: 'https://dav.example.com/alice/', name: 'alice@dav.example.com' });
    expect(account.passwordBox).toMatch(/^v1\./);
    expect(raw()).not.toContain(PASSWORD);
    expect(log.every((r) => r.headers?.Authorization === basic(PASSWORD))).toBe(true);
    expect(state().calendars.find((c) => c.accountId === account.id)).toMatchObject({
      id: `${account.id}|https://dav.example.com/alice/work/`,
      remoteId: 'https://dav.example.com/alice/work/',
      url: 'https://dav.example.com/alice/work/',
      name: 'Work',
    });

    const again = await boot();
    expect(again.state().accounts.find((a) => a.id === account.id)!.password).toBe(PASSWORD);
  });

  it('is not left behind when its first sync fails', async () => {
    const { state } = await boot((req) => (req.body?.includes('getctag') && req.headers?.Depth === '1' && req.url.endsWith('/alice/') ? { status: 401 } : server(req)));
    // Discovery succeeds through other requests; the calendar listing is refused.
    await expect(state().addCalDavAccount({ serverUrl: 'dav.example.com', username: 'alice', password: PASSWORD, useProxy: true })).rejects.toMatchObject({ code: 'auth' });
    expect(state().accounts.map((a) => a.kind)).toEqual(['local']);
    expect(raw()).not.toContain('dav.example.com');
  });

  it('gets a new wrapped password when it is changed', async () => {
    const { state } = await boot();
    const account = await state().addCalDavAccount({ serverUrl: 'dav.example.com', username: 'alice', password: PASSWORD, useProxy: true });
    await state().setAccountPassword(account.id, 'another one');
    const now = state().accounts.find((a) => a.id === account.id)!;
    expect(now.password).toBe('another one');
    expect(now.passwordBox).not.toBe(account.passwordBox);
    expect(raw()).not.toContain('another one');
    const again = await boot();
    expect(again.state().accounts.find((a) => a.id === account.id)!.password).toBe('another one');
  });
});

describe('a server that sends too much', () => {
  const event = (uid: string) =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260101T000000Z', 'DTSTART:20260102T100000Z', 'DTEND:20260102T110000Z', 'SUMMARY:Kept', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const kept = (objects: Record<string, Record<string, { data: string }>>, uid: string) =>
    Object.values(objects['local|personal'] ?? {}).some((o) => o.data.includes(`UID:${uid}`));

  it('cannot fill localStorage with one calendar and so stop every later change from being saved', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    // Each alone fits, together they are more than the browser keeps for the app.
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const { state } = await boot((req) =>
      req.body?.includes('getctag')
        ? {
            status: 207,
            body: ms(`<d:response><d:href>/alice/work/</d:href><d:propstat><d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${huge}</d:displayname>
              <c:calendar-description>${huge}</c:calendar-description><cs:getctag>${huge}</cs:getctag>
            </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
          }
        : server(req),
    );
    await state().syncAccount('acc-1');
    const work = state().calendars.find((c) => c.accountId === 'acc-1')!;
    expect(work.name.length).toBeLessThanOrEqual(200);
    expect(work.description!.length).toBeLessThanOrEqual(2000);
    expect(work.ctag).toBeUndefined();
    expect(raw().length).toBeLessThan(100_000);

    await state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'after', data: event('after') }]);
    state().setCalendarVisible('local|personal', false);
    const again = await boot();
    expect(kept(again.state().objects, 'after')).toBe(true);
    expect(again.state().calendars.find((c) => c.id === 'local|personal')!.visible).toBe(false);
  });

  it('leaves out a calendar whose address is too long to keep', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const long = `/alice/${'a'.repeat(5000)}/`;
    const { state } = await boot((req) =>
      req.body?.includes('getctag')
        ? {
            status: 207,
            body: ms(['/alice/work/', long].map((href) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Cal</d:displayname>
            </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')),
          }
        : server(req),
    );
    await state().syncAccount('acc-1');
    expect(state().calendars.filter((c) => c.accountId === 'acc-1').map((c) => c.remoteId)).toEqual(['https://dav.example.com/alice/work/']);
  });

  it('keeps the app working when localStorage is full anyway', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const { state } = await boot();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    await state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'full', data: event('full') }]);
    expect(() => state().setCalendarVisible('local|personal', false)).not.toThrow();
    expect(state().calendars.find((c) => c.id === 'local|personal')!.visible).toBe(false);
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
    // The event is in IndexedDB, which is where it counts.
    expect(kept((await boot()).state().objects, 'full')).toBe(true);
  });

  it('keeps an account error short', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const { state } = await boot(() => {
      throw new Error('y'.repeat(1_000_000));
    });
    await expect(state().syncAccount('acc-1')).rejects.toThrow();
    expect(state().accounts.find((a) => a.id === 'acc-1')!.error!.length).toBeLessThanOrEqual(2000);
  });
});

describe('when the key cannot be read just now', () => {
  /** IndexedDB as it is, except that the database with the key does not open. */
  const keyStoreDown = (real: IDBFactory) =>
    ({
      open: (name: string, version?: number) => {
        if (name === 'calendar-secrets') throw new DOMException('The database could not be opened', 'UnknownError');
        return real.open(name, version);
      },
    }) as unknown as IDBFactory;

  it('does not write the account off, and reads the password at a later sync', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    await boot();
    const working = indexedDB;
    vi.stubGlobal('indexedDB', keyStoreDown(working));
    const { state, log } = await boot();
    expect(state().accounts.find((a) => a.id === 'acc-1')!.password).toBeUndefined();

    await expect(state().syncAccount('acc-1')).rejects.toMatchObject({ code: 'locked' });
    expect(log).toEqual([]);
    const error = state().accounts.find((a) => a.id === 'acc-1')!.error;
    expect(error).toMatch(/could not be read just now/);
    expect(error).not.toMatch(/Remove the account/);

    vi.stubGlobal('indexedDB', working);
    await state().syncAccount('acc-1');
    expect(state().accounts.find((a) => a.id === 'acc-1')).toMatchObject({ password: PASSWORD, error: undefined });
    expect(log.every((r) => r.headers?.Authorization === basic(PASSWORD))).toBe(true);
  });
});

describe('a sync that lists the calendars while one is changed here', () => {
  /** The server, with the listing of the calendars held until `release` is called. */
  function held() {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    const handler = async (req: DavRequest): Promise<Answer | undefined> => {
      if (req.method === 'PROPPATCH') return { status: 207, body: ms('') };
      if (req.method === 'DELETE') return { status: 204 };
      if (holding && req.body?.includes('getctag') && req.headers?.Depth === '1') await gate;
      return server(req);
    };
    return { handler, hold: () => (holding = true), release };
  }
  const work = 'acc-1|https://dav.example.com/alice/work/';
  const listingAsked = async (log: DavRequest[]) => {
    for (let i = 0; i < 100 && !log.some((r) => r.body?.includes('getctag')); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it('keeps the new name of one renamed meanwhile', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const dav = held();
    const { state, log } = await boot(dav.handler);
    dav.hold();
    const syncing = state().syncAccount('acc-1');
    await listingAsked(log);
    await state().updateCalendar(work, { name: 'Projects' });
    dav.release();
    await syncing;
    expect(state().calendars.find((c) => c.id === work)?.name).toBe('Projects');
  });

  it('does not bring back one deleted meanwhile', async () => {
    localStorage.setItem('calendar.data', JSON.stringify(V1));
    const dav = held();
    const { state, log } = await boot(dav.handler);
    dav.hold();
    const syncing = state().syncAccount('acc-1');
    await listingAsked(log);
    await state().deleteCalendar(work);
    dav.release();
    await syncing;
    expect(state().calendars.some((c) => c.id === work)).toBe(false);
    expect(state().objects[work]).toBeUndefined();
  });
});
