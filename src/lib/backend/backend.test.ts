// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DavRequest, Transport } from '@/lib/dav/transport';
import type { AccountKind } from '@/lib/backend/types';
import { en } from '@/i18n/en';
import type { Account, Calendar } from '@/store/data';

// Every test starts the store from fresh modules; the first start of a run
// also compiles them, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

type Answer = { status: number; body?: string; headers?: Record<string, string> };

/** The backend module over a transport that answers from `handler`. */
async function load(handler: (req: DavRequest) => Answer | undefined = () => undefined) {
  const log: DavRequest[] = [];
  const transport: Transport = async (req) => {
    log.push(req);
    const r = handler(req) ?? { status: 404 };
    const headers = new Headers(r.headers);
    return { status: r.status, headers, body: r.body ?? '', location: headers.get('location') ?? undefined };
  };
  vi.resetModules();
  vi.doMock('@/lib/platform', () => ({ isNative: false, transportFor: () => transport }));
  const backends = await import('./index');
  const caldav = await import('./caldav');
  // The error classes of this copy of the modules: `instanceof` is what the mapping goes by.
  const { DavHttpError, DavNetworkError } = await import('@/lib/dav/transport');
  return { ...backends, ...caldav, DavHttpError, DavNetworkError, log };
}

const account = (over: Partial<Account> = {}): Account => ({
  id: 'acc',
  kind: 'caldav',
  name: 'Work',
  username: 'alice',
  password: 'secret',
  homeUrl: 'https://dav.example.com/alice/',
  useProxy: true,
  ...over,
});

const calendar = (over: Partial<Calendar> = {}): Calendar => ({
  id: 'acc|https://dav.example.com/alice/work/',
  accountId: 'acc',
  remoteId: 'https://dav.example.com/alice/work/',
  url: 'https://dav.example.com/alice/work/',
  name: 'Work',
  color: '#069c8d',
  components: ['VEVENT'],
  readOnly: false,
  visible: true,
  order: 1,
  ...over,
});

const ms = (inner: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">${inner}</d:multistatus>`;

const UID_CONFLICT = '<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><c:no-uid-conflict><d:href>/alice/home/x.ics</d:href></c:no-uid-conflict></d:error>';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/platform');
});

describe('objectFileName', () => {
  it('keeps a plain UID as it is', async () => {
    const { objectFileName } = await load();
    expect(objectFileName('5f1c0d6b-8a9e-4c3f-b2a1-7d0e6c4b9a58@calendar.example.org')).toBe('5f1c0d6b-8a9e-4c3f-b2a1-7d0e6c4b9a58@calendar.example.org');
    expect(objectFileName('a_b')).toBe('a_b');
  });

  it('keeps UIDs apart that differ only in characters it has to replace', async () => {
    const { objectFileName } = await load();
    const names = ['a/b', 'a b', 'a:b', 'a_b', 'a?b', 'a%2Fb'].map(objectFileName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9._@-]+$/);
    expect(objectFileName('a/b')).toBe(objectFileName('a/b'));
    expect(objectFileName('a/b')).toMatch(/^a_b-[0-9a-z]+$/);
  });

  it('shortens very long UIDs without making them collide', async () => {
    const { objectFileName } = await load();
    const a = objectFileName(`${'x'.repeat(300)}1`);
    const b = objectFileName(`${'x'.repeat(300)}2`);
    expect(a.length).toBeLessThanOrEqual(120);
    expect(a).not.toBe(b);
    expect(objectFileName('')).toMatch(/^item-[0-9a-z]+$/);
  });
});

