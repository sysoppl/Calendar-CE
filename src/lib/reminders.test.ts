// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventIcs } from '@/lib/ical/events';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';
import { makeFormatter } from '@/hooks/useFormat';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { NOTIFICATION_BADGE, NOTIFICATION_ICON, cappedAlarms, computeReminders, reminderText, rescheduleReminders, toNativeReminder, whenText, type Reminder } from './reminders';

const calendar = (id: string, components: Calendar['components']): Calendar => ({
  id,
  accountId: 'local',
  remoteId: id.slice('local|'.length),
  name: id,
  color: '#2d772a',
  components,
  readOnly: false,
  visible: false,
  order: 0,
});

const raw = (calendarId: string, url: string, data: string) => ({ url, etag: '"1"', calendarId, data: data.replace(/\r?\n/g, '\r\n') });

describe('computeReminders', () => {
  it('reminds of everything else when one item cannot be read or followed', () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 3600_000);
    const later = new Date(soon.getTime() + 3600_000);
    useData.setState({
      calendars: [calendar('local|tasks', ['VTODO']), calendar('local|events', ['VEVENT'])],
      objects: {
        'local|tasks': {
          broken: raw('local|tasks', 'broken', 'BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:broken\nSUMMARY:Broken\nDUE:2026-10-12\nEND:VTODO\nEND:VCALENDAR'),
          good: raw('local|tasks', 'good', createTaskIcs(emptyTask({ uid: 'good', title: 'Call back', due: soon, dueAllDay: false, alarms: [15] }))),
        },
        'local|events': {
          // A rule that never matches; its first instance is all there is.
          endless: raw(
            'local|events',
            'endless',
            createEventIcs({ uid: 'endless', title: 'Hostile', description: '', location: '', start: later, end: later, allDay: false, timezone: 'UTC', alarms: [10], busy: true, attendees: [], categories: [] }).replace(
              'END:VEVENT',
              'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\r\nEND:VEVENT',
            ),
          ),
        },
      },
    });
    expect(computeReminders(now, 3 * 3600_000).map((r) => r.title)).toEqual(['Call back', 'Hostile']);
  });

  it('sets off at most five notifications per item, those nearest its time, with no overlong text', () => {
    useSettings.setState({ language: 'en' });
    const now = new Date();
    const start = new Date(Math.ceil((now.getTime() + 3 * 3600_000) / 60_000) * 60_000);
    const due = new Date(start.getTime() + 3600_000);
    const sixty = Array.from({ length: 60 }, (_, i) => i + 1);
    const event = createEventIcs({ uid: 'spam', title: `Your bank: ${'x'.repeat(250)}`, description: '', location: `Call ${'9'.repeat(250)}`, start, end: start, allDay: false, timezone: 'UTC', alarms: sixty, busy: true, attendees: [], categories: [] });
    // As a feed may write them: the same offset many times over.
    const repeated = createEventIcs({ uid: 'same', title: 'Standup', description: '', location: 'Room 4', start, end: start, allDay: false, timezone: 'UTC', alarms: [10, 10, 10, 30, 30], busy: true, attendees: [], categories: [] });
    const task = createTaskIcs(emptyTask({ uid: 'task', title: 'y'.repeat(201), due, dueAllDay: false, alarms: [0, 5, 10, 15, 20, 25, 30] }));
    useData.setState({
      calendars: [calendar('local|feed', ['VEVENT']), calendar('local|tasks', ['VTODO'])],
      objects: {
        'local|feed': { spam: raw('local|feed', 'spam', event), same: raw('local|feed', 'same', repeated) },
        'local|tasks': { task: raw('local|tasks', 'task', task) },
      },
    });
    const reminders = computeReminders(now, 2 * 86400_000);
    const spam = reminders.filter((r) => r.key.startsWith('spam'));
    expect(spam.map((r) => (start.getTime() - r.at.getTime()) / 60_000).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(spam.map((r) => r.title))).toEqual(new Set(['Event reminder']));
    expect(spam.every((r) => r.location === undefined)).toBe(true);
    expect(reminders.filter((r) => r.key.startsWith('same')).map((r) => [r.title, r.location])).toEqual([
      ['Standup', 'Room 4'],
      ['Standup', 'Room 4'],
    ]);
    const tasks = reminders.filter((r) => r.task);
    expect(tasks.map((r) => (due.getTime() - r.at.getTime()) / 60_000).sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20]);
    expect(tasks[0].title).toBe('Task reminder');
  });
});

