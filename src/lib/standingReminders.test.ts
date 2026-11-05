import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';
import type { EventData } from '@/lib/ical/types';
import { useData, type Account, type Calendar } from '@/store/data';
import { useUi } from '@/store/ui';
import { completeFromReminder, finishedStanding, splitReminderKey, standingState } from './standingReminders';

const markTaskDone = vi.hoisted(() => vi.fn(async (_task: unknown) => true));
vi.mock('./actions', () => ({ markTaskDone }));

const LOCAL: Account = { id: 'local', kind: 'local', name: 'This device', useProxy: false };
const DAV = (lastSync: number): Account => ({ id: 'dav', kind: 'caldav', name: 'Server', useProxy: false, lastSync });

const calendar = (id: string, accountId: string, components: Calendar['components']): Calendar => ({
  id,
  accountId,
  remoteId: id.slice(accountId.length + 1),
  name: id,
  color: '#2d772a',
  components,
  readOnly: false,
  visible: true,
  order: 0,
});
const raw = (calendarId: string, url: string, data: string) => ({ url, etag: '"1"', calendarId, data });

const start = new Date(Date.UTC(2026, 10, 20, 9, 0));
const due = new Date(Date.UTC(2026, 10, 21, 17, 0));
const event = (over: Partial<EventData> = {}) =>
  createEventIcs({ uid: 'call', title: 'Call the bank', description: '', location: '', start, end: new Date(start.getTime() + 1800_000), allDay: false, timezone: 'UTC', alarms: [10], busy: true, attendees: [], categories: [], persistent: true, ...over });
const task = (over: Parameters<typeof emptyTask>[0] = {}) => createTaskIcs(emptyTask({ uid: 'rent', title: 'Pay rent', due, dueAllDay: false, alarms: [0], persistent: true, ...over }));

const EVENTS = 'local|events';
const TASKS = 'local|tasks';
const EVENT_KEY = `ev-url|${start.getTime()}|10`;
const TASK_KEY = `task-url|${due.getTime()}|0`;

function load(objects: Record<string, Record<string, string>>, accounts: Account[] = [LOCAL], calendars?: Calendar[]) {
  // As every change of the store's items does, a sync's included.
  useData.setState((s) => ({
    revision: s.revision + 1,
    hydrated: true,
    accounts,
    calendars: calendars ?? [calendar(EVENTS, 'local', ['VEVENT']), calendar(TASKS, 'local', ['VTODO'])],
    objects: Object.fromEntries(Object.entries(objects).map(([cal, items]) => [cal, Object.fromEntries(Object.entries(items).map(([url, data]) => [url, raw(cal, url, data)]))])),
  }));
}

beforeEach(() => {
  markTaskDone.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a reminder key', () => {
  it('names the item and its time, in the forms of the app and of the background refresh', () => {
    expect(splitReminderKey('https://dav.test/a.ics#20261120T090000Z|1795165200000|10')).toEqual({ item: 'https://dav.test/a.ics#20261120T090000Z', time: 1795165200000 });
    expect(splitReminderKey('dav|https://dav.test/cal/|uid-1|1795165200000|-600000')).toEqual({ item: 'dav|https://dav.test/cal/|uid-1', time: 1795165200000 });
    expect(splitReminderKey('task-url|1795165200000|0|snooze1795165300000')).toEqual({ item: 'task-url', time: 1795165200000 });
    expect(splitReminderKey('test|1795165200000')).toBeUndefined();
  });
});

describe('whether a standing notification is still wanted', () => {
  it('follows the task: open, then done, moved on, turned off or deleted', () => {
    load({ [TASKS]: { 'task-url': task() } });
    expect(standingState(TASK_KEY)).toBe('open');
    // Snoozed: the same item.
    expect(standingState(`${TASK_KEY}|snooze1`)).toBe('open');
    load({ [TASKS]: { 'task-url': task({ completed: true }) } });
    expect(standingState(TASK_KEY)).toBe('finished');
    load({ [TASKS]: { 'task-url': task({ due: new Date(due.getTime() + 86400_000) }) } });
    expect(standingState(TASK_KEY)).toBe('finished');
    load({ [TASKS]: { 'task-url': task({ persistent: false }) } });
    expect(standingState(TASK_KEY)).toBe('finished');
    load({ [TASKS]: {} });
    expect(standingState(TASK_KEY)).toBe('gone');
  });

  it('follows the event: open, then cancelled, moved, turned off or deleted', () => {
    load({ [EVENTS]: { 'ev-url': event() } });
    expect(standingState(EVENT_KEY)).toBe('open');
    load({ [EVENTS]: { 'ev-url': event({ status: 'CANCELLED' }) } });
    expect(standingState(EVENT_KEY)).toBe('finished');
    load({ [EVENTS]: { 'ev-url': event({ start: new Date(start.getTime() + 3600_000), end: new Date(start.getTime() + 5400_000) }) } });
    expect(standingState(EVENT_KEY)).toBe('finished');
    load({ [EVENTS]: { 'ev-url': event({ persistent: false }) } });
    expect(standingState(EVENT_KEY)).toBe('finished');
    load({ [EVENTS]: {} });
    expect(standingState(EVENT_KEY)).toBe('gone');
  });

  it("finds an instance of a series, and an item by its calendar and UID as Android's background refresh names it", () => {
    const series = event().replace('END:VEVENT', 'RRULE:FREQ=DAILY;COUNT=5\r\nEND:VEVENT');
    const dav = calendar('dav|https://dav.test/cal/', 'dav', ['VEVENT']);
    load({ [dav.id]: { 'https://dav.test/cal/call.ics': series } }, [LOCAL, DAV(0)], [dav]);
    const third = start.getTime() + 2 * 86400_000;
    expect(standingState(`https://dav.test/cal/call.ics#20261122T090000Z|${third}|10`)).toBe('open');
    expect(standingState(`${dav.id}|call|${third}|-600000`)).toBe('open');
    expect(standingState(`${dav.id}|call|${third + 1800_000}|-600000`)).toBe('finished');
    expect(standingState(`${dav.id}|other|${third}|-600000`)).toBe('gone');
  });
});