describe('toBackendError', () => {
  it('maps HTTP statuses to codes and keeps message and status', async () => {
    const { toBackendError, BackendError, DavHttpError, DavNetworkError } = await load();
    const codes = { 401: 'auth', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 412: 'conflict', 429: 'rate-limit', 500: 'other', 507: 'other' };
    for (const [status, code] of Object.entries(codes)) {
      const mapped = toBackendError(new DavHttpError(Number(status), `HTTP ${status}`, 'body'));
      expect(mapped).toBeInstanceOf(BackendError);
      expect(mapped).toMatchObject({ code, status: Number(status), message: `HTTP ${status}` });
      expect((mapped as { uidConflict?: boolean }).uidConflict).toBeUndefined();
    }
    expect(toBackendError(new DavNetworkError('Could not reach dav.example.com'))).toMatchObject({ code: 'network', message: 'Could not reach dav.example.com' });
  });

  it('leaves errors it does not know alone', async () => {
    const { toBackendError } = await load();
    const odd = new Error('Invalid XML from server');
    expect(toBackendError(odd)).toBe(odd);
    expect(toBackendError('text')).toBe('text');
  });

  it('sees a UID conflict in the answer of the server, and only there', async () => {
    const { toBackendError, DavHttpError } = await load();
    for (const status of [403, 409, 412]) {
      expect(toBackendError(new DavHttpError(status, 'Saving failed', UID_CONFLICT))).toMatchObject({ uidConflict: true });
    }
    // The message quotes the request, and this path happens to contain "uid".
    const access = new DavHttpError(403, 'Access denied (PUT https://dav.example.com/uid-1234/work/a.ics)', '<d:error xmlns:d="DAV:"><d:need-privileges/></d:error>');
    expect((toBackendError(access) as { uidConflict?: boolean }).uidConflict).toBeUndefined();
    const guid = new DavHttpError(412, 'This item was changed on the server in the meantime.', 'The resource with GUID 77 was modified');
    expect((toBackendError(guid) as { uidConflict?: boolean }).uidConflict).toBeUndefined();
    // Not a status that carries the precondition.
    expect((toBackendError(new DavHttpError(500, 'x', UID_CONFLICT)) as { uidConflict?: boolean }).uidConflict).toBeUndefined();
  });
});

describe('the registry', () => {
  it('knows local and CalDAV accounts and nothing else until told', async () => {
    const { backendFor, registerBackend, BackendError, isBackendError } = await load();
    expect(backendFor(account({ id: 'local', kind: 'local' })).remote).toBe(false);
    expect(backendFor(account()).remote).toBe(true);

    // A kind this app has no backend for: it cannot be used until one is registered.
    const OTHER = 'other' as AccountKind;
    const other = account({ id: 'user1', kind: OTHER, password: undefined, homeUrl: undefined });
    let thrown: unknown;
    try {
      backendFor(other);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BackendError);
    expect(isBackendError(thrown, 'locked')).toBe(true);
    expect(isBackendError(thrown, 'auth', 'network')).toBe(false);
    expect((thrown as Error).message).toBe(en['data.locked']);

    const mine = backendFor(account({ id: 'local', kind: 'local' }));
    const seen: Account[] = [];
    registerBackend(OTHER, (a) => {
      seen.push(a);
      return mine;
    });
    expect(backendFor(other)).toBe(mine);
    expect(seen).toEqual([other]);
  });
});

describe('LocalBackend', () => {
  it('names objects, hands out etags and has nothing to sync', async () => {
    const { backendFor } = await load();
    const backend = backendFor(account({ id: 'local', kind: 'local' }));
    const cal = calendar({ id: 'local|personal', accountId: 'local', remoteId: 'personal', url: undefined });
    expect(backend.objectUrl(cal, 'a@example.com')).toBe('local://local|personal/a@example.com.ics');
    expect(await backend.createCalendar({ name: 'x', color: '#000000', components: ['VEVENT'] })).toMatch(/^[0-9a-f-]{36}$/);

    const first = await backend.putObject(cal, 'local://local|personal/a.ics', 'DATA', 'create');
    const second = await backend.putObject(cal, 'local://local|personal/a.ics', 'DATA', 'update', first!.etag);
    expect(first).toMatchObject({ url: 'local://local|personal/a.ics', data: 'DATA' });
    expect(second!.etag).not.toBe(first!.etag);

    const progress: [number, number][] = [];
    const stored = await backend.putObjects!(cal, [{ uid: 'a', data: 'A' }, { uid: 'b/c', data: 'B' }], (done, total) => progress.push([done, total]));
    expect(stored.map((o) => o.url)).toEqual(['local://local|personal/a.ics', backend.objectUrl(cal, 'b/c')]);
    expect(progress).toEqual([[2, 2]]);
    expect(await backend.listCalendars()).toEqual([]);
    expect(await backend.changesSince('personal', 't')).toBeNull();
  });
});