describe('the key of a reminder', () => {
  const at = (hours: number) => new Date(Math.ceil((Date.now() + hours * 3600_000) / 60_000) * 60_000);
  const meeting = (start: Date, extra = '') =>
    raw(
      'local|events',
      'meeting',
      createEventIcs({ uid: 'meeting', title: 'Meeting', description: '', location: '', start, end: new Date(start.getTime() + 3600_000), allDay: false, timezone: 'UTC', alarms: [15], busy: true, attendees: [], categories: [] }).replace('END:VEVENT', `${extra}END:VEVENT`),
    );

  it("names the item's time: a moved event's reminder is a new one, which fires even when the earlier one did", () => {
    const first = at(2);
    useData.setState({ calendars: [calendar('local|events', ['VEVENT'])], objects: { 'local|events': { meeting: meeting(first) } } });
    const [before] = computeReminders(new Date(), 86400_000);
    expect(before.key).toBe(`meeting|${first.getTime()}|15`);
    const moved = at(5);
    useData.setState({ objects: { 'local|events': { meeting: meeting(moved) } } });
    const [after] = computeReminders(new Date(), 86400_000);
    expect(after.key).toBe(`meeting|${moved.getTime()}|15`);
    expect(after.id).not.toBe(before.id);
  });

  it('leaves out reminders whose time has passed', () => {
    const start = at(0.1);
    useData.setState({ calendars: [calendar('local|events', ['VEVENT'])], objects: { 'local|events': { meeting: meeting(start) } } });
    // Fifteen minutes before a start six minutes away: already past.
    expect(computeReminders(new Date(), 86400_000)).toEqual([]);
  });

  it('sets off a trigger at a fixed instant once for a series, with the instance it comes before', () => {
    const start = at(3);
    start.setMinutes(0);
    const trigger = new Date(start.getTime() + 25 * 3600_000 - 30 * 60_000);
    const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    useData.setState({
      calendars: [calendar('local|events', ['VEVENT'])],
      objects: { 'local|events': { meeting: meeting(start, `RRULE:FREQ=HOURLY;INTERVAL=5;COUNT=20\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:${utc(trigger)}\r\nEND:VALARM\r\n`) } },
    });
    const fixed = computeReminders(new Date(), 4 * 86400_000).filter((r) => r.at.getTime() === trigger.getTime());
    expect(fixed).toHaveLength(1);
    // The instance 25 hours after the first starts half an hour after the trigger.
    expect(fixed[0].start).toEqual(new Date(start.getTime() + 25 * 3600_000));
  });
});

describe('cappedAlarms', () => {
  it('keeps up to five distinct offsets, nearest the item first, before it on a tie', () => {
    expect(cappedAlarms([15, 15, 60])).toEqual([15, 60]);
    expect(cappedAlarms([10080, 1440, 60, 30, 15, 5, 0])).toEqual([0, 5, 15, 30, 60]);
    expect(cappedAlarms([-10, 10, -5, 5, 0, 20])).toEqual([-5, 0, 5, 10, -10].sort((a, b) => a - b));
    expect(cappedAlarms([])).toEqual([]);
    // The cut falls on a tie: an hour before (60) or an hour after (-60). The one before stays,
    // as in the background refresh on Android (ReminderSyncWorker.keptOffsets, RemindersUnitTest).
    expect(cappedAlarms([-60, 10, 15, 30, 45, 60])).toEqual([10, 15, 30, 45, 60]);
    expect(cappedAlarms([60, 45, 30, 15, 10, -60])).toEqual([10, 15, 30, 45, 60]);
  });
});

