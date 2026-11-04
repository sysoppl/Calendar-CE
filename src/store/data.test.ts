// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeBackendOptions } from '@/lib/backend/fake';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';

// Every test starts the store from fresh modules; the first start of a run
// also compiles them, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const USER = 'user1';

/** The CalDAV account the tests sync, served by the test's fake backend. */
const SERVER = { id: USER, kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };

function ics(uid: string, title = uid): string {
  return createEventIcs({
    uid,
    title,
    description: '',
    location: '',
    start: new Date(2026, 9, 12, 9, 0),
    end: new Date(2026, 9, 12, 10, 0),
    allDay: false,
    timezone: 'Europe/Warsaw',
    alarms: [],
    busy: true,
    attendees: [],
    categories: [],
  });
}

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

/** The app starting: fresh modules over whatever localStorage and IndexedDB hold. */
async function boot(options: FakeBackendOptions & { account?: boolean } = {}) {
  vi.resetModules();
  const data = await import('./data');
  const app = await import('./app');
  const backends = await import('@/lib/backend');
  const storage = await import('@/lib/storage');
  const { FakeBackend } = await import('@/lib/backend/fake');
  const fake = new FakeBackend(options);
  // Every CalDAV account talks to the fake: nothing here reaches the network.
  backends.registerBackend('caldav', () => fake);
  const { useData } = data;
  await useData.getState().init();
  /** Adds the CalDAV account, as `addCalDavAccount` leaves it before its first sync. */
  const addServer = () => useData.setState((s) => ({ accounts: [...s.accounts.filter((a) => a.id !== USER), SERVER] }));
  if (options.account !== false) addServer();
  const state = () => useData.getState();
  const calendar = (remoteId: string) => state().calendars.find((c) => c.remoteId === remoteId)!;
  const objectsOf = (remoteId: string) => Object.values(state().objects[calendar(remoteId)?.id] ?? {});
  const titles = (remoteId: string) =>
    objectsOf(remoteId)
      .map((o) => /^SUMMARY:(.*)$/m.exec(o.data)?.[1].trim())
      .sort();
  return { ...data, ...app, ...backends, storage, fake, addServer, state, calendar, objectsOf, titles, sync: () => state().syncAccount(USER) };
}

const persisted = () => JSON.parse(localStorage.getItem('calendar.data') ?? 'null');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock('@/lib/storage');
  vi.doUnmock('@/lib/platform');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sync through a backend', () => {
  it('lists calendars, downloads their objects and caches them', async () => {
    const { fake, state, calendar, titles, storage, sync } = await boot();
    fake.addCalendar('work', { displayName: 'Work', color: '#069c8d', components: ['VEVENT', 'VTODO'] });
    fake.addCalendar('shared', { displayName: 'Shared', readOnly: true });
    fake.seed('work', 'a', ics('a', 'Standup'));
    fake.seed('work', 'b', ics('b', 'Review'));
    await sync();

    expect(calendar('work')).toMatchObject({ id: `${USER}|work`, accountId: USER, remoteId: 'work', name: 'Work', color: '#069c8d', readOnly: false, visible: true });
    expect(calendar('shared').readOnly).toBe(true);
    expect(titles('work')).toEqual(['Review', 'Standup']);
    expect(state().objects[`${USER}|shared`]).toEqual({});
    expect(state().accounts.find((a) => a.id === USER)).toMatchObject({ error: undefined });
    expect(state().accounts.find((a) => a.id === USER)!.lastSync).toBeGreaterThan(0);
    await vi.waitFor(async () => expect(await storage.loadObjects(`${USER}|work`)).toHaveLength(2));
  });

  it('asks for nothing when the calendar has not changed, and for the changes when it has', async () => {
    const { fake, titles, sync } = await boot();
    fake.addCalendar('work');
    const a = fake.seed('work', 'a', ics('a', 'One'));
    fake.seed('work', 'b', ics('b', 'Two'));
    await sync();

    fake.calls.length = 0;
    await sync();
    expect(fake.calls).toEqual(['listCalendars']);

    fake.seed('work', 'b', ics('b', 'Two moved'));
    fake.seed('work', 'c', ics('c', 'Three'));
    fake.remove('work', a);
    fake.calls.length = 0;
    await sync();
    expect(fake.calls).toEqual(['listCalendars', 'changesSince work t2', 'getObjects work 2']);
    expect(titles('work')).toEqual(['Three', 'Two moved']);
  });

  it('falls back to a full listing when the cursor is no longer good', async () => {
    const { fake, titles, useData, calendar, sync } = await boot();
    fake.addCalendar('work');
    fake.seed('work', 'a', ics('a', 'One'));
    await sync();
    // A cursor from somewhere else, as after a server was restored from a backup.
    useData.setState((s) => ({ calendars: s.calendars.map((c) => (c.remoteId === 'work' ? { ...c, syncToken: 'gone' } : c)) }));
    fake.seed('work', 'b', ics('b', 'Two'));
    fake.calls.length = 0;
    await sync();
    expect(fake.calls).toEqual(['listCalendars', 'changesSince work gone', 'listObjects work', 'getObjects work 1']);
    expect(titles('work')).toEqual(['One', 'Two']);
    expect(calendar('work').syncToken).toBe('t2');
  });

  it('works with a server that has no sync tokens', async () => {
    const { fake, titles, sync } = await boot({ tokens: false });
    fake.addCalendar('work');
    const a = fake.seed('work', 'a', ics('a', 'One'));
    await sync();
    fake.seed('work', 'b', ics('b', 'Two'));
    fake.remove('work', a);
    fake.calls.length = 0;
    await sync();
    expect(fake.calls).toEqual(['listCalendars', 'listObjects work', 'getObjects work 1']);
    expect(titles('work')).toEqual(['Two']);
  });

  it('forgets calendars that are gone, with what was cached for them', async () => {
    const { fake, state, storage, sync } = await boot();
    fake.addCalendar('work');
    fake.addCalendar('old');
    fake.seed('old', 'a', ics('a'));
    await sync();
    await vi.waitFor(async () => expect(await storage.loadObjects(`${USER}|old`)).toHaveLength(1));

    fake.calendars.delete('old');
    await sync();
    expect(state().calendars.map((c) => c.remoteId)).toEqual(['work']);
    expect(state().objects[`${USER}|old`]).toBeUndefined();
    await vi.waitFor(async () => expect(await storage.loadObjects(`${USER}|old`)).toEqual([]));
  });

  it('keeps per-calendar errors on the account and still syncs the rest', async () => {
    const { fake, state, titles, BackendError, sync } = await boot();
    fake.addCalendar('good');
    fake.addCalendar('bad', { displayName: 'Broken' });
    fake.seed('good', 'a', ics('a', 'Fine'));
    fake.before = (call) => {
      if (call === 'listObjects bad') throw new BackendError('other', 'HTTP 500');
    };
    await sync();
    expect(titles('good')).toEqual(['Fine']);
    expect(state().accounts.find((a) => a.id === USER)!.error).toBe('Broken: HTTP 500');
  });

  it('stops at an authentication failure and reports it', async () => {
    const { fake, state, BackendError, sync } = await boot();
    fake.addCalendar('work');
    fake.before = (call) => {
      if (call.startsWith('listObjects')) throw new BackendError('auth', 'Unauthorized', { status: 401 });
    };
    await expect(sync()).rejects.toMatchObject({ code: 'auth' });
    expect(state().accounts.find((a) => a.id === USER)).toMatchObject({ error: 'Unauthorized' });
    expect(state().syncing[USER]).toBe(false);
  });

  it('takes visibility and order from a backend that stores them', async () => {
    const { fake, calendar, state, sync } = await boot({ storesView: true });
    fake.addCalendar('work', { visible: false, order: 7 });
    await sync();
    expect(calendar('work')).toMatchObject({ visible: false, order: 7 });

    state().setCalendarVisible(calendar('work').id, true);
    expect(calendar('work').visible).toBe(true);
    await vi.waitFor(() => expect(fake.calendars.get('work')!.info.visible).toBe(true));
    expect(fake.calls).toContain('updateCalendar work visible');
  });

  it('does not let a listing that is already out undo a change made here', async () => {
    const { fake, calendar, state, sync } = await boot({ storesView: true });
    fake.addCalendar('work', { visible: true });
    await sync();
    // The change is on its way to the server while a sync lists the old value.
    const held = gate();
    fake.before = (call) => (call.startsWith('updateCalendar') ? held.wait : undefined);
    state().setCalendarVisible(calendar('work').id, false);
    await sync();
    expect(calendar('work').visible).toBe(false);
    held.open();
    await vi.waitFor(() => expect(fake.calendars.get('work')!.info.visible).toBe(false));
    await sync();
    expect(calendar('work').visible).toBe(false);
  });

  it('keeps visibility on the device for a backend that does not store it', async () => {
    const { fake, calendar, state, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    state().setCalendarVisible(calendar('work').id, false);
    await sync();
    expect(calendar('work').visible).toBe(false);
  });
});

