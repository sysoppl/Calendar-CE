// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeBackendOptions } from '@/lib/backend/fake';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';

// Every test starts the store from fresh modules; the first start of a run
// also compiles them, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const SERVER = 'user1';
/** The CalDAV account the tests move to and from, served by the test's fake backend. */
const SERVER_ACCOUNT = { id: SERVER, kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };
const LOCAL = 'local';

function event(uid: string, title = uid): string {
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

function task(uid: string, title = uid): string {
  return createTaskIcs({ ...emptyTask({ title }), uid });
}

/** The app starting over whatever localStorage and IndexedDB hold, with a fake server behind the CalDAV account. */
async function boot(options: FakeBackendOptions = { bulk: true, storesView: true }) {
  vi.resetModules();
  const { useData } = await import('@/store/data');
  const { useSettings } = await import('@/store/settings');
  const backends = await import('@/lib/backend');
  const migrate = await import('./migrate');
  const { FakeBackend } = await import('@/lib/backend/fake');
  const fake = new FakeBackend(options);
  // Every CalDAV account talks to the fake: nothing here reaches the network.
  backends.registerBackend('caldav', () => fake);
  await useData.getState().init();
  useData.setState((s) => ({ accounts: [...s.accounts.filter((a) => a.id !== SERVER), SERVER_ACCOUNT] }));
  const state = () => useData.getState();
  const calendars = (accountId: string) => state().calendars.filter((c) => c.accountId === accountId);
  const titles = (calendarId: string) =>
    Object.values(state().objects[calendarId] ?? {})
      .map((o) => /^SUMMARY:(.*)$/m.exec(o.data)?.[1].trim())
      .sort();
  return { ...migrate, ...backends, useData, useSettings, fake, state, calendars, titles };
}

type App = Awaited<ReturnType<typeof boot>>;

/** A device with a calendar, a task list, a renamed extra calendar and a holiday calendar. */
async function localData(app: App) {
  const { state } = app;
  await state().setupLocalDefaults();
  const extra = await state().createCalendar(LOCAL, { name: 'Trips', color: '#ec9607', components: ['VEVENT'], description: 'Where to next' });
  state().setCalendarVisible(extra.id, false);
  const holidays = state().addHolidayCalendar({ country: 'PL', name: 'Święta', color: '#2d772a' });
  await state().applyOps([
    { type: 'create', calendarId: 'local|personal', uid: 'e1', data: event('e1', 'Dentist') },
    { type: 'create', calendarId: 'local|personal', uid: 'e2', data: event('e2', 'Lunch') },
    { type: 'create', calendarId: 'local|tasks', uid: 't1', data: task('t1', 'Invoice') },
    { type: 'create', calendarId: extra.id, uid: 'e3', data: event('e3', 'Lisbon') },
  ]);
  return { extra, holidays };
}

const journal = () => JSON.parse(localStorage.getItem('calendar.migration') ?? 'null');

/** Makes the next start fail to read a calendar's stored items, as a failed IndexedDB read does. */
function mockUnreadable(calendarId: string) {
  vi.doMock('@/lib/storage', async (original) => {
    const real = await original<typeof import('@/lib/storage')>();
    return { ...real, loadObjects: vi.fn(async (id: string) => (id === calendarId ? null : real.loadObjects(id))) };
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock('@/lib/storage');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('planMigration', () => {
  it('lists the calendars that would move and the ones that stay', async () => {
    const app = await boot();
    const { extra, holidays } = await localData(app);
    expect(app.planMigration(LOCAL, SERVER)).toEqual({
      sourceAccountId: LOCAL,
      targetAccountId: SERVER,
      calendars: [
        { id: 'local|personal', name: 'My calendar', items: 2, readOnly: false },
        { id: 'local|tasks', name: 'My tasks', items: 1, readOnly: false },
        { id: extra.id, name: 'Trips', items: 1, readOnly: false },
      ],
      generated: [{ id: holidays.id, name: 'Święta' }],
      items: 4,
      resumes: false,
    });
  });

  it('needs two different accounts that exist, and says so in the language of the app', async () => {
    const app = await boot();
    app.useSettings.getState().update({ language: 'en' });
    expect(() => app.planMigration(LOCAL, LOCAL)).toThrow('The data is already there.');
    expect(() => app.planMigration(LOCAL, 'nobody')).toThrow('One of the two places is no longer connected.');
    app.useSettings.getState().update({ language: 'pl' });
    expect(() => app.planMigration(LOCAL, 'nobody')).toThrow('Jedno z tych dwóch miejsc nie jest już połączone.');
  });

  it('marks a calendar whose items could not be read from the device', async () => {
    const first = await boot();
    await localData(first);
    mockUnreadable('local|personal');
    const app = await boot();
    expect(app.planMigration(LOCAL, SERVER).calendars[0]).toEqual({ id: 'local|personal', name: 'My calendar', items: 0, readOnly: false, unreadable: true });
  });
});

describe('from this device to a server', () => {
  it('copies every calendar with its settings and leaves the source alone', async () => {
    const app = await boot();
    const { state, fake, calendars, titles } = app;
    const { extra, holidays } = await localData(app);
    const phases: string[] = [];
    const seen: [number, number][] = [];

    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), {
      onProgress: (p) => {
        if (phases.at(-1) !== p.phase) phases.push(p.phase);
        seen.push([p.done, p.total]);
      },
    });

    expect(result).toMatchObject({ copied: 4, present: 0, unreadable: 0, complete: true, sourceEmpty: false, generated: [{ id: holidays.id, name: 'Święta' }] });
    expect(result.calendars.map((c) => [c.name, c.copied, c.verified, c.deleted])).toEqual([
      ['My calendar', 2, true, false],
      ['My tasks', 1, true, false],
      ['Trips', 1, true, false],
    ]);
    expect(phases).toEqual(['prepare', 'copy', 'verify', 'done']);
    expect(seen.at(-1)).toEqual([4, 4]);
    expect(seen.every(([done, total], i) => total === 4 && done >= (seen[i - 1]?.[0] ?? 0))).toBe(true);

    const copies = calendars(SERVER);
    expect(copies.map((c) => ({ name: c.name, color: c.color, components: c.components, description: c.description, visible: c.visible, order: c.order }))).toEqual(
      ['local|personal', 'local|tasks', extra.id].map((id) => {
        const c = state().calendars.find((x) => x.id === id)!;
        return { name: c.name, color: c.color, components: c.components, description: c.description, visible: c.visible, order: c.order };
      }),
    );
    expect(copies[2]).toMatchObject({ name: 'Trips', visible: false, description: 'Where to next' });
    expect(fake.calendars.get(copies[2].remoteId!)!.info).toMatchObject({ visible: false, order: extra.order });
    expect(titles(copies[0].id)).toEqual(['Dentist', 'Lunch']);
    expect(titles(copies[1].id)).toEqual(['Invoice']);
    expect(titles(copies[2].id)).toEqual(['Lisbon']);

    // The holiday calendar was not copied, and nothing was taken away.
    expect(copies).toHaveLength(3);
    expect(calendars(LOCAL)).toHaveLength(4);
    expect(titles('local|personal')).toEqual(['Dentist', 'Lunch']);
    expect(fake.calls.some((c) => c.startsWith('deleteCalendar'))).toBe(false);
    expect(journal()).toBeNull();
    expect(app.pendingMigration()).toBeNull();
  });

  it('moves the default calendar and task list along with a move', async () => {
    const app = await boot();
    await localData(app);
    app.useSettings.getState().update({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    const target = (id: string) => result.calendars.find((c) => c.sourceId === id)!.targetId;
    expect(app.useSettings.getState()).toMatchObject({ defaultCalendarId: target('local|personal'), defaultTaskListId: target('local|tasks') });
    expect(target('local|personal').startsWith(`${SERVER}|`)).toBe(true);
  });

  it('keeps the default calendar and task list where they were after a copy', async () => {
    const app = await boot();
    await localData(app);
    app.useSettings.getState().update({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
    await app.runMigration(app.planMigration(LOCAL, SERVER));
    expect(app.useSettings.getState()).toMatchObject({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
  });

  it('leaves a default alone that points somewhere else', async () => {
    const app = await boot();
    const { holidays } = await localData(app);
    app.useSettings.getState().update({ defaultCalendarId: holidays.id, defaultTaskListId: undefined });
    await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(app.useSettings.getState().defaultCalendarId).toBe(holidays.id);
    expect(app.useSettings.getState().defaultTaskListId).toBeUndefined();
  });

  it('removes the source afterwards when asked, and that sticks', async () => {
    const app = await boot();
    const { state, calendars, titles } = app;
    const { holidays } = await localData(app);
    const phases: string[] = [];

    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true, onProgress: (p) => phases.at(-1) !== p.phase && phases.push(p.phase) });

    expect(phases).toEqual(['prepare', 'copy', 'verify', 'delete', 'done']);
    expect(result).toMatchObject({ copied: 4, complete: true, sourceEmpty: true });
    expect(result.calendars.every((c) => c.deleted && !c.kept)).toBe(true);
    // Only the holiday calendar is left on the device.
    expect(calendars(LOCAL).map((c) => c.id)).toEqual([holidays.id]);
    expect(state().objects['local|personal']).toBeUndefined();
    expect(titles(result.calendars[0].targetId)).toEqual(['Dentist', 'Lunch']);

    // After a restart the device does not grow its default calendars back.
    const again = await boot();
    expect(again.calendars(LOCAL).map((c) => c.id)).toEqual([holidays.id]);
  });

  it('reuses an empty calendar of the same name and kind instead of making a twin', async () => {
    const app = await boot();
    const { fake, calendars, titles } = app;
    await localData(app);
    // What a new account on the server starts with.
    fake.addCalendar('mine', { displayName: 'My calendar', components: ['VEVENT'] });
    fake.addCalendar('todo', { displayName: 'my tasks ', components: ['VTODO'] });
    // Same name, but in use: not to be merged into.
    fake.addCalendar('trips', { displayName: 'Trips', components: ['VEVENT'] });
    fake.seed('trips', 'other', event('other', 'Somebody else'));

    const result = await app.runMigration(app.planMigration(LOCAL, SERVER));

    expect(result.calendars.map((c) => c.targetId)).toEqual([`${SERVER}|mine`, `${SERVER}|todo`, `${SERVER}|cal-1`]);
    expect(calendars(SERVER)).toHaveLength(4);
    expect(titles(`${SERVER}|mine`)).toEqual(['Dentist', 'Lunch']);
    expect(titles(`${SERVER}|trips`)).toEqual(['Somebody else']);
    expect(fake.calls.filter((c) => c.startsWith('createCalendar'))).toEqual(['createCalendar Trips']);
  });

  it('works without a bulk call', async () => {
    const app = await boot({});
    await localData(app);
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER));
    expect(result).toMatchObject({ copied: 4, complete: true });
    expect(app.fake.calls.filter((c) => c.startsWith('putObject create'))).toHaveLength(4);
  });
});

describe('from a server back to this device', () => {
  async function serverData(app: App) {
    const { fake, state } = app;
    fake.addCalendar('work', { displayName: 'Work', color: '#069c8d', components: ['VEVENT'], order: 4, visible: true });
    fake.addCalendar('todo', { displayName: 'Chores', color: '#112233', components: ['VTODO'], order: 5, visible: false });
    fake.addCalendar('team', { displayName: 'Team (shared)', color: '#445566', components: ['VEVENT'], order: 6, readOnly: true });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    fake.seed('work', 'w2', event('w2', 'Review'));
    fake.seed('todo', 'c1', task('c1', 'Bins'));
    fake.seed('team', 's1', event('s1', 'All hands'));
    await state().syncAccount(SERVER);
  }

  it('copies everything and removes from the server only what is ours to remove', async () => {
    const app = await boot();
    const { fake, calendars, titles } = app;
    await serverData(app);

    const result = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });

    expect(result).toMatchObject({ copied: 4, complete: true, sourceEmpty: false });
    expect(result.calendars.map((c) => [c.name, c.verified, c.deleted, c.kept])).toEqual([
      ['Work', true, true, undefined],
      ['Chores', true, true, undefined],
      ['Team (shared)', true, false, 'read-only'],
    ]);
    const local = calendars(LOCAL);
    expect(local.map((c) => [c.name, c.color, c.components, c.visible, c.order, c.readOnly])).toEqual([
      ['Work', '#069c8d', ['VEVENT'], true, 4, false],
      ['Chores', '#112233', ['VTODO'], false, 5, false],
      ['Team (shared)', '#445566', ['VEVENT'], true, 6, false],
    ]);
    expect(titles(local[0].id)).toEqual(['Review', 'Standup']);
    expect(titles(local[1].id)).toEqual(['Bins']);
    expect(titles(local[2].id)).toEqual(['All hands']);
    // The shared calendar is still on the server, the others are gone.
    expect([...fake.calendars.keys()]).toEqual(['team']);
    expect(fake.calls.filter((c) => c.startsWith('deleteCalendar'))).toEqual(['deleteCalendar work', 'deleteCalendar todo']);
    expect(calendars(SERVER).map((c) => c.remoteId)).toEqual(['team']);
    expect(journal()).toBeNull();
  });

  it('there and back again ends where it started', async () => {
    const app = await boot();
    const { state, calendars, titles } = app;
    await state().setupLocalDefaults();
    await state().applyOps([
      { type: 'create', calendarId: 'local|personal', uid: 'e1', data: event('e1', 'Dentist') },
      { type: 'create', calendarId: 'local|tasks', uid: 't1', data: task('t1', 'Invoice') },
    ]);
    const before = Object.values(state().objects['local|personal']).map((o) => o.data);

    const out = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(out).toMatchObject({ complete: true, sourceEmpty: true });
    expect(calendars(LOCAL)).toEqual([]);

    const back = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(back).toMatchObject({ copied: 2, complete: true, sourceEmpty: true });
    expect(calendars(SERVER)).toEqual([]);
    expect(app.fake.calendars.size).toBe(0);
    const local = calendars(LOCAL);
    expect(local.map((c) => [c.name, c.components])).toEqual([
      ['My calendar', ['VEVENT']],
      ['My tasks', ['VTODO']],
    ]);
    expect(titles(local[0].id)).toEqual(['Dentist']);
    expect(Object.values(state().objects[local[0].id]).map((o) => o.data)).toEqual(before);
    expect(titles(local[1].id)).toEqual(['Invoice']);
  });
});

describe('interruptions', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'create' as const, calendarId: 'local|personal', uid: `e${i}`, data: event(`e${i}`, `Event ${i}`) }));

  it('continues after a failure without duplicating calendars or items', async () => {
    const app = await boot();
    const { state, fake, BackendError } = app;
    await state().setupLocalDefaults();
    await state().applyOps(many(250));
    await state().applyOps([{ type: 'create', calendarId: 'local|tasks', uid: 't1', data: task('t1', 'Invoice') }]);

    let batches = 0;
    fake.before = (call) => {
      if (call.startsWith('putObjects') && ++batches === 2) throw new BackendError('network', 'Connection lost');
    };
    await expect(app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true })).rejects.toThrow('Connection lost');

    // Cut off in the first calendar: nothing is deleted, and the run is remembered.
    expect(fake.calls.some((c) => c.startsWith('deleteCalendar'))).toBe(false);
    expect(Object.keys(state().objects['local|personal'])).toHaveLength(250);
    expect(journal()).toMatchObject({ v: 1, sourceAccountId: LOCAL, targetAccountId: SERVER, deleteSource: true, calendars: { 'local|personal': `${SERVER}|cal-1` } });
    expect(JSON.stringify(journal())).not.toMatch(/BEGIN:VCALENDAR|password/);

    // The app is restarted before the user tries again.
    const next = await boot();
    for (const [id, stored] of fake.calendars) next.fake.calendars.set(id, stored);
    Object.assign(next.fake, { ids: 1, rev: 1000 });
    const pending = next.pendingMigration();
    expect(pending).toMatchObject({ sourceAccountId: LOCAL, targetAccountId: SERVER, deleteSource: true });
    const plan = next.planMigration(pending!.sourceAccountId, pending!.targetAccountId);
    expect(plan.resumes).toBe(true);

    const result = await next.runMigration(plan, { deleteSource: pending!.deleteSource });

    expect(result).toMatchObject({ copied: 151, present: 100, complete: true, sourceEmpty: true });
    expect(next.fake.calls.filter((c) => c.startsWith('createCalendar'))).toEqual(['createCalendar My tasks']);
    expect(next.calendars(SERVER).map((c) => c.name)).toEqual(['My calendar', 'My tasks']);
    expect(next.fake.urls('cal-1')).toHaveLength(250);
    expect(new Set(next.titles(`${SERVER}|cal-1`)).size).toBe(250);
    expect(next.calendars(LOCAL)).toEqual([]);
    expect(journal()).toBeNull();
  });

  it('adopts the calendar it made when it was cut off before it could write that down', async () => {
    const app = await boot();
    const { state, fake } = app;
    await state().setupLocalDefaults();
    await state().applyOps(many(3));
    // The calendar exists on the server; the journal never heard of it.
    fake.addCalendar('made-earlier', { displayName: 'My calendar', components: ['VEVENT'] });
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER));
    expect(result.calendars[0].targetId).toBe(`${SERVER}|made-earlier`);
    expect(fake.calls.filter((c) => c.startsWith('createCalendar'))).toEqual(['createCalendar My tasks']);
  });

  it('stops when asked to and can be continued', async () => {
    const app = await boot();
    const { state, fake } = app;
    await state().setupLocalDefaults();
    await state().applyOps(many(5));
    await state().applyOps([{ type: 'create', calendarId: 'local|tasks', uid: 't1', data: task('t1') }]);
    const abort = new AbortController();
    fake.before = (call) => {
      if (call.startsWith('putObjects')) abort.abort();
    };
    await expect(app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.calls.some((c) => c.startsWith('deleteCalendar'))).toBe(false);
    expect(state().calendars.filter((c) => c.accountId === LOCAL)).toHaveLength(2);
    expect(app.pendingMigration()).not.toBeNull();

    fake.before = undefined;
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(result).toMatchObject({ complete: true, sourceEmpty: true, copied: 1, present: 5 });
  });

  it('can be forgotten', async () => {
    const app = await boot();
    const { state, fake, BackendError } = app;
    await state().setupLocalDefaults();
    await state().applyOps(many(2));
    fake.before = (call) => {
      if (call.startsWith('putObjects')) throw new BackendError('network', 'Offline');
    };
    await expect(app.runMigration(app.planMigration(LOCAL, SERVER))).rejects.toThrow('Offline');
    expect(app.pendingMigration()).not.toBeNull();
    app.clearMigration();
    expect(app.pendingMigration()).toBeNull();
    expect(app.planMigration(LOCAL, SERVER).resumes).toBe(false);
  });

  it('forgets a run whose account is gone', async () => {
    const app = await boot();
    const { state, fake, BackendError } = app;
    await state().setupLocalDefaults();
    await state().applyOps(many(2));
    fake.before = (call) => {
      if (call.startsWith('putObjects')) throw new BackendError('network', 'Offline');
    };
    await expect(app.runMigration(app.planMigration(LOCAL, SERVER))).rejects.toThrow('Offline');
    await state().removeAccount(SERVER);
    expect(app.pendingMigration()).toBeNull();
  });
});