describe('reminders that follow the wall clock', () => {
  /** A local time as iCalendar writes it without a zone. */
  const floating = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const alarm = (trigger: string) => `BEGIN:VALARM
ACTION:DISPLAY
${trigger}
END:VALARM`;
  const vevent = (uid: string, start: string, ...alarms: string[]) =>
    `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:${uid}
SUMMARY:${uid}
${start}
${alarms.join('\n')}
END:VEVENT
END:VCALENDAR`;
  const vtodo = (uid: string, due: string) =>
    `BEGIN:VCALENDAR
BEGIN:VTODO
UID:${uid}
SUMMARY:${uid}
${due}
${alarm('TRIGGER;RELATED=END:-PT10M')}
END:VTODO
END:VCALENDAR`;

  it('are the ones of times without a zone, all-day or not, events and tasks alike', () => {
    const now = new Date();
    const start = new Date(now.getTime() + 2 * 3600_000);
    start.setSeconds(0, 0);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const day = floating(tomorrow).slice(0, 8);
    // A date-only due is at midnight, so its reminder ten minutes before is on the day before.
    const dayAfter = floating(new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1)).slice(0, 8);
    // A day later, so that wherever the tests run it lies ahead and inside the window.
    const inWarsaw = floating(new Date(start.getTime() + 86400_000));
    const events: Record<string, string> = {
      'local-time': vevent('local-time', `DTSTART:${floating(start)}`, alarm('TRIGGER:-PT15M')),
      zoned: vevent('zoned', `DTSTART;TZID=Europe/Warsaw:${inWarsaw}`, alarm('TRIGGER:-PT15M')),
      utc: vevent('utc', `DTSTART:${utc(start)}`, alarm('TRIGGER:-PT15M')),
      'all-day': vevent('all-day', `DTSTART;VALUE=DATE:${day}`, alarm('TRIGGER:PT9H')),
      // A trigger at a fixed instant stays where it is, whatever the start does.
      'fixed-trigger': vevent('fixed-trigger', `DTSTART:${floating(start)}`, alarm(`TRIGGER;VALUE=DATE-TIME:${utc(new Date(start.getTime() - 30 * 60000))}`)),
      createEventIcs: createEventIcs({ uid: 'created', title: 'created', description: '', location: '', start, end: start, allDay: false, timezone: 'floating', alarms: [5], busy: true, attendees: [], categories: [] }),
    };
    const tasks: Record<string, string> = {
      'task-local-time': vtodo('task-local-time', `DUE:${floating(start)}`),
      'task-date': vtodo('task-date', `DUE;VALUE=DATE:${dayAfter}`),
      'task-utc': vtodo('task-utc', `DUE:${utc(start)}`),
      'task-created': createTaskIcs(emptyTask({ uid: 'task-created', title: 'task-created', due: start, dueAllDay: false, alarms: [10] })),
    };
    useData.setState({
      calendars: [calendar('local|tasks', ['VTODO']), calendar('local|events', ['VEVENT'])],
      objects: {
        'local|events': Object.fromEntries(Object.entries(events).map(([k, v]) => [k, raw('local|events', k, v)])),
        'local|tasks': Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, raw('local|tasks', k, v)])),
      },
    });
    const reminders = computeReminders(now, 2 * 86400_000);
    const flags = Object.fromEntries(reminders.map((r) => [r.title, r.floating]));
    expect(flags).toEqual({
      'local-time': true,
      zoned: false,
      utc: false,
      'all-day': true,
      'fixed-trigger': false,
      created: true,
      'task-local-time': true,
      'task-date': true,
      'task-utc': false,
      'task-created': false,
    });

    const native = Object.fromEntries(reminders.map((r) => [r.title, toNativeReminder(r)]));
    // The item's time goes over as it is, for the notification to word when it is shown; no text is made here.
    expect(native['local-time']).toEqual({ key: reminders.find((r) => r.title === 'local-time')!.key, at: start.getTime() - 15 * 60000, title: 'local-time', body: '', start: start.getTime(), floating: true });
    expect(native['all-day']).toMatchObject({ start: tomorrow.getTime(), allDay: true, floating: true });
    expect(native['task-local-time']).toMatchObject({ start: start.getTime(), body: '' });
    expect('allDay' in native['task-local-time']).toBe(false);
    expect(native['all-day'].floating).toBe(true);
    expect(native['task-local-time'].floating).toBe(true);
    // Nothing is said of the others: the native engine reads a missing flag as an instant.
    expect('floating' in native.zoned).toBe(false);
    expect('floating' in native['fixed-trigger']).toBe(false);
  });
});

