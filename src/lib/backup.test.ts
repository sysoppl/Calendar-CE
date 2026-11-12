// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';

// Every test starts the stores from fresh modules over an empty device.
vi.setConfig({ testTimeout: 30_000 });

function event(uid: string, title = uid): string {
  return createEventIcs({
    uid,
    title,
    description: '',
    location: '',
    start: new Date(2026, 10, 12, 9, 0),
    end: new Date(2026, 10, 12, 10, 0),
    allDay: false,
    timezone: 'Europe/Warsaw',
    alarms: [],
    busy: true,
    attendees: [],
    categories: [],
  });
}

const task = (uid: string, title = uid) => createTaskIcs(emptyTask({ uid, title }));

/** The app starting on a device: fresh modules over whatever localStorage and IndexedDB hold. */
async function boot() {
  vi.resetModules();
  const data = await import('@/store/data');
  const settings = await import('@/store/settings');
  const backup = await import('./backup');
  await data.useData.getState().init();
  const state = () => data.useData.getState();
  const titles = (calId: string) =>
    Object.values(state().objects[calId] ?? {})
      .map((o) => /^SUMMARY:(.*)$/m.exec(o.data)?.[1].trim())
      .sort();
  return { ...data, ...settings, ...backup, state, titles };
}

/** A device that keeps a calendar and a task list with some items, a holiday calendar and a feed. */
async function filledDevice() {
  const app = await boot();
  await app.state().setupLocalDefaults();
  await app.state().importObjects('local|personal', [
    { uid: 'a', data: event('a', 'Dentist') },
    { uid: 'b', data: event('b', 'Lunch') },
  ]);
  await app.state().importObjects('local|tasks', [{ uid: 't', data: task('t', 'Pay rent') }]);
  app.state().addHolidayCalendar({ country: 'PL', name: 'Holidays', color: '#1b8037' });
  const feed = await app.state().addSubscription({ url: 'https://example.com/feed.ics', name: 'Feed', color: '#2396c7' });
  await app.state().updateCalendar(feed.id, { visible: false, order: 6 });
  app.useSettings.getState().update({ weekStartsOn: 0, theme: 'graphite', defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks', calendarAlarms: { 'local|personal': { timed: [30] } } });
  return app;
}

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  // The feed's server (directly or through the app's relay): an empty calendar.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nEND:VCALENDAR\r\n', { status: 200, headers: { 'content-type': 'text/calendar', 'x-dav-proxy-relay': '1' } })),
  );
});

describe('making a backup', () => {
  it('holds the device calendars with every item, the generated calendars and the settings', async () => {
    const app = await filledDevice();
    const made = app.makeBackup(new Date(2026, 10, 9, 12, 0), '1.15.0');
    expect(made).toMatchObject({ calendars: 2, items: 3, unreadable: [] });
    const file = JSON.parse(made.text);
    expect(file).toMatchObject({ format: 'calendar-ce-backup', version: 1, app: '1.15.0', settingsVersion: app.SETTINGS_VERSION });
    expect(file.calendars.map((c: { id: string; objects: string[] }) => [c.id, c.objects.length])).toEqual([
      ['local|personal', 2],
      ['local|tasks', 1],
    ]);
    expect(file.calendars[0].alarms).toEqual({ timed: [30] });
    expect(file.generated.map((g: { name: string; visible: boolean; order: number }) => [g.name, g.visible, g.order]).sort()).toEqual([
      ['Feed', false, 6],
      ['Holidays', true, expect.any(Number)],
    ]);
    // Generated calendars hold no items of their own in the file.
    expect(file.calendars.some((c: { id: string }) => c.id.includes('holidays'))).toBe(false);
    expect(file.settings).toMatchObject({ weekStartsOn: 0, theme: 'graphite', defaultCalendarId: 'local|personal' });
    expect(file.settings.calendarAlarms).toBeUndefined();
  });

  it('names its file after the day', async () => {
    const { backupFileName } = await boot();
    expect(backupFileName('Calendar CE backup', new Date(2026, 0, 5))).toBe('Calendar CE backup 2026-01-05.json');
    expect(backupFileName('a/b: c', new Date(2026, 0, 5))).toBe('ab c 2026-01-05.json');
  });
});

