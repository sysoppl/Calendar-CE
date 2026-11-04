// @vitest-environment jsdom
// Default notifications per calendar (calendarAlarms.ts): how they resolve,
// how they are kept, and where they go with their calendars.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs } from '@/lib/ical/events';
import {
  calendarAlarmsOf,
  carryCalendarAlarms,
  cleanAlarmList,
  cleanCalendarAlarms,
  defaultAlarmsFor,
  dropCalendarAlarms,
  MAX_CALENDARS,
  sameAlarms,
  withCalendarAlarms,
  withoutCalendarAlarms,
} from './calendarAlarms';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

vi.setConfig({ testTimeout: 30_000 });

const USER = 'user1';
/** The CalDAV account of the store tests, served by the test's fake backend. */
const SERVER = { id: USER, kind: 'caldav' as const, name: 'Server', serverUrl: 'https://dav.example.org/', username: 'me', password: 'secret', useProxy: false };
const SERVER_CAL = `${USER}|row1`;
const DAV_CAL = 'dav1|https://dav.example.org/cal/ada/work/';

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ ...DEFAULT_SETTINGS, calendarAlarms: undefined });
});

describe('the notifications a new event starts with', () => {
  it('are the general ones while the calendar has none of its own, timed and all-day apart', () => {
    useSettings.setState({ defaultAlarms: [10], defaultAllDayAlarms: [-540] });
    expect(defaultAlarmsFor('local|personal', false)).toEqual([10]);
    expect(defaultAlarmsFor('local|personal', true)).toEqual([-540]);
    expect(defaultAlarmsFor(undefined, false)).toEqual([10]);
  });

  it("are the calendar's own for the kind it has them for, and the general ones for the other", () => {
    useSettings.setState({ defaultAlarms: [15], defaultAllDayAlarms: [], calendarAlarms: { [SERVER_CAL]: { timed: [30, 1440] } } });
    expect(defaultAlarmsFor(SERVER_CAL, false)).toEqual([30, 1440]);
    expect(defaultAlarmsFor(SERVER_CAL, true)).toEqual([]);
    useSettings.setState({ calendarAlarms: { [SERVER_CAL]: { allDay: [-480] } } });
    expect(defaultAlarmsFor(SERVER_CAL, false)).toEqual([15]);
    expect(defaultAlarmsFor(SERVER_CAL, true)).toEqual([-480]);
    // Another calendar is not touched by them.
    expect(defaultAlarmsFor(DAV_CAL, true)).toEqual([]);
  });

  it('can be none at all for a calendar while the general default has one', () => {
    useSettings.setState({ defaultAlarms: [15], calendarAlarms: { [DAV_CAL]: { timed: [] } } });
    expect(defaultAlarmsFor(DAV_CAL, false)).toEqual([]);
  });

  it('are a copy that the caller may change', () => {
    useSettings.setState({ defaultAlarms: [15], calendarAlarms: { [DAV_CAL]: { timed: [5] } } });
    defaultAlarmsFor(DAV_CAL, false).push(99);
    defaultAlarmsFor('local|personal', false).push(99);
    expect(useSettings.getState().defaultAlarms).toEqual([15]);
    expect(useSettings.getState().calendarAlarms![DAV_CAL].timed).toEqual([5]);
  });

  it('come from the general ones when what is kept for the calendar does not read right', () => {
    useSettings.setState({
      defaultAlarms: [15],
      calendarAlarms: { [DAV_CAL]: { timed: 'soon' as unknown as number[] }, [SERVER_CAL]: 'all of them' as unknown as { timed: number[] }, toString: { timed: [1] } },
    });
    expect(defaultAlarmsFor(DAV_CAL, false)).toEqual([15]);
    expect(defaultAlarmsFor(SERVER_CAL, false)).toEqual([15]);
    expect(defaultAlarmsFor('constructor', false)).toEqual([15]);
  });
});