describe('how a notification names the time', () => {
  // Thursday 15 October 2026, 17:00 on this machine's clock: when the reminder fired.
  const now = new Date(2026, 9, 15, 17, 0);
  const at = (day: number, hour = 0, minute = 0, month = 9, year = 2026) => new Date(year, month, day, hour, minute);
  const pl = makeFormatter('pl', '24h');
  const en = makeFormatter('en', '12h');
  /** Intl puts a narrow no-break space before AM and PM. */
  const plain = (s: string) => s.replace(/\s/g, ' ');

  it('names today, tomorrow and yesterday', () => {
    expect(whenText(at(15, 18), false, now, pl)).toBe('Dzisiaj o godzinie 18:00');
    expect(whenText(at(16, 9), false, now, pl)).toBe('Jutro o godzinie 9:00');
    expect(whenText(at(14, 18), false, now, pl)).toBe('Wczoraj o godzinie 18:00');
    expect(plain(whenText(at(15, 18), false, now, en))).toBe('Today at 6:00 PM');
    expect(plain(whenText(at(16, 9), false, now, en))).toBe('Tomorrow at 9:00 AM');
    expect(plain(whenText(at(14, 18), false, now, en))).toBe('Yesterday at 6:00 PM');
  });

  it('names the rest of the coming week by its days, and gives the date further away', () => {
    expect(whenText(at(17, 18), false, now, pl)).toBe('sobota o godzinie 18:00');
    expect(whenText(at(21, 18), false, now, pl)).toBe('środa o godzinie 18:00');
    expect(plain(whenText(at(17, 18), false, now, en))).toBe('Saturday at 6:00 PM');
    // A week ahead would share today's name.
    expect(whenText(at(22, 18), false, now, pl)).toBe('22 paź o godzinie 18:00');
    expect(whenText(at(13, 18), false, now, pl)).toBe('13 paź o godzinie 18:00');
    // With the year when it is another one.
    expect(whenText(at(5, 9, 0, 0, 2027), false, now, pl)).toBe('5 sty 2027 o godzinie 9:00');
  });

  it('names the day alone for an all-day item', () => {
    expect(whenText(at(15), true, now, pl)).toBe('Dzisiaj');
    expect(whenText(at(16), true, now, pl)).toBe('Jutro');
    expect(whenText(at(19), true, now, pl)).toBe('poniedziałek');
    expect(whenText(at(30), true, now, pl)).toBe('30 paź');
    expect(whenText(at(16), true, now, en)).toBe('Tomorrow');
  });

  it('puts the place on a second line', () => {
    const r: Reminder = { id: 1, key: 'k|15', calendarId: 'c', at: at(15, 17, 45), title: 'Podlać kwiaty', start: at(15, 18), end: at(15, 18, 30), allDay: false, location: 'Balkon' };
    expect(reminderText(r, now, pl)).toBe('Dzisiaj o godzinie 18:00\nBalkon');
    expect(reminderText({ ...r, location: undefined }, now, pl)).toBe('Dzisiaj o godzinie 18:00');
  });
});

describe('a notification in the browser', () => {
  const shown: { title: string; body?: string; icon?: string; badge?: string }[] = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    shown.length = 0;
  });

  it('words the time when it is shown, not when it was set up', async () => {
    // Set up at 23:50 for an event at 0:30, reminded half an hour before: it shows at midnight.
    vi.useFakeTimers({ now: new Date(2026, 9, 15, 23, 50), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(title: string, options: NotificationOptions) {
          shown.push({ title, body: options.body, icon: options.icon, badge: (options as { badge?: string }).badge });
        }
      },
    );
    const start = new Date(2026, 9, 16, 0, 30);
    useSettings.setState({ notificationsEnabled: true, language: 'pl', timeFormat: '24h' });
    useData.setState({
      hydrated: true,
      calendars: [calendar('local|events', ['VEVENT'])],
      objects: {
        'local|events': {
          plants: raw(
            'local|events',
            'plants',
            createEventIcs({ uid: 'plants', title: 'Podlać kwiaty', description: '', location: 'Balkon', start, end: new Date(start.getTime() + 1800_000), allDay: false, timezone: 'UTC', alarms: [30], busy: true, attendees: [], categories: [] }),
          ),
        },
      },
    });
    rescheduleReminders();
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // At 23:50 it would have said "Jutro" (tomorrow); at midnight the event is today.
    expect(shown).toEqual([{ title: 'Podlać kwiaty', body: 'Dzisiaj o godzinie 0:30\nBalkon', icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE }]);
  });

  it('still shows a reminder whose timer the browser held up past a recomputation', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 20, 9, 50), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(title: string) {
          shown.push({ title });
        }
      },
    );
    const start = new Date(2026, 9, 20, 10, 15);
    useSettings.setState({ notificationsEnabled: true, language: 'en', timeFormat: '24h' });
    useData.setState({
      hydrated: true,
      calendars: [calendar('local|events', ['VEVENT'])],
      objects: {
        'local|events': {
          late: raw('local|events', 'late', createEventIcs({ uid: 'late', title: 'Call the plumber', description: '', location: '', start, end: start, allDay: false, timezone: 'UTC', alarms: [15], busy: true, attendees: [], categories: [] })),
        },
      },
    });
    rescheduleReminders();
    await vi.advanceTimersByTimeAsync(1000);
    // A frozen tab: the clock goes on to 10:05, its timer for 10:00 has not run.
    vi.setSystemTime(new Date(2026, 9, 20, 10, 5));
    rescheduleReminders();
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toEqual([{ title: 'Call the plumber' }]);
    // Shown once: the next recomputation does not set it off again.
    rescheduleReminders();
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toHaveLength(1);
  });

  it('carries the app icon and its badge, which the icon renderer writes', async () => {
    const { existsSync } = await import('node:fs');
    for (const path of [NOTIFICATION_ICON, NOTIFICATION_BADGE]) expect(existsSync(`public${path}`), path).toBe(true);
  });
});
