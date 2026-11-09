import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';
import type { EventData } from '@/lib/ical/types';
import { useData, type Account, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { buildSnapshot, findOccurrence, parseDay, runWidgetAction, SNAPSHOT_LIMITS, snapshotRange } from './widgets';

const actions = vi.hoisted(() => ({
  markTaskDone: vi.fn(async (_task: unknown) => true),
  openEditTask: vi.fn(),
  openNewEvent: vi.fn(),
  openNewTask: vi.fn(),
}));
vi.mock('./actions', () => actions);

const LOCAL: Account = { id: 'local', kind: 'local', name: 'This device', useProxy: false };
const calendar = (id: string, components: Calendar['components'], over: Partial<Calendar> = {}): Calendar => ({
  id,
  accountId: 'local',
  remoteId: id.slice(6),
  name: id,
  color: '#1d6cd6',
  components,
  readOnly: false,
  visible: true,
  order: 0,
  ...over,
});
const EVENTS = 'local|events';
const TASKS = 'local|tasks';

const NOW = new Date(2026, 10, 9, 12, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const event = (uid: string, over: Partial<EventData> = {}) =>
  createEventIcs({ uid, title: uid, description: '', location: '', start: at(10, 9), end: at(10, 10), allDay: false, timezone: 'Europe/Warsaw', alarms: [], busy: true, attendees: [], categories: [], ...over });

function load(objects: Record<string, Record<string, string>>, calendars?: Calendar[]) {
  useData.setState((s) => ({
    revision: s.revision + 1,
    hydrated: true,
    accounts: [LOCAL],
    calendars: calendars ?? [calendar(EVENTS, ['VEVENT']), calendar(TASKS, ['VTODO'], { color: 'rgb(1,2,3)' })],
    objects: Object.fromEntries(
      Object.entries(objects).map(([cal, items]) => [cal, Object.fromEntries(Object.entries(items).map(([url, data]) => [url, { url, etag: '"1"', calendarId: cal, data }]))]),
    ),
  }));
}

beforeEach(() => {
  useSettings.setState({ weekStartsOn: 1, timeFormat: '24h', language: 'en', deviceLanguage: '', myEmails: '' });
  for (const fn of Object.values(actions)) fn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the days a snapshot covers', () => {
  it('runs from last month\'s grid to the end of the grid three months ahead', () => {
    const { from, until } = snapshotRange(NOW, 1);
    // 1 October 2026 is a Thursday: its Monday-first grid starts on 28 September.
    expect(from).toEqual(new Date(2026, 8, 28));
    // February 2027 starts on a Monday: its page of six weeks ends on 14 March.
    expect(until).toEqual(new Date(2027, 2, 15));
    expect(snapshotRange(NOW, 0).from).toEqual(new Date(2026, 8, 27));
    expect(snapshotRange(NOW, 6).from).toEqual(new Date(2026, 8, 26));
  });
});

describe('the snapshot', () => {
  it('holds the events as the app shows them, and the open tasks', () => {
    load({
      [EVENTS]: {
        'local://e/1.ics': event('Dentist', { location: 'Main St 1\nback door', color: '#ff000080' }),
        'local://e/2.ics': event('Trip', { allDay: true, start: at(12, 0), end: at(15, 0) }),
        'local://e/3.ics': event('Secret', { hidden: true, location: 'Somewhere' }),
        'local://e/4.ics': event('Called off', { status: 'CANCELLED' }),
        'local://e/5.ics': event('Long ago', { start: new Date(2025, 0, 1, 9), end: new Date(2025, 0, 1, 10) }),
      },
      [TASKS]: {
        'local://t/1.ics': createTaskIcs(emptyTask({ uid: 't1', title: 'Later', due: at(20, 0), dueAllDay: true })),
        'local://t/2.ics': createTaskIcs(emptyTask({ uid: 't2', title: 'Soon', due: at(10, 17), dueAllDay: false })),
        'local://t/3.ics': createTaskIcs(emptyTask({ uid: 't3', title: 'Whenever' })),
        'local://t/4.ics': createTaskIcs(emptyTask({ uid: 't4', title: 'Done', completed: true, status: 'COMPLETED' })),
      },
    });
    const snap = buildSnapshot(NOW);
    expect(snap).toMatchObject({ v: 1, made: NOW.getTime(), from: '2026-09-28', until: '2027-03-15', lang: 'en', hour12: false, weekStart: 1 });
    expect(snap.calendars).toEqual([
      { id: EVENTS, name: EVENTS, color: '#1d6cd6', events: true, tasks: false, visible: true },
      { id: TASKS, name: TASKS, color: '#1d6cd6', events: false, tasks: true, visible: true },
    ]);
    const byTitle = Object.fromEntries(snap.events.map((e) => [e.title, e]));
    expect(Object.keys(byTitle).sort()).toEqual(['Dentist', 'Hidden event', 'Trip']);
    expect(byTitle.Dentist).toEqual({ cal: EVENTS, key: 'local://e/1.ics', title: 'Dentist', place: 'Main St 1 back door', color: '#ff0000', allDay: false, start: at(10, 9).getTime(), end: at(10, 10).getTime() });
    expect(byTitle.Trip).toMatchObject({ allDay: true, day: '2026-11-12', endDay: '2026-11-15' });
    expect(byTitle.Trip.start).toBeUndefined();
    // A hidden event keeps its title and place to itself.
    expect(byTitle['Hidden event'].place).toBeUndefined();
    expect(snap.tasks.map((t) => t.title)).toEqual(['Soon', 'Later', 'Whenever']);
    expect(snap.tasks[0]).toEqual({ cal: TASKS, key: 'local://t/2.ics', title: 'Soon', color: '#1d6cd6', allDay: false, due: at(10, 17).getTime() });
    expect(snap.tasks[1]).toMatchObject({ allDay: true, day: '2026-11-20' });
    expect(snap.tasks[2]).toEqual({ cal: TASKS, key: 'local://t/3.ics', title: 'Whenever', color: '#1d6cd6' });
  });

  it('expands a series over the days it covers, in the app\'s language and clock', () => {
    useSettings.setState({ language: 'pl', timeFormat: '12h' });
    load({ [EVENTS]: { 'local://e/w.ics': event('Weekly', { rrule: { freq: 'WEEKLY', interval: 1 } }) } });
    const snap = buildSnapshot(NOW);
    expect(snap).toMatchObject({ lang: 'pl', hour12: true });
    // Tuesdays from 10 November 2026 to 9 March 2027.
    expect(snap.events).toHaveLength(18);
    expect(new Set(snap.events.map((e) => e.key)).size).toBe(18);
  });

  it('keeps what is nearest today when there is too much', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < SNAPSHOT_LIMITS.events + 40; i++) many[`local://e/${i}.ics`] = event(`e${i}`, { start: new Date(2026, 9, 1, 0, i), end: new Date(2026, 9, 1, 0, i + 1) });
    many['local://e/next.ics'] = event('Next');
    load({ [EVENTS]: many });
    const snap = buildSnapshot(NOW);
    expect(snap.events).toHaveLength(SNAPSHOT_LIMITS.events);
    expect(snap.events.at(-1)!.title).toBe('Next');
  });

  it('cuts long titles', () => {
    load({ [EVENTS]: { 'local://e/l.ics': event('x'.repeat(400)) } });
    expect(buildSnapshot(NOW).events[0].title).toHaveLength(SNAPSHOT_LIMITS.title);
  });
});