describe('how they are kept', () => {
  it('as whole minutes, each once, in order', () => {
    expect(cleanAlarmList([60, 15, 15, 0.4, -540])).toEqual([-540, 0, 15, 60]);
    expect(cleanAlarmList([1e12])).toEqual([10 * 366 * 1440]);
    expect(cleanAlarmList(['15'])).toBeUndefined();
    expect(cleanAlarmList([Number.NaN])).toBeUndefined();
    expect(cleanAlarmList(15)).toBeUndefined();
    expect(cleanAlarmList([])).toEqual([]);
  });

  it('by calendar id in order, without what does not read right, and not without end', () => {
    const map = cleanCalendarAlarms({ [DAV_CAL]: { allDay: [-540], timed: [30, 15], other: 1 }, [SERVER_CAL]: { timed: [5] }, nobar: { timed: [1] }, 'x|empty': {}, 'x|bad': { timed: ['a'] } });
    expect(Object.keys(map)).toEqual([DAV_CAL, SERVER_CAL].sort());
    expect(map[DAV_CAL]).toEqual({ timed: [15, 30], allDay: [-540] });
    expect(JSON.stringify(cleanCalendarAlarms({ [SERVER_CAL]: { timed: [5] }, [DAV_CAL]: { timed: [15, 30], allDay: [-540] } }))).toBe(JSON.stringify(map));
    const many = Object.fromEntries(Array.from({ length: MAX_CALENDARS + 5 }, (_, i) => [`a|${String(i).padStart(3, '0')}`, { timed: [i] }]));
    expect(Object.keys(cleanCalendarAlarms(many))).toHaveLength(MAX_CALENDARS);
    expect(cleanCalendarAlarms(null)).toEqual({});
    expect(cleanCalendarAlarms([1, 2])).toEqual({});
  });

  it('set, changed and removed one calendar at a time', () => {
    let map = withCalendarAlarms(undefined, DAV_CAL, { timed: [30, 10] });
    expect(map).toEqual({ [DAV_CAL]: { timed: [10, 30] } });
    map = withCalendarAlarms(map, SERVER_CAL, { allDay: [] });
    expect(map).toEqual({ [DAV_CAL]: { timed: [10, 30] }, [SERVER_CAL]: { allDay: [] } });
    map = withCalendarAlarms(map, DAV_CAL, {});
    expect(map).toEqual({ [SERVER_CAL]: { allDay: [] } });
    expect(calendarAlarmsOf(SERVER_CAL, { calendarAlarms: map })).toEqual({ allDay: [] });
    expect(calendarAlarmsOf(DAV_CAL, { calendarAlarms: map })).toEqual({});
  });

  it('left as they are when nothing of them goes', () => {
    const map = { [SERVER_CAL]: { timed: [10] } };
    expect(withoutCalendarAlarms(map, (id) => id === DAV_CAL)).toBe(map);
    expect(withoutCalendarAlarms(map, (id) => id === SERVER_CAL)).toEqual({});
    expect(withoutCalendarAlarms(undefined, () => true)).toBeUndefined();
  });

  it('compared as lists, whatever the order', () => {
    expect(sameAlarms([15, 60], [60, 15])).toBe(true);
    expect(sameAlarms([15], [15, 15])).toBe(true);
    expect(sameAlarms([15], [30])).toBe(false);
    expect(sameAlarms([], [15])).toBe(false);
  });

  it('removed from the settings only when the calendar had some', () => {
    useSettings.setState({ calendarAlarms: { [SERVER_CAL]: { timed: [10] }, [DAV_CAL]: { timed: [5] } } });
    const writes = vi.fn();
    const off = useSettings.subscribe(writes);
    dropCalendarAlarms((id) => id === 'local|personal');
    expect(writes).not.toHaveBeenCalled();
    dropCalendarAlarms((id) => id.startsWith('dav1|'));
    off();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(useSettings.getState().calendarAlarms).toEqual({ [SERVER_CAL]: { timed: [10] } });
  });

  it('carried to a copy of the calendar, unless the copy has its own', () => {
    useSettings.setState({ calendarAlarms: { 'local|personal': { timed: [10] }, 'local|trips': { allDay: [-540] }, [`${USER}|b`]: { timed: [60] } } });
    carryCalendarAlarms([
      ['local|personal', `${USER}|a`],
      ['local|trips', `${USER}|b`],
      ['local|tasks', `${USER}|c`],
    ]);
    expect(useSettings.getState().calendarAlarms).toEqual({
      'local|personal': { timed: [10] },
      'local|trips': { allDay: [-540] },
      [`${USER}|a`]: { timed: [10] },
      [`${USER}|b`]: { timed: [60] },
    });
  });

  it('not part of what "Reset settings" puts back', () => {
    useSettings.setState({ defaultAlarms: [60], calendarAlarms: { [DAV_CAL]: { timed: [5] } } });
    useSettings.getState().reset();
    expect(useSettings.getState().defaultAlarms).toEqual([15]);
    expect(useSettings.getState().calendarAlarms).toEqual({ [DAV_CAL]: { timed: [5] } });
  });
});

// ---------------------------------------------------------------------------
// With the store: new events, deleted calendars, removed accounts, moves, imports.

function event(uid: string, alarms: number[] = []): string {
  return createEventIcs({
    uid,
    title: uid,
    description: '',
    location: '',
    start: new Date(2026, 9, 12, 9, 0),
    end: new Date(2026, 9, 12, 10, 0),
    allDay: false,
    timezone: 'Europe/Warsaw',
    alarms,
    busy: true,
    attendees: [],
    categories: [],
  });
}