describe('reading a file', () => {
  it('takes its own backups back, items and all', async () => {
    const app = await filledDevice();
    const parsed = app.parseBackup(app.makeBackup().text);
    expect(parsed.items).toBe(3);
    expect(parsed.damaged).toBe(0);
    expect(parsed.calendars.map((c) => c.items.map((i) => i.kind))).toEqual([['event', 'event'], ['task']]);
    expect(parsed.defaults).toEqual({ calendar: 'local|personal', taskList: 'local|tasks' });
    expect(parsed.generated).toHaveLength(2);
  });

  it('says what is wrong with a file that is no backup', async () => {
    const { parseBackup, BackupError } = await boot();
    const problem = (text: string) => {
      try {
        parseBackup(text);
        return 'none';
      } catch (err) {
        return err instanceof BackupError ? err.problem : 'other';
      }
    };
    expect(problem('BEGIN:VCALENDAR')).toBe('not-backup');
    expect(problem('{"format":"something-else"}')).toBe('not-backup');
    expect(problem('{"format":"calendar-ce-backup",')).toBe('damaged');
    expect(problem('{"format":"calendar-ce-backup","version":2,"createdAt":"2026-11-09T10:00:00Z","calendars":[]}')).toBe('newer');
    expect(problem('{"format":"calendar-ce-backup","version":1,"createdAt":"not a date","calendars":[]}')).toBe('damaged');
    expect(problem('{"format":"calendar-ce-backup","version":1,"createdAt":"2026-11-09T10:00:00Z","calendars":[]}')).toBe('none');
  });

  it('leaves out what it cannot use and counts the unreadable items', async () => {
    const { parseBackup } = await boot();
    const parsed = parseBackup(
      JSON.stringify({
        format: 'calendar-ce-backup',
        version: 1,
        createdAt: '2026-11-09T10:00:00Z',
        calendars: [
          { id: 'local|x', name: 'X', color: '#123456', components: ['VEVENT'], objects: [event('e'), 'not ical', 42, task('t')] },
          { id: 'local|y', name: 'No parts', components: ['VJOURNAL'], objects: [] },
          'nonsense',
        ],
        generated: [
          { id: 'local|h', name: 'H', color: '#000', holidayCountry: 'PL' },
          { id: 'local|bad', name: 'Bad', color: '#000', subscriptionUrl: 'javascript:alert(1)' },
          { id: 'other|f', name: 'F', color: '#000', subscriptionUrl: 'https://example.com/f.ics' },
          { id: 'local|both', name: 'B', color: '#000', holidayCountry: 'PL', subscriptionUrl: 'https://example.com/f.ics' },
          { id: 'local|nowhere', name: 'N', color: '#000', holidayCountry: 'XX' },
        ],
        settings: { weekStartsOn: 3, theme: 'graphite', fabAction: 'nonsense', backupReminderDays: 14, deviceProfile: 'phone', calendarAlarms: { a: 1 } },
      }),
    );
    // The task is not for an events-only calendar; the text and the number are damaged.
    expect(parsed.calendars.map((c) => [c.id, c.items.length])).toEqual([['local|x', 1]]);
    expect(parsed.damaged).toBe(2);
    expect(parsed.generated.map((g) => g.id)).toEqual(['local|h']);
    expect(parsed.settings).toEqual({ theme: 'graphite', backupReminderDays: 14 });
  });
});