describe('writes while a sync is in flight', () => {
  it('keeps an item added here and one deleted here', async () => {
    const { fake, state, calendar, titles, storage, sync } = await boot();
    fake.addCalendar('work');
    fake.seed('work', 'a', ics('a', 'Changes elsewhere'));
    const doomed = fake.seed('work', 'd', ics('d', 'Deleted here'));
    await sync();

    // Another device edits A. The sync that notices is held while it downloads.
    fake.seed('work', 'a', ics('a', 'Changed elsewhere'));
    const held = gate();
    fake.before = (call) => (call.startsWith('getObjects') ? held.wait : undefined);
    const syncing = sync();
    await vi.waitFor(() => expect(fake.calls.at(-1)).toMatch(/^getObjects/));

    const cal = calendar('work');
    await state().applyOps([{ type: 'create', calendarId: cal.id, uid: 'b', data: ics('b', 'Added here') }]);
    await state().applyOps([{ type: 'delete', url: doomed, etag: state().objects[cal.id][doomed].etag }]);
    expect(titles('work')).toEqual(['Added here', 'Changes elsewhere']);

    held.open();
    await syncing;
    // The sync applied its one change and nothing else: the new item is not
    // dropped, the deleted one is not brought back.
    expect(titles('work')).toEqual(['Added here', 'Changed elsewhere']);
    expect(fake.urls('work')).toEqual(Object.keys(state().objects[cal.id]).sort());
    await vi.waitFor(async () => expect((await storage.loadObjects(cal.id))?.map((o) => o.url).sort()).toEqual(fake.urls('work')));

    await sync();
    expect(titles('work')).toEqual(['Added here', 'Changed elsewhere']);
  });

  it('leaves an item alone while its own write is still unanswered, and looks again next time', async () => {
    const { fake, state, calendar, objectsOf, titles, sync } = await boot({ tokens: false });
    fake.addCalendar('work');
    const url = fake.seed('work', 'a', ics('a', 'Before'));
    await sync();
    const cal = calendar('work');
    const ctag = cal.ctag;

    // The server has the edit, but its answer is slow.
    const answer = gate();
    fake.after = (call) => (call.startsWith('putObject') ? answer.wait : undefined);
    const writing = state().applyOps([{ type: 'update', url, etag: objectsOf('work')[0].etag, data: ics('a', 'After') }]);
    await vi.waitFor(() => expect(fake.calendars.get('work')!.objects.get(url)!.data).toContain('After'));

    await sync();
    // The sync saw a new etag and fetched it, but did not touch what is being written.
    expect(fake.calls).toContain('getObjects work 1');
    expect(objectsOf('work')[0].etag).toBe('"1"');
    expect(calendar('work').ctag).toBe(ctag);

    answer.open();
    await writing;
    expect(titles('work')).toEqual(['After']);
    expect(objectsOf('work')[0].etag).toBe('"2"');

    await sync();
    expect(calendar('work').ctag).not.toBe(ctag);
    expect(titles('work')).toEqual(['After']);
  });

  it('commits nothing for an account that was removed meanwhile', async () => {
    const { fake, state, storage, sync } = await boot();
    fake.addCalendar('work');
    fake.seed('work', 'a', ics('a'));
    const held = gate();
    fake.before = (call) => (call.startsWith('getObjects') ? held.wait : undefined);
    const syncing = sync();
    await vi.waitFor(() => expect(fake.calls.at(-1)).toMatch(/^getObjects/));
    expect(state().calendars.some((c) => c.accountId === USER)).toBe(true);

    await state().removeAccount(USER);
    held.open();
    await expect(syncing).resolves.toBeUndefined();

    expect(state().accounts.some((a) => a.id === USER)).toBe(false);
    expect(state().calendars.some((c) => c.accountId === USER)).toBe(false);
    expect(Object.keys(state().objects).some((id) => id.startsWith(USER))).toBe(false);
    expect(state().syncing[USER]).toBeUndefined();
    expect(await storage.loadObjects(`${USER}|work`)).toEqual([]);
  });

  it("forgets the parsed copies of a removed account's and a deleted calendar's items", async () => {
    const { fake, state, sync, objectsOf } = await boot();
    const { parseObject } = await import('@/lib/ical/parse');
    fake.addCalendar('work');
    fake.addCalendar('home');
    fake.seed('work', 'a', ics('a', 'Secret meeting'));
    fake.seed('home', 'b', ics('b', 'Dentist'));
    await sync();
    const work = objectsOf('work')[0];
    const home = objectsOf('home')[0];
    const local = { url: 'local-1.ics', etag: '1', calendarId: 'local|personal', data: ics('c', 'Mine') };
    const parsed = { work: parseObject(work), home: parseObject(home), local: parseObject(local) };
    // Kept: the same copy comes back.
    expect(parseObject(work)).toBe(parsed.work);

    await state().deleteCalendar(`${USER}|home`);
    expect(parseObject(home)).not.toBe(parsed.home);
    expect(parseObject(work)).toBe(parsed.work);

    await state().removeAccount(USER);
    expect(parseObject(work)).not.toBe(parsed.work);
    // Another account's stay.
    expect(parseObject(local)).toBe(parsed.local);
  });

  it("drops the migration journal of a removed account, and only of that one", async () => {
    const { state, addServer } = await boot();
    await import('@/lib/migrate');
    const journal = (source: string, target: string) => JSON.stringify({ v: 1, sourceAccountId: source, targetAccountId: target, calendars: {} });
    localStorage.setItem('calendar.migration', journal('other', 'local'));
    await state().removeAccount(USER);
    expect(localStorage.getItem('calendar.migration')).toBe(journal('other', 'local'));

    addServer();
    localStorage.setItem('calendar.migration', journal('local', USER));
    await state().removeAccount(USER);
    expect(localStorage.getItem('calendar.migration')).toBeNull();
  });

  it('commits nothing when the account went away before the calendars were listed', async () => {
    const { fake, state, sync } = await boot();
    fake.addCalendar('work');
    const held = gate();
    fake.before = (call) => (call === 'listCalendars' ? held.wait : undefined);
    const syncing = sync();
    await state().removeAccount(USER);
    held.open();
    await syncing;
    expect(state().calendars.some((c) => c.accountId === USER)).toBe(false);
  });

  it('does not mix an old sync into an account that was added again under the same id', async () => {
    const { fake, state, titles, sync, addServer } = await boot();
    fake.addCalendar('work');
    fake.seed('work', 'a', ics('a', 'One'));
    const held = gate();
    fake.before = (call) => (call.startsWith('getObjects') && held.wait) || undefined;
    const old = sync();
    await vi.waitFor(() => expect(fake.calls.at(-1)).toMatch(/^getObjects/));

    await state().removeAccount(USER);
    addServer();
    fake.before = undefined;
    // Its own sync, not the tail of the old one.
    await sync();
    expect(titles('work')).toEqual(['One']);
    const objects = state().objects[`${USER}|work`];

    held.open();
    await old;
    expect(state().objects[`${USER}|work`]).toBe(objects);
    expect(state().syncing[USER]).toBe(false);
  });
});