describe('CalDavBackend', () => {
  it('makes no request for an account whose password could not be read', async () => {
    const { backendFor, log } = await load();
    expect(() => backendFor(account({ password: undefined }))).toThrow(expect.objectContaining({ code: 'locked', message: expect.stringMatching(/password/i) }));
    expect(() => backendFor(account({ homeUrl: undefined }))).toThrow(expect.objectContaining({ code: 'other' }));
    // An empty password is a password.
    expect(backendFor(account({ password: '' })).remote).toBe(true);
    expect(log).toEqual([]);
  });

  it('lists calendars with the collection URL as their id', async () => {
    const { backendFor } = await load((req) =>
      req.method === 'PROPFIND'
        ? {
            status: 207,
            body: ms(`<d:response><d:href>/alice/work/</d:href><d:propstat><d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>
              <ic:calendar-color>#069C8DFF</ic:calendar-color><cs:getctag>c1</cs:getctag><d:sync-token>t1</d:sync-token>
              <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
            </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
          }
        : undefined,
    );
    expect(await backendFor(account()).listCalendars()).toEqual([
      {
        remoteId: 'https://dav.example.com/alice/work/',
        url: 'https://dav.example.com/alice/work/',
        displayName: 'Work',
        description: undefined,
        color: '#069c8d',
        order: undefined,
        components: ['VEVENT'],
        ctag: 'c1',
        syncToken: 't1',
        readOnly: false,
      },
    ]);
  });

  it('builds object URLs inside the collection, also from awkward UIDs', async () => {
    const { backendFor } = await load();
    const backend = backendFor(account());
    expect(backend.objectUrl(calendar(), 'abc@calendar.example.org')).toBe('https://dav.example.com/alice/work/abc@calendar.example.org.ics');
    expect(backend.objectUrl(calendar({ remoteId: 'https://dav.example.com/alice/work' }), 'abc')).toBe('https://dav.example.com/alice/work/abc.ics');
    const odd = backend.objectUrl(calendar(), '../../other/x?y#z');
    expect(odd.startsWith('https://dav.example.com/alice/work/')).toBe(true);
    expect(new URL(odd).pathname.split('/')).toHaveLength(4);
    expect(odd).not.toBe(backend.objectUrl(calendar(), '.._.._other_x_y_z'));
  });

  it('sends a create that must not replace, and an update that checks the etag', async () => {
    const { backendFor, log } = await load(() => ({ status: 201, headers: { etag: '"new"' } }));
    const backend = backendFor(account());
    const url = 'https://dav.example.com/alice/work/a.ics';
    expect(await backend.putObject(calendar(), url, 'DATA', 'create')).toEqual({ url, etag: '"new"', data: 'DATA' });
    await backend.putObject(calendar(), url, 'DATA', 'update', '"old"');
    await backend.putObject(calendar(), url, 'DATA', 'update');
    expect(log.map((r) => [r.method, r.headers?.['If-None-Match'], r.headers?.['If-Match']])).toEqual([
      ['PUT', '*', undefined],
      ['PUT', undefined, '"old"'],
      // No etag known: overwrite, rather than a create that can never succeed.
      ['PUT', undefined, undefined],
    ]);
    expect(log.every((r) => r.headers?.Authorization?.startsWith('Basic '))).toBe(true);
  });

  it('reads the object back when the server answers a write without an etag', async () => {
    const { backendFor, log } = await load((req) => (req.method === 'PUT' ? { status: 204 } : { status: 200, body: 'REWRITTEN', headers: { etag: '"srv"' } }));
    const url = 'https://dav.example.com/alice/work/a.ics';
    expect(await backendFor(account()).putObject(calendar(), url, 'DATA', 'create')).toEqual({ url, etag: '"srv"', data: 'REWRITTEN' });
    expect(log.map((r) => r.method)).toEqual(['PUT', 'GET']);
  });

  it('answers null when the object cannot be read back', async () => {
    const { backendFor } = await load((req) => (req.method === 'PUT' ? { status: 204 } : { status: 404 }));
    expect(await backendFor(account()).putObject(calendar(), 'https://dav.example.com/alice/work/a.ics', 'DATA', 'create')).toBeNull();
  });

  it('turns refusals into backend errors', async () => {
    const answers: Record<string, Answer> = {
      'a.ics': { status: 412 },
      'b.ics': { status: 403, body: UID_CONFLICT },
      'c.ics': { status: 401 },
      'd.ics': { status: 507, body: '<html>Insufficient storage</html>' },
    };
    const { backendFor, BackendError } = await load((req) => answers[req.url.split('/').pop()!]);
    const backend = backendFor(account());
    const put = (name: string) => backend.putObject(calendar(), `https://dav.example.com/alice/work/${name}`, 'DATA', 'create').catch((err: unknown) => err);
    expect(await put('a.ics')).toMatchObject({ code: 'conflict', status: 412 });
    expect(await put('b.ics')).toMatchObject({ code: 'forbidden', status: 403, uidConflict: true });
    expect(await put('c.ics')).toMatchObject({ code: 'auth', status: 401 });
    expect(await put('d.ics')).toMatchObject({ code: 'other', status: 507, message: expect.stringContaining('Insufficient storage') });
    expect(await put('a.ics')).toBeInstanceOf(BackendError);
  });

  it('writes calendar properties with the colour format CalDAV uses, and keeps the rest to itself', async () => {
    const { backendFor, log } = await load((req) => (req.method === 'MKCALENDAR' ? { status: 201 } : req.method === 'PROPPATCH' ? { status: 200 } : undefined));
    const backend = backendFor(account());
    const remoteId = await backend.createCalendar({ name: 'Trips & more', color: '#ec9607', components: ['VEVENT', 'VTODO'], visible: false, order: 3 });
    expect(remoteId).toMatch(/^https:\/\/dav\.example\.com\/alice\/[0-9a-f-]{36}\/$/);
    expect(log[0].body).toContain('<ic:calendar-color>#EC9607FF</ic:calendar-color>');
    expect(log[0].body).toContain('Trips &amp; more');

    await backend.updateCalendar(remoteId, { name: 'Trips', color: '#112233' });
    expect(log[1]).toMatchObject({ method: 'PROPPATCH', url: remoteId });
    expect(log[1].body).toContain('#112233FF');
    // Nothing to tell the server.
    await backend.updateCalendar(remoteId, { visible: false, order: 9 });
    expect(log).toHaveLength(2);
  });

  it('deletes objects, treating a missing one as deleted', async () => {
    const { backendFor, log } = await load((req) => (req.url.endsWith('gone.ics') ? { status: 404 } : { status: 204 }));
    const backend = backendFor(account());
    await backend.deleteObject('https://dav.example.com/alice/work/a.ics', '"1"');
    await backend.deleteObject('https://dav.example.com/alice/work/gone.ics');
    expect(log.map((r) => [r.method, r.headers?.['If-Match']])).toEqual([
      ['DELETE', '"1"'],
      ['DELETE', undefined],
    ]);
  });

  it('reports wrong credentials during discovery as an authentication failure', async () => {
    const { discoverCalDav } = await load(() => ({ status: 401 }));
    await expect(discoverCalDav({ serverUrl: 'dav.example.com', username: 'alice', password: 'wrong', useProxy: true })).rejects.toMatchObject({ code: 'auth', status: 401 });
  });
});