/** The app starting over fresh storage, with a CalDAV account behind a fake server. */
async function boot() {
  vi.resetModules();
  const { useData } = await import('@/store/data');
  const settings = await import('@/store/settings');
  const backends = await import('@/lib/backend');
  const actions = await import('./actions');
  const migrate = await import('./migrate');
  const { splitIcsFile } = await import('./importExport');
  const { FakeBackend } = await import('@/lib/backend/fake');
  const fake = new FakeBackend();
  // Every CalDAV account talks to the fake: nothing here reaches the network.
  backends.registerBackend('caldav', () => fake);
  await useData.getState().init();
  useData.setState((s) => ({ accounts: [...s.accounts, SERVER] }));
  await useData.getState().setupLocalDefaults();
  const state = () => useData.getState();
  return { useData, useSettings: settings.useSettings, state, actions, migrate, splitIcsFile, fake };
}

describe('with the calendars of the store', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("start a new event with its calendar's defaults, else the general ones", async () => {
    const app = await boot();
    app.useSettings.getState().update({ defaultCalendarId: 'local|personal', defaultAlarms: [15], defaultAllDayAlarms: [] });
    expect(app.actions.newEventDraft(new Date(2026, 9, 12, 9))!.data.alarms).toEqual([15]);
    app.useSettings.getState().update({ calendarAlarms: { 'local|personal': { timed: [5, 60], allDay: [-540] } } });
    const timed = app.actions.newEventDraft(new Date(2026, 9, 12, 9))!;
    expect(timed).toMatchObject({ calendarId: 'local|personal', data: { alarms: [5, 60] } });
    expect(app.actions.newEventDraft(new Date(2026, 9, 12), undefined, true)!.data.alarms).toEqual([-540]);
  });

  it('go when their calendar is deleted, and only theirs', async () => {
    const app = await boot();
    const trips = await app.state().createCalendar('local', { name: 'Trips', color: '#ec9607', components: ['VEVENT'] });
    app.useSettings.getState().update({ calendarAlarms: { [trips.id]: { timed: [30] }, 'local|personal': { timed: [5] } } });
    await app.state().deleteCalendar(trips.id);
    expect(app.useSettings.getState().calendarAlarms).toEqual({ 'local|personal': { timed: [5] } });
  });

  it("go when their account is removed, with all of that account's calendars", async () => {
    const app = await boot();
    await app.state().syncAccount(USER);
    const work = await app.state().createCalendar(USER, { name: 'Work', color: '#ec9607', components: ['VEVENT'] });
    app.useSettings.getState().update({ calendarAlarms: { [work.id]: { timed: [30] }, [`${USER}|gone-already`]: { allDay: [] }, 'local|personal': { timed: [5] } } });
    await app.state().removeAccount(USER);
    expect(app.useSettings.getState().calendarAlarms).toEqual({ 'local|personal': { timed: [5] } });
  });

  it('go with a calendar moved to another account, and stay with it', async () => {
    const app = await boot();
    app.useSettings.getState().update({ calendarAlarms: { 'local|personal': { timed: [5], allDay: [-540] } } });
    await app.state().applyOps([{ type: 'create', calendarId: 'local|personal', uid: 'e1', data: event('e1') }]);
    const result = await app.migrate.runMigration(app.migrate.planMigration('local', USER), { deleteSource: true });
    const moved = result.calendars.find((c) => c.sourceId === 'local|personal')!;
    expect(moved).toMatchObject({ verified: true, deleted: true });
    // The moved calendar has them; the one it left is gone, and so are its.
    expect(app.useSettings.getState().calendarAlarms).toEqual({ [moved.targetId]: { timed: [5], allDay: [-540] } });
    expect(defaultAlarmsFor(moved.targetId, true, app.useSettings.getState())).toEqual([-540]);
  });

  it('are not given to imported items, which keep the notifications they come with', async () => {
    const app = await boot();
    app.useSettings.getState().update({ calendarAlarms: { 'local|personal': { timed: [5, 60] } }, defaultAlarms: [15] });
    const file = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...[event('plain'), event('with', [30])].map((ics) => ics.replace(/^[\s\S]*?(BEGIN:VEVENT[\s\S]*END:VEVENT)[\s\S]*$/, '$1')), 'END:VCALENDAR'].join('\r\n');
    const items = app.splitIcsFile(file);
    expect(items).toHaveLength(2);
    await app.state().importObjects('local|personal', items);
    const stored = Object.values(app.state().objects['local|personal']);
    const plain = stored.find((o) => o.data.includes('UID:plain'))!;
    const withAlarm = stored.find((o) => o.data.includes('UID:with'))!;
    expect(plain.data).not.toContain('BEGIN:VALARM');
    expect(withAlarm.data.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(withAlarm.data).toContain('TRIGGER:-PT30M');
  });
});