describe('the write path', () => {
  it('creates, updates and deletes through the backend with an explicit mode', async () => {
    const { fake, state, calendar, objectsOf, storage, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');

    const [url] = await state().applyOps([{ type: 'create', calendarId: cal.id, uid: 'a@example.com', data: ics('a@example.com', 'New') }]);
    expect(url).toBe('fake://work/a@example.com.ics');
    expect(objectsOf('work')).toEqual([{ url, etag: '"1"', calendarId: cal.id, data: expect.stringContaining('SUMMARY:New') }]);

    await state().applyOps([{ type: 'update', url, etag: '"1"', data: ics('a@example.com', 'Edited') }]);
    await state().applyOps([{ type: 'delete', url, etag: '"2"' }]);
    expect(fake.calls.filter((c) => /Object /.test(c))).toEqual([`putObject create ${url}`, `putObject update ${url} "1"`, `deleteObject ${url} "2"`]);
    expect(objectsOf('work')).toEqual([]);
    await vi.waitFor(async () => expect(await storage.loadObjects(cal.id)).toEqual([]));
  });

  it('updates an item without an etag as an update, not as a create', async () => {
    const { fake, state, useData, calendar, titles, sync } = await boot();
    fake.addCalendar('work');
    const url = fake.seed('work', 'a', ics('a', 'Before'));
    await sync();
    // A server that sends no etags leaves them empty.
    const cal = calendar('work');
    useData.setState((s) => ({ objects: { ...s.objects, [cal.id]: { [url]: { ...s.objects[cal.id][url], etag: '' } } } }));

    await state().applyOps([{ type: 'update', url, etag: '', data: ics('a', 'After') }]);
    expect(fake.calls.at(-1)).toBe(`putObject update ${url}`);
    expect(titles('work')).toEqual(['After']);
  });

  it('rolls an optimistic change back when the backend refuses it, and syncs after a conflict', async () => {
    const { fake, state, calendar, titles, sync } = await boot();
    fake.addCalendar('work');
    const url = fake.seed('work', 'a', ics('a', 'Mine'));
    await sync();
    fake.seed('work', 'a', ics('a', 'Theirs'));

    const held = gate();
    fake.before = (call) => (call.startsWith('putObject') ? held.wait : undefined);
    const writing = state().applyOps([{ type: 'update', url, etag: '"1"', data: ics('a', 'Mine edited') }]);
    await vi.waitFor(() => expect(titles('work')).toEqual(['Mine edited']));
    held.open();
    await expect(writing).rejects.toMatchObject({ code: 'conflict' });
    expect(calendar('work')).toBeDefined();
    // Back to what was there, and then replaced by what the server has.
    await vi.waitFor(() => expect(titles('work')).toEqual(['Theirs']));
  });

  it('never stores an unconfirmed change on disk', async () => {
    const { fake, state, calendar, storage, BackendError, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');
    const held = gate();
    fake.before = async (call) => {
      if (!call.startsWith('putObject')) return;
      await held.wait;
      throw new BackendError('network', 'Offline');
    };
    const writing = state().applyOps([{ type: 'create', calendarId: cal.id, uid: 'a', data: ics('a') }]);
    await vi.waitFor(() => expect(Object.keys(state().objects[cal.id])).toHaveLength(1));
    expect(await storage.loadObjects(cal.id)).toEqual([]);
    held.open();
    await expect(writing).rejects.toThrow('Offline');
    expect(state().objects[cal.id]).toEqual({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await storage.loadObjects(cal.id)).toEqual([]);
  });

  it('refuses a second item with the same UID in one calendar instead of overwriting', async () => {
    const { state } = await boot({ account: false });
    await state().setupLocalDefaults();
    const cal = state().calendars.find((c) => c.id === 'local|personal')!;
    await state().applyOps([{ type: 'create', calendarId: cal.id, uid: 'a', data: ics('a', 'First') }]);
    await expect(state().applyOps([{ type: 'create', calendarId: cal.id, uid: 'a', data: ics('a', 'Second') }])).rejects.toMatchObject({ code: 'conflict' });
    expect(Object.values(state().objects[cal.id]).map((o) => o.data)).toEqual([expect.stringContaining('First')]);
  });

  it('gives UIDs that differ only in unsafe characters different URLs', async () => {
    const { state } = await boot({ account: false });
    await state().setupLocalDefaults();
    const cal = 'local|personal';
    const urls = await state().applyOps([
      { type: 'create', calendarId: cal, uid: 'a/b', data: ics('a/b', 'Slash') },
      { type: 'create', calendarId: cal, uid: 'a_b', data: ics('a_b', 'Underscore') },
      { type: 'create', calendarId: cal, uid: 'a b', data: ics('a b', 'Space') },
    ]);
    expect(new Set(urls).size).toBe(3);
    expect(urls[1]).toBe('local://local|personal/a_b.ics');
    expect(Object.keys(state().objects[cal])).toHaveLength(3);
  });

  it('takes back the first half of a batch when the second half fails', async () => {
    const { fake, state, calendar, titles, BackendError, sync } = await boot();
    fake.addCalendar('work');
    const url = fake.seed('work', 'series', ics('series', 'Whole series'));
    await sync();
    const cal = calendar('work');
    fake.before = (call) => {
      if (call.startsWith('putObject create')) throw new BackendError('network', 'Connection lost');
    };
    // "This and future events": the series is cut short, then its successor is created.
    await expect(
      state().applyOps([
        { type: 'update', url, etag: '"1"', data: ics('series', 'Cut short') },
        { type: 'create', calendarId: cal.id, uid: 'tail', data: ics('tail', 'The rest') },
      ]),
    ).rejects.toThrow('Connection lost');
    expect(titles('work')).toEqual(['Whole series']);
    expect(fake.calendars.get('work')!.objects.get(url)!.data).toContain('Whole series');
    expect(fake.urls('work')).toEqual([url]);
  });

  it('takes back a create and a delete as well', async () => {
    const { fake, state, calendar, titles, BackendError, sync } = await boot();
    fake.addCalendar('work');
    const gone = fake.seed('work', 'gone', ics('gone', 'Deleted first'));
    await sync();
    const cal = calendar('work');
    let puts = 0;
    fake.before = (call) => {
      if (call.startsWith('putObject create') && ++puts === 2) throw new BackendError('other', 'Refused');
    };
    await expect(
      state().applyOps([
        { type: 'delete', url: gone, etag: '"1"' },
        { type: 'create', calendarId: cal.id, uid: 'one', data: ics('one', 'Created first') },
        { type: 'create', calendarId: cal.id, uid: 'two', data: ics('two', 'Fails') },
      ]),
    ).rejects.toThrow('Refused');
    expect(titles('work')).toEqual(['Deleted first']);
    expect(fake.urls('work')).toEqual([gone]);
  });
});

describe('moving an item between calendars', () => {
  it('copies, then deletes the original', async () => {
    const { fake, state, calendar, titles, sync } = await boot();
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Moving'));
    await sync();
    await state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x');
    expect(titles('a')).toEqual([]);
    expect(titles('b')).toEqual(['Moved']);
    expect(fake.calls.filter((c) => /Object /.test(c))).toEqual(['putObject create fake://b/x.ics', `deleteObject ${url} "1"`]);
  });

  it('deletes first when the server allows a UID only once', async () => {
    const { fake, state, calendar, titles, sync } = await boot({ uniqueUids: true });
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Moving'));
    await sync();
    await state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x');
    expect(titles('a')).toEqual([]);
    expect(titles('b')).toEqual(['Moved']);
    expect(fake.calls.filter((c) => /Object /.test(c))).toEqual(['putObject create fake://b/x.ics', `deleteObject ${url} "1"`, 'putObject create fake://b/x.ics']);
  });

  it('puts the original back when the copy still fails after that', async () => {
    const { fake, state, calendar, titles, BackendError, sync } = await boot({ uniqueUids: true });
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Stays'));
    await sync();
    let tries = 0;
    fake.before = (call) => {
      if (call === 'putObject create fake://b/x.ics' && ++tries === 2) throw new BackendError('forbidden', 'Not allowed', { status: 403 });
    };
    await expect(state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x')).rejects.toThrow('Not allowed');
    expect(titles('a')).toEqual(['Stays']);
    expect(titles('b')).toEqual([]);
  });

  it('does not delete anything because a refusal merely mentions "uid"', async () => {
    const { fake, state, calendar, titles, BackendError, sync } = await boot();
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Stays'));
    await sync();
    // The message of a DAV error quotes the request URL; this one has "uid" in its path.
    fake.before = (call) => {
      if (call.startsWith('putObject create')) throw new BackendError('forbidden', 'Access denied (PUT https://dav.example.com/uid-1234/b/x.ics)', { status: 403 });
    };
    await expect(state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x')).rejects.toThrow('Access denied');
    expect(fake.calls.some((c) => c.startsWith('deleteObject'))).toBe(false);
    expect(titles('a')).toEqual(['Stays']);
    expect(fake.urls('a')).toEqual([url]);
  });

  it('removes the copy again when the original cannot be deleted', async () => {
    const { fake, state, calendar, titles, BackendError, sync } = await boot();
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Stays'));
    await sync();
    fake.before = (call) => {
      if (call.startsWith(`deleteObject ${url}`)) throw new BackendError('forbidden', 'Read-only', { status: 403 });
    };
    await expect(state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x')).rejects.toThrow('Read-only');
    expect(titles('a')).toEqual(['Stays']);
    expect(titles('b')).toEqual([]);
    expect(fake.urls('b')).toEqual([]);
  });
});

describe('calendars', () => {
  it('creates one on the backend and finds it by its remote id', async () => {
    const { fake, state } = await boot({ storesView: true });
    const cal = await state().createCalendar(USER, { name: 'Trips', color: '#ec9607', components: ['VEVENT'], visible: false, order: 3 });
    expect(cal).toMatchObject({ id: `${USER}|cal-1`, remoteId: 'cal-1', name: 'Trips', color: '#ec9607', visible: false, order: 3 });
    expect(fake.calendars.get('cal-1')!.info).toMatchObject({ displayName: 'Trips', visible: false, order: 3 });
    expect(state().objects[cal.id]).toEqual({});
  });

  it('finds it even when a sync was already running when it was created', async () => {
    const { fake, state, sync } = await boot();
    const held = gate();
    fake.before = (call) => (call === 'listCalendars' && fake.calls.filter((c) => c === 'listCalendars').length === 1 ? held.wait : undefined);
    const running = sync();
    const creating = state().createCalendar(USER, { name: 'Trips', color: '#ec9607', components: ['VEVENT'] });
    await vi.waitFor(() => expect(fake.calls).toContain('createCalendar Trips'));
    held.open();
    await running;
    expect((await creating).name).toBe('Trips');
  });

  it('keeps visibility and order on the device when the backend does not store them', async () => {
    const { state } = await boot();
    const cal = await state().createCalendar(USER, { name: 'Trips', color: '#ec9607', components: ['VEVENT'], visible: false, order: 3 });
    expect(cal).toMatchObject({ visible: false, order: 3 });
    expect(state().calendars.find((c) => c.id === cal.id)).toMatchObject({ visible: false, order: 3 });
  });

  it('renames and deletes through the backend', async () => {
    const { fake, state, storage, sync } = await boot();
    fake.addCalendar('work');
    fake.seed('work', 'a', ics('a'));
    await sync();
    const id = `${USER}|work`;
    await state().updateCalendar(id, { name: 'Office', color: '#112233' });
    expect(fake.calendars.get('work')!.info).toMatchObject({ displayName: 'Office', color: '#112233' });
    expect(state().calendars.find((c) => c.id === id)).toMatchObject({ name: 'Office', color: '#112233' });

    await state().deleteCalendar(id);
    expect(fake.calendars.has('work')).toBe(false);
    expect(state().calendars.some((c) => c.id === id)).toBe(false);
    expect(state().objects[id]).toBeUndefined();
    expect(await storage.loadObjects(id)).toEqual([]);
  });

  it('creates local calendars without a server', async () => {
    const { state, LOCAL_ACCOUNT_ID } = await boot({ account: false });
    const cal = await state().createCalendar(LOCAL_ACCOUNT_ID, { name: 'Notes', color: '#112233', components: ['VTODO'] });
    expect(cal.id).toBe(`local|${cal.remoteId}`);
    expect(cal.remoteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state().objects[cal.id]).toEqual({});
  });
});

describe('first start and local defaults', () => {
  it('creates the local account but no calendars', async () => {
    const { state } = await boot({ account: false });
    expect(state().hydrated).toBe(true);
    expect(state().accounts).toEqual([{ id: 'local', kind: 'local', name: 'On this device', useProxy: false }]);
    expect(state().calendars).toEqual([]);
  });

  it('adds a calendar and a task list when asked, once', async () => {
    const { state } = await boot({ account: false });
    await state().setupLocalDefaults();
    expect(state().calendars).toMatchObject([
      { id: 'local|personal', remoteId: 'personal', accountId: 'local', components: ['VEVENT'], readOnly: false, visible: true },
      { id: 'local|tasks', remoteId: 'tasks', accountId: 'local', components: ['VTODO'], readOnly: false, visible: true },
    ]);
    expect(state().calendars.map((c) => c.name)).toEqual(['My calendar', 'My tasks']);
    expect(state().objects['local|personal']).toEqual({});
    await state().setupLocalDefaults();
    expect(state().calendars).toHaveLength(2);
  });

  it('does not bring them back after the user moved away from local storage', async () => {
    const first = await boot({ account: false });
    await first.state().setupLocalDefaults();
    await first.state().deleteCalendar('local|personal');
    await first.state().deleteCalendar('local|tasks');

    const second = await boot({ account: false });
    expect(second.state().accounts.map((a) => a.id)).toEqual(['local']);
    expect(second.state().calendars).toEqual([]);
  });

  it('adds only what is missing', async () => {
    const { state, LOCAL_ACCOUNT_ID } = await boot({ account: false });
    await state().createCalendar(LOCAL_ACCOUNT_ID, { name: 'Mine', color: '#112233', components: ['VEVENT'] });
    await state().setupLocalDefaults();
    expect(state().calendars.map((c) => c.name).sort()).toEqual(['Mine', 'My tasks']);
  });

  it('gives back events that are still stored under the well-known ids', async () => {
    const first = await boot({ account: false });
    await first.state().setupLocalDefaults();
    await first.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'kept', data: ics('kept', 'Kept') }]);

    // The list of calendars is lost, the events are not.
    localStorage.clear();
    const second = await boot({ account: false });
    expect(second.state().calendars).toEqual([]);
    await second.state().setupLocalDefaults();
    expect(Object.values(second.state().objects['local|personal']).map((o) => o.data)).toEqual([expect.stringContaining('Kept')]);
  });

  it('loads what is stored and is safe to call twice', async () => {
    const first = await boot({ account: false });
    await first.state().setupLocalDefaults();
    await first.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'a', data: ics('a', 'Stored') }]);

    const second = await boot({ account: false });
    expect(second.state().init()).toBe(second.state().init());
    await second.state().init();
    expect(Object.values(second.state().objects['local|personal'])).toHaveLength(1);
    expect(second.state().calendars.map((c) => c.id)).toEqual(['local|personal', 'local|tasks']);
  });

  it('names the default account after the storage that was chosen', async () => {
    const { defaultAccountId, useApp, state } = await boot();
    expect(defaultAccountId()).toBe('local');
    useApp.getState().setOnboarded('caldav');
    expect(defaultAccountId()).toBe(USER);
    useApp.getState().setStorageMode('local');
    expect(defaultAccountId()).toBe('local');
    useApp.getState().setStorageMode('caldav');
    await state().removeAccount(USER);
    // No such account: the device it is.
    expect(defaultAccountId()).toBe('local');
  });
});