describe('nothing is deleted before it is verified', () => {
  it('syncs the target and looks for every item before the first delete', async () => {
    const app = await boot();
    const { fake } = app;
    await localData(app);
    await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    // Local deletes do not reach the server; the order is checked on a server source below.
    const lastWrite = fake.calls.findLastIndex((c) => c.startsWith('putObjects'));
    expect(fake.calls.slice(lastWrite).filter((c) => c === 'listCalendars')).toHaveLength(1);
  });

  it('keeps a calendar whose copy turned out incomplete, and finishes on the next run', async () => {
    const app = await boot();
    const { state, fake, calendars, titles } = app;
    await localData(app);
    // A server that says yes to everything and keeps all but one item.
    const real = fake.putObjects!;
    fake.putObjects = async (cal, items, onProgress) => {
      const stored = await real(cal, items, onProgress);
      const lost = stored.find((o) => o.data.includes('SUMMARY:Lunch'));
      if (lost) fake.remove(cal.remoteId!, lost.url);
      return stored;
    };

    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });

    expect(result.complete).toBe(false);
    expect(result.calendars.map((c) => [c.name, c.verified, c.deleted, c.kept])).toEqual([
      ['My calendar', false, false, 'unverified'],
      ['My tasks', true, true, undefined],
      ['Trips', true, true, undefined],
    ]);
    expect(titles('local|personal')).toEqual(['Dentist', 'Lunch']);
    expect(titles(result.calendars[0].targetId)).toEqual(['Dentist']);
    expect(calendars(LOCAL).filter((c) => !c.readOnly).map((c) => c.id)).toEqual(['local|personal']);
    expect(journal()).toMatchObject({ calendars: { 'local|personal': result.calendars[0].targetId } });
    // Deleted calendars keep their entries, so a stale copy of one finds its target again.
    expect(journal().calendars).toEqual(Object.fromEntries(result.calendars.map((c) => [c.sourceId, c.targetId])));

    fake.putObjects = real;
    const again = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(again).toMatchObject({ copied: 1, present: 1, complete: true, sourceEmpty: true });
    expect(titles(again.calendars[0].targetId)).toEqual(['Dentist', 'Lunch']);
    expect(state().calendars.some((c) => c.id === 'local|personal')).toBe(false);
    expect(journal()).toBeNull();
  });

  it('does not delete a server calendar that gained an item while it was being copied', async () => {
    const app = await boot();
    const { fake, state, titles } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    await state().syncAccount(SERVER);

    const plan = app.planMigration(SERVER, LOCAL);
    // Another device adds an event while this one is busy copying.
    const importObjects = state().importObjects;
    vi.spyOn(state(), 'importObjects').mockImplementation(async (...args) => {
      const n = await importObjects(...args);
      fake.seed('work', 'late', event('late', 'Added meanwhile'));
      return n;
    });
    app.useData.setState({ importObjects: state().importObjects });

    const result = await app.runMigration(plan, { deleteSource: true });

    expect(result).toMatchObject({ complete: false });
    expect(result.calendars[0]).toMatchObject({ verified: false, deleted: false, kept: 'unverified' });
    expect(fake.calendars.has('work')).toBe(true);
    expect(fake.calls.some((c) => c.startsWith('deleteCalendar'))).toBe(false);

    vi.restoreAllMocks();
    app.useData.setState({ importObjects });
    const again = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(again).toMatchObject({ copied: 1, present: 1, complete: true });
    expect(titles(again.calendars[0].targetId)).toEqual(['Added meanwhile', 'Standup']);
    expect(fake.calendars.has('work')).toBe(false);
  });

  it('refuses to start from a source that could not be synced completely', async () => {
    const app = await boot();
    const { fake, state, BackendError } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    await state().syncAccount(SERVER);
    fake.seed('work', 'w2', event('w2', 'Not downloaded'));
    fake.before = (call) => {
      if (call.startsWith('changesSince') || call.startsWith('listObjects')) throw new BackendError('other', 'HTTP 500');
    };
    await expect(app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true })).rejects.toThrow('Work: HTTP 500');
    expect(fake.calendars.has('work')).toBe(true);
    expect(state().calendars.filter((c) => c.accountId === LOCAL)).toEqual([]);
  });

  it('keeps a calendar with items it could not read, and says how many', async () => {
    const app = await boot();
    const { fake, state } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    fake.calendars.get('work')!.objects.set('fake://work/broken.ics', { etag: '"b"', data: 'this is not a calendar object' });
    await state().syncAccount(SERVER);

    const result = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(result).toMatchObject({ copied: 1, unreadable: 1, complete: true });
    expect(result.calendars[0]).toMatchObject({ verified: true, deleted: false, kept: 'unreadable', unreadable: 1 });
    expect(fake.calendars.has('work')).toBe(true);
    expect(journal()).toBeNull();
  });

  it('does not make empty twins of calendars it deleted when the device kept a stale list', async () => {
    const app = await boot();
    const { state } = app;
    const { holidays } = await localData(app);
    const abort = new AbortController();
    const result = app.runMigration(app.planMigration(LOCAL, SERVER), {
      deleteSource: true,
      signal: abort.signal,
      onProgress: (p) => {
        // Cut off once the first calendar is gone.
        if (p.phase === 'delete' && p.calendarIndex === 1) abort.abort();
      },
    });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const gone = state().calendars.some((c) => c.id === 'local|personal');
    expect(gone).toBe(false);
    const serverCalendars = app.calendars(SERVER).length;

    // The browser was killed after the objects were removed but before the
    // shorter calendar list was saved: the calendar comes back, empty.
    const { calendars, objects } = state();
    const stale = { ...app.calendars(SERVER)[0], id: 'local|personal', accountId: LOCAL, remoteId: 'personal', name: 'My calendar' };
    app.useData.setState({ calendars: [...calendars, stale], objects: { ...objects, 'local|personal': {} } });

    const again = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(again).toMatchObject({ complete: true, sourceEmpty: true });
    expect(app.calendars(SERVER)).toHaveLength(serverCalendars);
    expect(app.calendars(LOCAL).map((c) => c.id)).toEqual([holidays.id]);
  });

  it('reports a calendar it could not delete and tries again next time', async () => {
    const app = await boot();
    const { fake, state, BackendError } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    await state().syncAccount(SERVER);
    fake.before = (call) => {
      if (call.startsWith('deleteCalendar')) throw new BackendError('network', 'Connection lost');
    };
    const result = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(result).toMatchObject({ complete: false, copied: 1 });
    expect(result.calendars[0]).toMatchObject({ verified: true, deleted: false, kept: 'failed', error: 'Connection lost' });
    expect(app.pendingMigration()).not.toBeNull();

    fake.before = undefined;
    const again = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(again).toMatchObject({ complete: true, copied: 0, present: 1, sourceEmpty: true });
    expect(again.calendars[0].targetId).toBe(result.calendars[0].targetId);
    expect(state().calendars.filter((c) => c.accountId === LOCAL)).toHaveLength(1);
  });
});