describe('restoring', () => {
  it('brings everything back onto an empty device', async () => {
    const first = await filledDevice();
    const text = first.makeBackup().text;

    // Everything gone: a new device, or one whose browser data was cleared.
    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    const app = await boot();
    const progress: number[] = [];
    const result = await app.restoreBackup(app.parseBackup(text), { settings: true, onProgress: (done) => progress.push(done) });
    expect(result).toEqual({ calendars: 2, created: 2, items: 3, generated: 2, feedsFailed: [] });
    expect(progress.at(-1)).toBe(3);
    const own = app.state().calendars.filter((c) => c.accountId === 'local' && !c.holidayCountry && !c.subscriptionUrl);
    const personal = own.find((c) => c.components.includes('VEVENT'))!;
    const tasks = own.find((c) => c.components.includes('VTODO'))!;
    expect(app.titles(personal.id)).toEqual(['Dentist', 'Lunch']);
    expect(app.titles(tasks.id)).toEqual(['Pay rent']);
    const generated = app.state().calendars.filter((c) => c.holidayCountry || c.subscriptionUrl);
    expect(generated.map((c) => [c.name, c.visible]).sort()).toEqual([
      ['Feed', false],
      ['Holidays', true],
    ]);
    // The settings came, with the defaults pointing at the calendars they went to.
    const s = app.useSettings.getState();
    expect(s).toMatchObject({ weekStartsOn: 0, theme: 'graphite', defaultCalendarId: personal.id, defaultTaskListId: tasks.id });
    expect(s.calendarAlarms?.[personal.id]).toEqual({ timed: [30] });
  });

  it('merges into the same calendars on this device and deletes nothing', async () => {
    const app = await filledDevice();
    const text = app.makeBackup().text;
    // Since the backup: one item changed, one added; one deleted.
    await app.state().importObjects('local|personal', [
      { uid: 'a', data: event('a', 'Dentist moved') },
      { uid: 'c', data: event('c', 'New one') },
    ]);
    const lunch = Object.values(app.state().objects['local|personal']).find((o) => o.data.includes('Lunch'))!;
    await app.state().applyOps([{ type: 'delete', url: lunch.url, etag: lunch.etag }]);
    app.useSettings.getState().update({ weekStartsOn: 1 });

    const result = await app.restoreBackup(app.parseBackup(text), { settings: false });
    expect(result).toMatchObject({ calendars: 2, created: 0, items: 3, generated: 0, feedsFailed: [] });
    // The file's version of "a" wins, "b" is back, "c" stays.
    expect(app.titles('local|personal')).toEqual(['Dentist', 'Lunch', 'New one']);
    expect(app.state().calendars.filter((c) => c.accountId === 'local')).toHaveLength(4);
    // Settings were not asked for.
    expect(app.useSettings.getState().weekStartsOn).toBe(1);
  });
});

describe("the tabs of the phone's bar of views", () => {
  it('travel in the file and come back with the settings; a value that is no on or off is left out', async () => {
    const app = await filledDevice();
    app.useSettings.getState().update({ viewBarAgenda: false });
    const text = app.makeBackup().text;
    expect(JSON.parse(text).settings).toMatchObject({ viewBarAgenda: false, viewBarDays: true });

    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    const fresh = await boot();
    expect(fresh.useSettings.getState()).toMatchObject({ viewBarAgenda: true, viewBarDays: true });
    await fresh.restoreBackup(fresh.parseBackup(text), { settings: true });
    expect(fresh.useSettings.getState()).toMatchObject({ viewBarAgenda: false, viewBarDays: true });

    const odd = JSON.parse(text);
    odd.settings = { viewBarAgenda: 'no', viewBarDays: false };
    expect(fresh.parseBackup(JSON.stringify(odd)).settings).toEqual({ viewBarDays: false });
  });
});

describe('restoring a feed that cannot be reached', () => {
  it('names it and restores the rest', async () => {
    const first = await filledDevice();
    const text = first.makeBackup().text;
    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const app = await boot();
    const result = await app.restoreBackup(app.parseBackup(text), { settings: false });
    expect(result).toMatchObject({ calendars: 2, items: 3, generated: 1, feedsFailed: ['Feed'] });
  });
});