describe('local calendars on disk', () => {
  it('has the write on disk when applyOps resolves', async () => {
    const { state, storage } = await boot({ account: false });
    await state().setupLocalDefaults();
    await state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'a', data: ics('a', 'Durable') }]);
    // No waiting here: resolved means stored.
    expect((await storage.loadObjects('local|personal'))?.map((o) => o.data)).toEqual([expect.stringContaining('Durable')]);
  });

  it('reports a write that could not be stored and does not pretend it happened', async () => {
    vi.doMock('@/lib/storage', async (original) => {
      const real = await original<typeof import('@/lib/storage')>();
      return { ...real, saveObjects: vi.fn(async () => Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))) };
    });
    const { state } = await boot({ account: false });
    await state().setupLocalDefaults();
    await expect(state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'a', data: ics('a') }])).rejects.toThrow(/storage may be full/);
    expect(state().objects['local|personal']).toEqual({});
    await expect(state().importObjects('local|personal', [{ uid: 'b', data: ics('b') }])).rejects.toThrow(/storage may be full/);
    expect(state().objects['local|personal']).toEqual({});
  });

  it('does not write over a calendar whose stored data could not be read', async () => {
    const first = await boot({ account: false });
    await first.state().setupLocalDefaults();
    await first.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'a', data: ics('a', 'Precious') }]);

    const saved: string[] = [];
    vi.doMock('@/lib/storage', async (original) => {
      const real = await original<typeof import('@/lib/storage')>();
      return {
        ...real,
        loadObjects: vi.fn(async (id: string) => (id === 'local|personal' ? null : real.loadObjects(id))),
        saveObjects: vi.fn(async (id: string, objects: never[]) => {
          saved.push(id);
          return real.saveObjects(id, objects);
        }),
      };
    });
    const second = await boot({ account: false });
    expect(second.state().hydrated).toBe(true);
    await expect(second.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'b', data: ics('b') }])).rejects.toThrow(/could not be read/);
    await expect(second.state().importObjects('local|personal', [{ uid: 'b', data: ics('b') }])).rejects.toThrow(/could not be read/);
    expect(saved).not.toContain('local|personal');
    // Other calendars are not affected.
    await second.state().applyOps([{ type: 'create', calendarId: 'local|tasks', uid: 't', data: createTaskIcs(emptyTask({ title: 'Works' })) }]);
  });

  it('treats stored data it cannot make sense of like data it cannot read', async () => {
    const first = await boot({ account: false });
    await first.state().setupLocalDefaults();
    await first.storage.saveObjects('local|personal', 'not a list' as never);

    const second = await boot({ account: false });
    expect(second.state().hydrated).toBe(true);
    expect(second.state().objects['local|personal']).toBeUndefined();
    await expect(second.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'b', data: ics('b') }])).rejects.toThrow(/could not be read/);
    expect(await second.storage.loadObjects('local|personal')).toBe('not a list');
  });

  it('generates a holiday calendar again when its stored copy is missing', async () => {
    const first = await boot({ account: false });
    const cal = first.state().addHolidayCalendar({ country: 'PL', name: 'Święta', color: '#2d772a' });
    await vi.waitFor(async () => expect((await first.storage.loadObjects(cal.id))!.length).toBeGreaterThan(50));
    await first.storage.saveObjects(cal.id, 'not a list' as never);

    const second = await boot({ account: false });
    expect(Object.keys(second.state().objects[cal.id]).length).toBeGreaterThan(50);
    await vi.waitFor(async () => expect(Array.isArray(await second.storage.loadObjects(cal.id))).toBe(true));
  });

  it('survives a failing delete in storage', async () => {
    vi.doMock('idb-keyval', async (original) => {
      const real = await original<typeof import('idb-keyval')>();
      return { ...real, del: vi.fn(async () => Promise.reject(new Error('disk on fire'))), delMany: vi.fn(async () => Promise.reject(new Error('disk on fire'))) };
    });
    try {
      const { fake, state, sync } = await boot();
      fake.addCalendar('work');
      await sync();
      await expect(state().deleteCalendar(`${USER}|work`)).resolves.toBeUndefined();
      expect(state().calendars.some((c) => c.accountId === USER)).toBe(false);
      await expect(state().removeAccount(USER)).resolves.toBeUndefined();
    } finally {
      vi.doUnmock('idb-keyval');
    }
  });
});