describe('a tap on a widget', () => {
  it('reads its day', () => {
    expect(parseDay('2026-11-09')).toEqual(new Date(2026, 10, 9));
    expect(parseDay('2026-02-30')).toBeUndefined();
    expect(parseDay('9.11.2026')).toBeUndefined();
    expect(parseDay(undefined)).toBeUndefined();
  });

  it('opens the day, the event, a new event or task, or the task', async () => {
    load({
      [EVENTS]: { 'local://e/1.ics': event('Dentist', { rrule: { freq: 'DAILY', interval: 1 } }) },
      [TASKS]: { 'local://t/1.ics': createTaskIcs(emptyTask({ uid: 't1', title: 'Pay rent' })) },
    });
    useUi.getState().openSettings('general');

    await runWidgetAction({ action: 'open', day: '2026-11-20', view: 'day' });
    expect(useUi.getState()).toMatchObject({ view: 'day', settings: null });
    expect(useUi.getState().date.getDate()).toBe(20);

    const occ = findOccurrence('local://e/1.ics#' + buildSnapshot(NOW).events[3].key.split('#')[1], at(13, 9));
    expect(occ?.start).toEqual(at(13, 9));
    await runWidgetAction({ action: 'event', cal: EVENTS, key: occ!.key, start: occ!.start.getTime() });
    expect(useUi.getState().popover?.occurrence.key).toBe(occ!.key);

    await runWidgetAction({ action: 'newEvent', day: '2026-11-25' });
    const start = actions.openNewEvent.mock.calls[0][0] as Date;
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 10, 25]);

    await runWidgetAction({ action: 'newTask' });
    expect(actions.openNewTask).toHaveBeenCalledOnce();

    await runWidgetAction({ action: 'task', cal: TASKS, key: 'local://t/1.ics' });
    expect(actions.openEditTask.mock.calls[0][0]).toMatchObject({ title: 'Pay rent' });

    await runWidgetAction({ action: 'taskDone', cal: TASKS, key: 'local://t/1.ics' });
    expect(actions.markTaskDone.mock.calls[0][0]).toMatchObject({ title: 'Pay rent' });
  });

  it('says so when the item is gone', async () => {
    load({});
    const toast = vi.spyOn(useUi.getState(), 'toast');
    await runWidgetAction({ action: 'taskDone', cal: TASKS, key: 'local://t/gone.ics' });
    await runWidgetAction({ action: 'event', cal: EVENTS, key: 'local://e/gone.ics', day: '2026-11-12' });
    expect(actions.markTaskDone).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(2);
    expect(useUi.getState().date.getDate()).toBe(12);
  });

  it('waits for the data stored on the device', async () => {
    useData.setState({ hydrated: false });
    const done = runWidgetAction({ action: 'newTask' });
    await Promise.resolve();
    expect(actions.openNewTask).not.toHaveBeenCalled();
    load({});
    await done;
    expect(actions.openNewTask).toHaveBeenCalledOnce();
  });
});