describe('which standing notifications are taken down', () => {
  it('those of local calendars as soon as they are dealt with', () => {
    load({ [TASKS]: { 'task-url': task({ completed: true }) }, [EVENTS]: { 'ev-url': event() } });
    expect(finishedStanding([TASK_KEY, EVENT_KEY, 'test|1'])).toEqual([TASK_KEY]);
  });

  it("those of a server's calendar once it was brought up to date, or once this page saw the change", () => {
    const dav = calendar('dav|https://dav.test/tasks/', 'dav', ['VTODO']);
    const key = `${dav.id}|rent|${due.getTime()}|0`;
    // Another device may have reopened the task: what the store holds says nothing yet.
    load({ [dav.id]: { 'https://dav.test/tasks/rent.ics': task({ completed: true }) } }, [LOCAL, DAV(0)], [dav]);
    expect(finishedStanding([key])).toEqual([]);
    load({ [dav.id]: { 'https://dav.test/tasks/rent.ics': task({ completed: true }) } }, [LOCAL, DAV(Date.now() + 1000)], [dav]);
    expect(finishedStanding([key])).toEqual([key]);

    // Seen open, then completed here (offline: no sync since).
    load({ [dav.id]: { 'https://dav.test/tasks/rent.ics': task() } }, [LOCAL, DAV(0)], [dav]);
    expect(finishedStanding([key])).toEqual([]);
    load({ [dav.id]: { 'https://dav.test/tasks/rent.ics': task({ completed: true }) } }, [LOCAL, DAV(0)], [dav]);
    expect(finishedStanding([key])).toEqual([key]);
  });

  it('those of items no calendar holds once every calendar was brought up to date', () => {
    load({ [TASKS]: {} }, [LOCAL, DAV(0)]);
    expect(finishedStanding([TASK_KEY])).toEqual([]);
    load({ [TASKS]: {} }, [LOCAL, DAV(Date.now() + 1000)]);
    expect(finishedStanding([TASK_KEY])).toEqual([TASK_KEY]);
  });

  it('none before the calendars are loaded', () => {
    load({ [TASKS]: { 'task-url': task({ completed: true }) } });
    useData.setState({ hydrated: false });
    expect(finishedStanding([TASK_KEY])).toEqual([]);
  });
});

describe('Done on a task’s notification', () => {
  it('marks the task done, then takes the notification down', async () => {
    load({ [TASKS]: { 'task-url': task() } });
    const clear = vi.fn();
    await completeFromReminder(TASK_KEY, clear);
    expect(markTaskDone).toHaveBeenCalledTimes(1);
    expect(markTaskDone.mock.calls[0][0]).toMatchObject({ uid: 'rent', completed: false });
    expect(clear).toHaveBeenCalledWith([TASK_KEY]);
  });

  it('keeps the notification when the calendar refuses the change', async () => {
    load({ [TASKS]: { 'task-url': task() } });
    markTaskDone.mockResolvedValueOnce(false);
    const clear = vi.fn();
    await completeFromReminder(TASK_KEY, clear);
    expect(clear).not.toHaveBeenCalled();
  });

  it('takes the notification of a task done already down without touching the task', async () => {
    load({ [TASKS]: { 'task-url': task({ completed: true }) } });
    const clear = vi.fn();
    await completeFromReminder(TASK_KEY, clear);
    expect(markTaskDone).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith([TASK_KEY]);
  });

  it('waits for a task a sync is still bringing, and in the end gives up on it', async () => {
    vi.useFakeTimers();
    load({ [TASKS]: {} }, [LOCAL, DAV(0)]);
    const clear = vi.fn();
    const toast = vi.spyOn(useUi.getState(), 'toast');
    const done = completeFromReminder(TASK_KEY, clear);
    await vi.advanceTimersByTimeAsync(10);
    expect(clear).not.toHaveBeenCalled();
    // The sync brings it.
    load({ [TASKS]: { 'task-url': task() } }, [LOCAL, DAV(0)]);
    await done;
    expect(markTaskDone).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith([TASK_KEY]);

    load({ [TASKS]: {} }, [LOCAL, DAV(0)]);
    const missing = vi.fn();
    const gaveUp = completeFromReminder(TASK_KEY, missing);
    await vi.advanceTimersByTimeAsync(61_000);
    await gaveUp;
    expect(missing).toHaveBeenCalledWith([TASK_KEY]);
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'info');
    toast.mockRestore();
  });
});