describe('importing', () => {
  const many = (n: number, prefix = 'item') => Array.from({ length: n }, (_, i) => ({ uid: `${prefix}-${i}`, data: ics(`${prefix}-${i}`) }));

  it('uses the bulk call in batches, with one store update per batch', async () => {
    const { fake, state, calendar, storage, sync } = await boot({ bulk: true });
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');
    const progress: [number, number][] = [];
    const before = state().revision;

    const n = await state().importObjects(cal.id, many(250), { onProgress: (done, total) => progress.push([done, total]) });

    expect(n).toBe(250);
    expect(fake.calls.filter((c) => c.startsWith('put'))).toEqual(['putObjects work 100', 'putObjects work 100', 'putObjects work 50']);
    expect(Object.keys(state().objects[cal.id])).toHaveLength(250);
    expect(state().revision - before).toBe(3);
    expect(progress.at(-1)).toEqual([250, 250]);
    expect(progress.every(([done, total], i) => total === 250 && done >= (progress[i - 1]?.[0] ?? 0))).toBe(true);
    expect(progress.length).toBeGreaterThan(3);
    await vi.waitFor(async () => expect(await storage.loadObjects(cal.id)).toHaveLength(250));
  });

  it('writes one by one, a few at a time, where there is no bulk call', async () => {
    const { fake, state, calendar, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');
    let inFlight = 0;
    let most = 0;
    fake.before = async (call) => {
      if (!call.startsWith('putObject')) return;
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    };
    const progress: number[] = [];
    const before = state().revision;
    const n = await state().importObjects(cal.id, many(60), { onProgress: (done) => progress.push(done) });
    expect(n).toBe(60);
    expect(fake.urls('work')).toHaveLength(60);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
    expect(progress).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    // 60 items in chunks of 24.
    expect(state().revision - before).toBe(3);
  });

  it('replaces an item the calendar already has under the same UID', async () => {
    const { fake, state, calendar, titles, sync } = await boot({ bulk: true });
    fake.addCalendar('work');
    // Created by another client, under a name of its choosing.
    const stored = fake.calendars.get('work')!;
    stored.objects.set('fake://work/SERVER-NAMED.ics', { etag: '"x"', data: ics('known', 'Old') });
    await sync();
    const n = await state().importObjects(calendar('work').id, [
      { uid: 'known', data: ics('known', 'New') },
      { uid: 'fresh', data: ics('fresh', 'Fresh') },
    ]);
    expect(n).toBe(2);
    expect(titles('work')).toEqual(['Fresh', 'New']);
    expect(fake.urls('work')).toEqual(['fake://work/SERVER-NAMED.ics', 'fake://work/fresh.ics']);
  });

  it('is repeatable: items that reached the server without reaching the store are replaced', async () => {
    const { fake, state, calendar, titles, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    // An earlier import got this far before the connection dropped.
    fake.seed('work', 'item-0', ics('item-0', 'Half imported'));
    const n = await state().importObjects(calendar('work').id, many(3));
    expect(n).toBe(3);
    expect(titles('work')).toEqual(['item-0', 'item-1', 'item-2']);
    expect(fake.urls('work')).toHaveLength(3);
  });

  it('keeps what was stored before a failure and says how much that is', async () => {
    const { fake, state, calendar, ImportError, BackendError, sync } = await boot({ bulk: true });
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');
    let batches = 0;
    fake.before = (call) => {
      if (call.startsWith('putObjects') && ++batches === 2) throw new BackendError('network', 'Connection lost');
    };
    const failure = await state().importObjects(cal.id, many(250)).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ImportError);
    expect(failure).toMatchObject({ message: 'Connection lost', imported: 100, total: 250, cause: { code: 'network' } });
    expect(Object.keys(state().objects[cal.id])).toHaveLength(100);
  });

  it('stops at a failure in the one-by-one path too, keeping the items around it', async () => {
    const { fake, state, calendar, BackendError, sync } = await boot();
    fake.addCalendar('work');
    await sync();
    const cal = calendar('work');
    fake.before = (call) => {
      if (call === 'putObject create fake://work/item-30.ics') throw new BackendError('forbidden', 'Quota reached', { status: 403 });
    };
    const failure = (await state().importObjects(cal.id, many(60)).catch((err: unknown) => err)) as { imported: number };
    expect(failure).toMatchObject({ message: 'Quota reached', total: 60 });
    expect(failure.imported).toBeGreaterThanOrEqual(24);
    expect(failure.imported).toBeLessThan(60);
    expect(fake.calls.some((c) => c.includes('item-59'))).toBe(false);
    // Everything the server took is in the store.
    expect(Object.keys(state().objects[cal.id]).sort()).toEqual(fake.urls('work'));
  });

  it('stops when asked to', async () => {
    const { fake, state, calendar, sync } = await boot({ bulk: true });
    fake.addCalendar('work');
    await sync();
    const abort = new AbortController();
    fake.before = (call) => {
      if (call.startsWith('putObjects')) abort.abort();
    };
    await expect(state().importObjects(calendar('work').id, many(250), { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.urls('work')).toHaveLength(100);
  });

  it('refuses read-only calendars and imports the later of two items with one UID', async () => {
    const { fake, state, calendar, titles, sync } = await boot();
    fake.addCalendar('shared', { readOnly: true });
    fake.addCalendar('work');
    await sync();
    await expect(state().importObjects(calendar('shared').id, many(1))).rejects.toThrow(/read-only/);
    const n = await state().importObjects(calendar('work').id, [
      { uid: 'twice', data: ics('twice', 'First') },
      { uid: 'twice', data: ics('twice', 'Second') },
    ]);
    expect(n).toBe(1);
    expect(titles('work')).toEqual(['Second']);
  });

  it('imports into a local calendar in one step', async () => {
    const { state, storage } = await boot({ account: false });
    await state().setupLocalDefaults();
    const n = await state().importObjects('local|personal', many(30));
    expect(n).toBe(30);
    expect(await storage.loadObjects('local|personal')).toHaveLength(30);
  });
});

describe('a removed CalDAV account', () => {
  it('is wiped from memory and from disk when removed', async () => {
    const { fake, state, storage, sync } = await boot();
    await state().setupLocalDefaults();
    await state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'mine', data: ics('mine') }]);
    fake.addCalendar('work');
    fake.addCalendar('home');
    fake.seed('work', 'a', ics('a'));
    fake.seed('home', 'b', ics('b'));
    await sync();
    await vi.waitFor(async () => expect(await storage.loadObjects(`${USER}|home`)).toHaveLength(1));
    // Left behind by a calendar that is long gone.
    await storage.saveObjects(`${USER}|orphan`, [{ url: 'fake://orphan/x.ics', etag: '"1"', calendarId: `${USER}|orphan`, data: ics('x') }]);

    await state().removeAccount(USER);

    expect(state().accounts.map((a) => a.id)).toEqual(['local']);
    expect(state().calendars.map((c) => c.accountId)).toEqual(['local', 'local']);
    expect(Object.keys(state().objects).sort()).toEqual(['local|personal', 'local|tasks']);
    for (const id of ['work', 'home', 'orphan']) expect(await storage.loadObjects(`${USER}|${id}`)).toEqual([]);
    expect(await storage.loadObjects('local|personal')).toHaveLength(1);
    expect(JSON.stringify(persisted())).not.toContain(USER);
  });
});