describe('what the source holds now is what is verified', () => {
  it('copies again an item that was changed in the source while it was being moved', async () => {
    const app = await boot();
    const { fake, state, titles } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Dentist 09:00'));
    fake.seed('work', 'w2', event('w2', 'Lunch'));
    await state().syncAccount(SERVER);

    const result = await app.runMigration(app.planMigration(SERVER, LOCAL), {
      deleteSource: true,
      onProgress: (p) => {
        // Another device moves the appointment while this one copies.
        if (p.phase === 'verify') fake.seed('work', 'w1', event('w1', 'Dentist 11:00'));
      },
    });
    expect(result.calendars[0]).toMatchObject({ verified: false, deleted: false, kept: 'unverified' });
    expect(fake.calendars.has('work')).toBe(true);

    const again = await app.runMigration(app.planMigration(SERVER, LOCAL), { deleteSource: true });
    expect(again).toMatchObject({ copied: 1, present: 1, complete: true });
    expect(titles(again.calendars[0].targetId)).toEqual(['Dentist 11:00', 'Lunch']);
    expect(fake.calendars.has('work')).toBe(false);
  });

  it('takes an edit made between an interrupted run and its continuation along', async () => {
    const app = await boot();
    const { state, titles } = app;
    await localData(app);
    const abort = new AbortController();
    const first = app.runMigration(app.planMigration(LOCAL, SERVER), {
      signal: abort.signal,
      onProgress: (p) => {
        if (p.phase === 'copy' && p.calendarIndex === 1) abort.abort();
      },
    });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    // Days later; the device is still where the user works.
    const dentist = Object.values(state().objects['local|personal']).find((o) => o.data.includes('SUMMARY:Dentist'))!;
    await state().applyOps([{ type: 'update', url: dentist.url, etag: dentist.etag, data: event('e1', 'Dentist moved') }]);

    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(result.complete).toBe(true);
    const moved = result.calendars.find((c) => c.sourceId === 'local|personal')!;
    expect(moved).toMatchObject({ copied: 1, present: 1, deleted: true });
    expect(titles(moved.targetId)).toEqual(['Dentist moved', 'Lunch']);
  });

  it('does not take a write the server answered and then did not keep for a copy', async () => {
    const app = await boot();
    const { fake, titles } = app;
    await localData(app);
    const real = fake.putObjects!;
    fake.putObjects = async (cal, items, onProgress) => {
      const stored = await real(cal, items, onProgress);
      const lost = stored.find((o) => o.data.includes('SUMMARY:Lunch'));
      if (lost) {
        // Never kept, and so not in the change log either: asking for changes cannot find out.
        const there = fake.calendars.get(cal.remoteId!)!;
        there.objects.delete(lost.url);
        there.log.splice(0, there.log.length, ...there.log.filter((e) => e.url !== lost.url));
      }
      return stored;
    };
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(result.calendars[0]).toMatchObject({ name: 'My calendar', verified: false, deleted: false, kept: 'unverified' });
    expect(titles('local|personal')).toEqual(['Dentist', 'Lunch']);
    expect(titles(result.calendars[0].targetId)).toEqual(['Dentist']);
  });

  it('never deletes a calendar whose items could not be read from the device', async () => {
    await localData(await boot());
    mockUnreadable('local|personal');
    const app = await boot();
    const result = await app.runMigration(app.planMigration(LOCAL, SERVER), { deleteSource: true });
    expect(result.complete).toBe(false);
    expect(result.calendars[0]).toMatchObject({ sourceId: 'local|personal', copied: 0, verified: false, deleted: false, kept: 'unreadable' });
    // The others move.
    expect(result.calendars.slice(1).map((c) => c.deleted)).toEqual([true, true]);
    expect(app.state().calendars.some((c) => c.id === 'local|personal')).toBe(true);
    vi.doUnmock('@/lib/storage');
    vi.resetModules();
    const storage = await import('@/lib/storage');
    expect(await storage.loadObjects('local|personal')).toHaveLength(2);
  });

  it('finishes a copy whose source cannot be asked any more by the time it is verified', async () => {
    const app = await boot();
    const { fake, state, BackendError, registerBackend } = app;
    fake.addCalendar('work', { displayName: 'Work' });
    fake.seed('work', 'w1', event('w1', 'Standup'));
    await state().syncAccount(SERVER);
    // The password was taken away half-way: the copy is made from what the device holds, the source is not needed after that.
    let locked = false;
    registerBackend('caldav', () => {
      if (locked) throw new BackendError('locked', 'Locked');
      return fake;
    });
    const result = await app.runMigration(app.planMigration(SERVER, LOCAL), {
      onProgress: ({ phase }) => {
        if (phase === 'verify') locked = true;
      },
    });
    expect(result).toMatchObject({ copied: 1, complete: true, unreadable: 0 });
    expect(result.calendars[0]).toMatchObject({ verified: true, deleted: false });
  });
});