describe('feed and holiday calendars', () => {
  it('are told apart from the ones the user writes to', async () => {
    const { state, isGeneratedCalendar } = await boot({ account: false });
    await state().setupLocalDefaults();
    const holidays = state().addHolidayCalendar({ country: 'PL', name: 'Święta', color: '#2d772a' });
    expect(holidays.remoteId).toMatch(/^holidays-PL-/);
    expect(holidays.id).toBe(`local|${holidays.remoteId}`);
    expect(state().calendars.filter(isGeneratedCalendar).map((c) => c.id)).toEqual([holidays.id]);
    expect(Object.keys(state().objects[holidays.id]).length).toBeGreaterThan(50);
    expect(holidays).toMatchObject({ name: 'Święta', color: '#2d772a', visible: true, order: 2, holidayCountry: 'PL', readOnly: true });
  });

});

describe('moving an item on a server that allows a UID once', () => {
  async function failingMove() {
    const app = await boot({ uniqueUids: true });
    const { fake, state, calendar, BackendError, sync } = app;
    fake.addCalendar('a');
    fake.addCalendar('b');
    const url = fake.seed('a', 'x', ics('x', 'Stays'));
    await sync();
    // The connection drops right after the original is deleted.
    let writes = 0;
    fake.before = (call) => {
      if (call.startsWith('putObject') && fake.urls('a').length === 0) throw new BackendError('network', ++writes === 1 ? 'Copy failed' : 'Restore failed');
    };
    await expect(state().moveObject(url, calendar('b').id, ics('x', 'Moved'), 'x')).rejects.toThrow('Copy failed');
    expect(fake.urls('a')).toEqual([]);
    expect(fake.urls('b')).toEqual([]);
    fake.before = undefined;
    return app;
  }

  it('puts the original back with the next sync when the copy and the restore both fail', async () => {
    const { titles, sync, fake } = await failingMove();
    await sync();
    await vi.waitFor(() => expect(titles('a')).toEqual(['Stays']));
    expect(fake.urls('a')).toHaveLength(1);
    // Only once.
    await sync();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.calls.filter((c) => c.startsWith('putObject create fake://a/'))).toHaveLength(2);
  });

  it('still knows what to put back after a restart', async () => {
    const first = await failingMove();
    const second = await boot({ uniqueUids: true });
    second.registerBackend('caldav', () => first.fake);
    await second.sync();
    await vi.waitFor(() => expect(second.titles('a')).toEqual(['Stays']));
  });

  it('does not keep what it was to put back once the account is removed', async () => {
    const { state, storage } = await failingMove();
    expect(await storage.loadObjects('pending-restore')).toHaveLength(1);
    await state().removeAccount(USER);
    expect(await storage.loadObjects('pending-restore')).toEqual([]);
  });

  it('does not put back what turned up in the other calendar after all', async () => {
    const { fake, titles, sync } = await failingMove();
    // The copy did reach the server; only its answer was lost.
    fake.seed('b', 'x', ics('x', 'Moved'));
    await sync();
    await new Promise((r) => setTimeout(r, 50));
    expect(titles('a')).toEqual([]);
    expect(titles('b')).toEqual(['Moved']);
  });
});

describe('a stored state with entries of the wrong shape', () => {
  it.each([
    ['accounts that are not a list', { accounts: {}, calendars: [] }],
    ['an account that is null', { accounts: [null], calendars: [null, { id: 'x' }] }],
  ])('still starts with %s', async (_, state) => {
    localStorage.setItem('calendar.data', JSON.stringify({ state, version: 2 }));
    const { state: data } = await boot({ account: false });
    expect(data().hydrated).toBe(true);
    expect(data().accounts.map((a) => a.id)).toEqual(['local']);
    expect(data().calendars).toEqual([]);
  });
});

describe('the store\'s own messages', () => {
  it('are in the user\'s language', async () => {
    const { fake, state, calendar, sync } = await boot();
    const { useSettings } = await import('@/store/settings');
    useSettings.getState().update({ language: 'pl' });
    fake.addCalendar('shared', { displayName: 'Wspólny', readOnly: true });
    fake.addCalendar('work');
    await sync();
    await expect(state().applyOps([{ type: 'create', calendarId: `${USER}|gone`, uid: 'x', data: ics('x') }])).rejects.toThrow('Nie znaleziono kalendarza. Mógł zostać usunięty.');
    const missing = 'Nie znaleziono elementu. Mógł zostać usunięty na serwerze.';
    await expect(state().applyOps([{ type: 'update', url: 'https://nowhere.example/x.ics', etag: '"1"', data: ics('x') }])).rejects.toThrow(missing);
    await expect(state().moveObject('https://nowhere.example/x.ics', calendar('work').id, ics('x'), 'x')).rejects.toThrow(missing);
    await expect(state().importObjects(calendar('shared').id, [{ uid: 'x', data: ics('x') }])).rejects.toThrow('„Wspólny” jest tylko do odczytu.');
    await expect(state().createCalendar('nobody', { name: 'X', color: '#112233', components: ['VEVENT'] })).rejects.toThrow('Tego konta nie ma już na tym urządzeniu.');
    // A server that takes the calendar but leaves it out of the listing.
    fake.before = (call) => {
      if (call === 'listCalendars') fake.calendars.delete('cal-1');
    };
    await expect(state().createCalendar(USER, { name: 'X', color: '#112233', components: ['VEVENT'] })).rejects.toThrow('Kalendarz został utworzony, ale serwer nie podaje go na liście.');
  });

  it('say what is wrong with a feed in the user\'s language', async () => {
    const { state } = await boot({ account: false });
    const { useSettings } = await import('@/store/settings');
    useSettings.getState().update({ language: 'pl' });
    const answer = (status: number, body: string, headers: Record<string, string> = {}) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'x-dav-proxy-relay': '1', ...headers } })));
    const subscribe = () => state().addSubscription({ url: 'https://feeds.example/a.ics', name: 'Feed', color: '#112233' });
    answer(404, 'Not found');
    await expect(subscribe()).rejects.toMatchObject({ status: 404, message: 'Nie udało się pobrać subskrybowanego kalendarza (HTTP 404).' });
    answer(200, '<html>A page</html>');
    await expect(subscribe()).rejects.toThrow('Pod tym adresem nie ma pliku iCalendar (.ics).');
    answer(302, '', { 'x-dav-location': 'https://feeds.example/b.ics' });
    await expect(subscribe()).rejects.toThrow('Serwer przekierowywał zbyt wiele razy.');
    expect(state().calendars.filter((c) => c.subscriptionUrl)).toEqual([]);
  });
});

describe('the calendar and task list new items go to', () => {
  /** A CalDAV account served by the test's fake backend, as `addCalDavAccount` leaves it before its first sync. */
  const DAV = { id: 'dav1', kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };

  async function withServer() {
    const b = await boot({ account: false });
    const { useSettings } = await import('./settings');
    b.registerBackend('caldav', () => b.fake);
    b.fake.addCalendar('shared', { displayName: 'Shared', readOnly: true, order: 0 });
    b.fake.addCalendar('hidden', { displayName: 'Hidden', visible: false, order: 1 });
    b.fake.addCalendar('work', { displayName: 'Work', order: 2 });
    b.fake.addCalendar('home', { displayName: 'Home', order: 3 });
    b.fake.addCalendar('todo', { displayName: 'To do', components: ['VTODO'], order: 4 });
    const addServer = async () => {
      b.useData.setState((s) => ({ accounts: [...s.accounts, DAV] }));
      await b.state().syncAccount(DAV.id);
    };
    const defaults = () => {
      const { defaultCalendarId, defaultTaskListId } = useSettings.getState();
      return { defaultCalendarId, defaultTaskListId };
    };
    return { ...b, useSettings, addServer, defaults };
  }

  it('are named after a welcome screen that chose a CalDAV server: its first visible, writable ones', async () => {
    const b = await withServer();
    await b.addServer();
    // The welcome screen is still up (its form adds the account first): nothing is chosen yet.
    expect(b.defaults()).toEqual({ defaultCalendarId: undefined, defaultTaskListId: undefined });

    b.useApp.getState().setOnboarded('caldav');
    b.fillDefaultCalendars();
    expect(b.defaults()).toEqual({ defaultCalendarId: b.calendar('work').id, defaultTaskListId: b.calendar('todo').id });
  });

  it('are named after a welcome screen that chose this device', async () => {
    const b = await withServer();
    b.useApp.getState().setOnboarded('local');
    await b.state().setupLocalDefaults();
    expect(b.defaults()).toEqual({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
  });

  it('are named when the first account comes, from the place new calendars go to', async () => {
    const b = await withServer();
    b.useApp.getState().setOnboarded('local');
    await b.state().setupLocalDefaults();
    // An install from before they were named.
    b.useSettings.getState().update({ defaultCalendarId: undefined, defaultTaskListId: undefined });
    await b.addServer();
    expect(b.defaults()).toEqual({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
  });

  it('are named from the first account when that is where calendars are kept', async () => {
    // The server is the storage, but its account was removed and is added again.
    const b = await withServer();
    b.useApp.getState().setOnboarded('caldav');
    await b.addServer();
    expect(b.defaults()).toEqual({ defaultCalendarId: b.calendar('work').id, defaultTaskListId: b.calendar('todo').id });
  });

  it('leave a calendar or list that is named already', async () => {
    const b = await withServer();
    b.useApp.getState().setOnboarded('caldav');
    b.useSettings.getState().update({ defaultCalendarId: 'dav1|home' });
    await b.addServer();
    expect(b.defaults()).toEqual({ defaultCalendarId: 'dav1|home', defaultTaskListId: b.calendar('todo').id });
    // Listed again, nothing changes.
    b.useSettings.getState().update({ defaultTaskListId: undefined });
    await b.state().syncAccount(DAV.id);
    expect(b.defaults().defaultTaskListId).toBeUndefined();
  });
});

describe('what a failed sync leaves on the account', () => {
  const DAV = { id: 'dav1', kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };

  /** A CalDAV account served by the test's fake backend. */
  async function withServer() {
    const b = await boot({ account: false });
    b.registerBackend('caldav', () => b.fake);
    b.fake.addCalendar('work', { displayName: 'Work' });
    b.fake.addCalendar('home', { displayName: 'Home' });
    b.useData.setState((s) => ({ accounts: [...s.accounts, DAV] }));
    const dav = () => b.state().accounts.find((a) => a.id === DAV.id)!;
    /** Every call of the fake whose name starts with `prefix` fails with `error`, until `fail()` is called without one. */
    const fail = (error?: unknown, prefix = 'listCalendars') => {
      b.fake.before = error
        ? (call) => {
            if (call.startsWith(prefix)) throw error;
          }
        : undefined;
    };
    return { ...b, dav, fail };
  }

  it('is the kind of the failure next to its text, kept between starts, and gone after a sync that went through', async () => {
    const b = await withServer();
    b.fail(new b.BackendError('network', 'Server down'));
    await expect(b.state().syncAccount(DAV.id)).rejects.toMatchObject({ code: 'network' });
    expect(b.dav()).toMatchObject({ error: 'Server down', errorCode: 'network' });
    expect(persisted().state.accounts.find((a: { id: string }) => a.id === DAV.id)).toMatchObject({ error: 'Server down', errorCode: 'network' });

    // The next start still knows what it was.
    vi.resetModules();
    const again = await import('./data');
    await again.useData.getState().init();
    expect(again.useData.getState().accounts.find((a) => a.id === DAV.id)).toMatchObject({ errorCode: 'network' });

    b.fail();
    await b.state().syncAccount(DAV.id);
    expect(b.dav().error).toBeUndefined();
    expect(b.dav().errorCode).toBeUndefined();
  });

  it('says "auth" for a refused password, which a new password clears', async () => {
    const b = await withServer();
    b.fail(new b.BackendError('auth', 'Wrong password', { status: 401 }));
    await expect(b.state().syncAccount(DAV.id)).rejects.toMatchObject({ code: 'auth' });
    expect(b.dav().errorCode).toBe('auth');
    await b.state().setAccountPassword(DAV.id, 'new secret');
    expect(b.dav().error).toBeUndefined();
    expect(b.dav().errorCode).toBeUndefined();
  });

  it('says "other" for a failure that is not a backend\'s', async () => {
    const b = await withServer();
    b.fail(new TypeError('Something broke'));
    await expect(b.state().syncAccount(DAV.id)).rejects.toThrow('Something broke');
    expect(b.dav()).toMatchObject({ error: 'Something broke', errorCode: 'other' });
  });

  it('is the kind of the first calendar that could not be brought up to date, when the others could', async () => {
    const b = await withServer();
    await b.state().syncAccount(DAV.id);
    b.fake.seed('home', 'a', ics('a'));
    b.fail(new b.BackendError('rate-limit', 'Slow down'), 'changesSince home');
    await b.state().syncAccount(DAV.id);
    expect(b.dav()).toMatchObject({ errorCode: 'rate-limit' });
    expect(b.dav().error).toContain('Slow down');
    b.fail();
    await b.state().syncAccount(DAV.id);
    expect(b.dav().errorCode).toBeUndefined();
  });
});

describe('a change of a calendar that its server did not take', () => {
  it('stays on the device and is reported, with a retry that sends what the calendar shows by then', async () => {
    const { fake, state, sync, onCalendarPatchFailure } = await boot({ storesView: true });
    fake.addCalendar('work', { visible: true, order: 0 });
    await sync();
    const id = `${USER}|work`;
    const failures: import('./data').CalendarPatchFailure[] = [];
    const off = onCalendarPatchFailure((failure) => failures.push(failure));
    fake.before = (call) => {
      if (call.startsWith('updateCalendar')) throw new Error('Server down');
    };
    state().setCalendarVisible(id, false);
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]).toMatchObject({ patch: { visible: false }, calendar: { id }, error: expect.objectContaining({ message: 'Server down' }) });
    expect(state().calendars.find((c) => c.id === id)!.visible).toBe(false);
    expect(fake.calendars.get('work')!.info.visible).toBe(true);

    fake.before = undefined;
    failures[0].retry();
    await vi.waitFor(() => expect(fake.calendars.get('work')!.info.visible).toBe(false));

    // Shown again since: a late retry of the old change sends what is shown now.
    state().setCalendarVisible(id, true);
    await vi.waitFor(() => expect(fake.calendars.get('work')!.info.visible).toBe(true));
    failures[0].retry();
    await vi.waitFor(() => expect(fake.calls.filter((c) => c === 'updateCalendar work visible')).toHaveLength(4));
    expect(fake.calendars.get('work')!.info.visible).toBe(true);

    off();
    fake.before = (call) => {
      if (call.startsWith('updateCalendar')) throw new Error('Server down');
    };
    state().setCalendarVisible(id, false);
    await vi.waitFor(() => expect(fake.calls.filter((c) => c === 'updateCalendar work visible')).toHaveLength(5));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failures).toHaveLength(1);
  });
});
