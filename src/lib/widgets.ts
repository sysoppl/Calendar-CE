// Home screen widgets (Android, android/…/widgets, docs/DESIGN.md §8b).
//
// The calendar lives in this page, out of the widgets' reach, so the page
// hands the native side a snapshot of what they show: the calendars, the
// events of some five months around today (the Month widget's pages from
// last month to three months ahead) and the open tasks, worded as the app
// words them ("Hidden event" for a hidden one, a birthday's years).
// It is sent while widgets are placed, again whenever the data or the
// settings it depends on change, and once a day; the native side keeps it
// encrypted, rolls the days over itself and leaves out what is past.
//
// A tap on a widget opens the app with an action (`widgetAction`): a day, an
// event, a task, a new event or task, or Done on a task, which this page
// carries out once its data has loaded.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { addDays, addMonths, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { resolveLang, t, type Lang } from '@/i18n';
import { getParsedObject } from '@/hooks/useCalendarData';
import { makeFormatter } from '@/hooks/useFormat';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { markTaskDone, openEditTask, openNewEvent, openNewTask } from './actions';
import { calendarColor, DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR, eventColor, opaqueHex } from './color';
import { nextSlot } from './date';
import { shownTitle } from './hidden';
import { expandEvent } from './ical/events';
import { parseObject } from './ical/parse';
import { readTask } from './ical/tasks';
import type { Occurrence, Task } from './ical/types';
import { selfEmailsByAccount } from './identity';
import { isAndroid } from './platform';

export interface WidgetCalendar {
  id: string;
  name: string;
  color: string;
  events: boolean;
  tasks: boolean;
  visible: boolean;
}

/** A timed event has `start` and `end` (ms); an all-day one `day` and `endDay` (exclusive), local dates. */
export interface WidgetEvent {
  cal: string;
  key: string;
  title: string;
  place?: string;
  color: string;
  allDay: boolean;
  start?: number;
  end?: number;
  day?: string;
  endDay?: string;
}

/** An open task: due at a time (`due`), on a day (`day`), or neither. */
export interface WidgetTask {
  cal: string;
  key: string;
  title: string;
  color: string;
  due?: number;
  allDay?: boolean;
  day?: string;
}

export interface WidgetSnapshot {
  v: 1;
  made: number;
  /** The first day covered and the first day not covered (YYYY-MM-DD). */
  from: string;
  until: string;
  lang: Lang;
  hour12: boolean;
  weekStart: 0 | 1 | 6;
  calendars: WidgetCalendar[];
  events: WidgetEvent[];
  tasks: WidgetTask[];
}

/** What the native side is sent at most: room for a busy calendar, small enough to keep and read in a moment. */
export const SNAPSHOT_LIMITS = { events: 2500, tasks: 500, title: 150, place: 100 } as const;

export type WidgetActionName = 'open' | 'event' | 'newEvent' | 'newTask' | 'task' | 'taskDone';

export interface WidgetAction {
  action: WidgetActionName;
  /** YYYY-MM-DD */
  day?: string;
  view?: 'day' | 'agenda' | 'tasks';
  cal?: string;
  key?: string;
  /** An event's start, ms. */
  start?: number;
}

interface WidgetsPlugin {
  setSnapshot(options: { snapshot: WidgetSnapshot }): Promise<{ widgets: number }>;
  getStatus(): Promise<{ widgets: number }>;
  clear(): Promise<void>;
  addListener(event: 'widgetsChanged', listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'widgetAction', listener: (action: WidgetAction) => void): Promise<PluginListenerHandle>;
}

const Widgets = registerPlugin<WidgetsPlugin>('Widgets');

const DAY = 'yyyy-MM-dd';

/** The days of a month page of the Month widget: six weeks from the week of the 1st. */
const MONTH_PAGE_DAYS = 42;

/**
 * The days a snapshot covers at `now`: the Month widget's pages from last
 * month to three months ahead, each six weeks from the week of its 1st (the
 * widget offers a month only when its whole page is covered).
 */
export function snapshotRange(now: Date, weekStartsOn: 0 | 1 | 6): { from: Date; until: Date } {
  const from = startOfWeek(startOfMonth(addMonths(now, -1)), { weekStartsOn });
  const until = startOfDay(addDays(startOfWeek(startOfMonth(addMonths(now, 3)), { weekStartsOn }), MONTH_PAGE_DAYS));
  return { from, until };
}

/** A text cut to `max` characters, on one line. */
function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function widgetEvent(cal: Calendar, occ: Occurrence): WidgetEvent {
  const place = !occ.hidden && occ.location ? clip(occ.location, SNAPSHOT_LIMITS.place) : '';
  const base = {
    cal: cal.id,
    key: occ.key,
    title: clip(shownTitle(occ, t), SNAPSHOT_LIMITS.title),
    ...(place ? { place } : {}),
    color: opaqueHex(eventColor(occ.color, cal.color)) ?? DEFAULT_CALENDAR_COLOR,
  };
  if (!occ.allDay) return { ...base, allDay: false, start: occ.start.getTime(), end: Math.max(occ.end.getTime(), occ.start.getTime()) };
  const day = format(occ.start, DAY);
  const end = format(occ.end, DAY);
  return { ...base, allDay: true, day, endDay: end > day ? end : format(addDays(occ.start, 1), DAY) };
}

/** A calendar's colour as `#rrggbb`; a task list without a usable one takes the task lists' default. */
function listColor(cal: Calendar): string {
  const fallback = cal.components.includes('VEVENT') ? DEFAULT_CALENDAR_COLOR : DEFAULT_TASK_COLOR;
  return opaqueHex(calendarColor(cal.color, fallback)) ?? fallback;
}

function widgetTask(cal: Calendar, task: Task): WidgetTask {
  const item: WidgetTask = { cal: cal.id, key: task.objectUrl, title: clip(task.title || t('grid.noTitle'), SNAPSHOT_LIMITS.title), color: listColor(cal) };
  if (!task.due) return item;
  return task.dueAllDay ? { ...item, allDay: true, day: format(task.due, DAY) } : { ...item, allDay: false, due: task.due.getTime() };
}

/** When an item is, for ordering: an all-day one at the start of its day. */
const eventTime = (e: WidgetEvent) => e.start ?? new Date(`${e.day}T00:00:00`).getTime();
const taskTime = (x: WidgetTask) => x.due ?? (x.day ? new Date(`${x.day}T00:00:00`).getTime() : Infinity);

/**
 * What the widgets show, as the stores hold it at `now`: every calendar's
 * events in the snapshot's days (cancelled ones and invitations the user
 * declined left out) and the open tasks. Over the limits, what is nearest
 * today stays.
 */
export function buildSnapshot(now = new Date()): WidgetSnapshot {
  const { accounts, calendars, objects } = useData.getState();
  const s = useSettings.getState();
  const lang = resolveLang(s);
  const { from, until } = snapshotRange(now, s.weekStartsOn);
  const self = selfEmailsByAccount(accounts, s.myEmails);
  const events: WidgetEvent[] = [];
  const tasks: WidgetTask[] = [];
  for (const cal of calendars) {
    for (const raw of Object.values(objects[cal.id] ?? {})) {
      const obj = parseObject(raw);
      if (!obj) continue;
      if (obj.kind === 'event') {
        let occs: Occurrence[];
        try {
          occs = expandEvent(obj, from, until, self.get(cal.accountId));
        } catch {
          continue;
        }
        for (const occ of occs) {
          if (occ.status === 'CANCELLED' || occ.selfStatus === 'DECLINED') continue;
          events.push(widgetEvent(cal, occ));
        }
      } else if (obj.kind === 'task') {
        const task = readTask(obj);
        if (task && !task.completed && task.status !== 'CANCELLED') tasks.push(widgetTask(cal, task));
      }
    }
  }
  // Over the limit, the events from today on come first, then the nearest before.
  const today = startOfDay(now).getTime();
  events.sort((a, b) => eventTime(a) - eventTime(b));
  let kept = events;
  if (events.length > SNAPSHOT_LIMITS.events) {
    const ahead = events.filter((e) => (e.end ?? new Date(`${e.endDay}T00:00:00`).getTime()) > today);
    const before = events.filter((e) => !ahead.includes(e));
    kept = [...before.slice(Math.max(0, before.length - Math.max(0, SNAPSHOT_LIMITS.events - ahead.length))), ...ahead.slice(0, SNAPSHOT_LIMITS.events)];
  }
  tasks.sort((a, b) => taskTime(a) - taskTime(b) || a.title.localeCompare(b.title));
  return {
    v: 1,
    made: now.getTime(),
    from: format(from, DAY),
    until: format(until, DAY),
    lang,
    hour12: makeFormatter(lang, s.timeFormat).hour12,
    weekStart: s.weekStartsOn,
    calendars: calendars.map((c) => ({
      id: c.id,
      name: clip(c.name, SNAPSHOT_LIMITS.title),
      color: listColor(c),
      events: c.components.includes('VEVENT'),
      tasks: c.components.includes('VTODO'),
      visible: c.visible,
    })),
    events: kept,
    tasks: tasks.slice(0, SNAPSHOT_LIMITS.tasks),
  };
}

// -----------------------------------------------------------------------------
// Actions from a widget

/** A day of a widget (YYYY-MM-DD) as the local midnight it names; none for anything else. */
export function parseDay(day: string | undefined): Date | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

/** The occurrence a widget's event names, from its object and the day or time it showed. */
export function findOccurrence(key: string, at: Date): Occurrence | undefined {
  const url = key.includes('#') ? key.slice(0, key.lastIndexOf('#')) : key;
  const obj = getParsedObject(url) ?? getParsedObject(key);
  if (!obj || obj.kind !== 'event') return undefined;
  const { accounts } = useData.getState();
  const cal = useData.getState().calendars.find((c) => c.id === obj.calendarId);
  const self = selfEmailsByAccount(accounts, useSettings.getState().myEmails).get(cal?.accountId ?? '');
  try {
    const day = startOfDay(at);
    return expandEvent(obj, addDays(day, -1), addDays(day, 2), self).find((o) => o.key === key);
  } catch {
    return undefined;
  }
}

/** The open task a widget names (its object's address). */
export function findTask(key: string): Task | undefined {
  const obj = getParsedObject(key);
  return obj?.kind === 'task' ? readTask(obj) : undefined;
}

/** Resolves once the data stored on this device is loaded. */
function whenLoaded(): Promise<void> {
  if (useData.getState().hydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useData.subscribe((s) => {
      if (!s.hydrated) return;
      unsub();
      resolve();
    });
  });
}

/** Out of the way of what the widget asked to show: Settings, a popover. */
function clearView() {
  const ui = useUi.getState();
  ui.closeSettings();
  ui.openPopover(null);
  ui.openQuickCreate(null);
  ui.setSearch(false);
}

/** Carries out a tap on a widget. */
export async function runWidgetAction(a: WidgetAction): Promise<void> {
  await whenLoaded();
  const ui = useUi.getState();
  const day = parseDay(a.day);
  switch (a.action) {
    case 'open': {
      clearView();
      if (a.view === 'tasks') {
        useSettings.getState().update({ tasksPanelOpen: true });
        return;
      }
      ui.goTo(day ?? new Date(), a.view === 'day' || a.view === 'agenda' ? a.view : undefined);
      return;
    }
    case 'event': {
      clearView();
      const at = day ?? (typeof a.start === 'number' && Number.isFinite(a.start) ? new Date(a.start) : undefined);
      const occ = a.key && at ? findOccurrence(a.key, at) : undefined;
      if (!occ) {
        if (at) ui.goTo(at, 'day');
        ui.toast(t('widget.missing'), 'info');
        return;
      }
      ui.goTo(occ.start, 'day');
      // As a search result opens one: no chip of it is on screen to point at.
      ui.openPopover({ occurrence: occ, anchor: { x: (typeof window === 'undefined' ? 0 : window.innerWidth) / 2 - 190, y: 120, width: 0, height: 0 } });
      return;
    }
    case 'newEvent': {
      clearView();
      const slot = nextSlot();
      const start = day && day.getTime() !== startOfDay(new Date()).getTime() ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.getHours(), slot.getMinutes()) : slot;
      ui.goTo(start);
      openNewEvent(start);
      return;
    }
    case 'newTask':
      clearView();
      openNewTask();
      return;
    case 'task':
    case 'taskDone': {
      const task = a.key ? findTask(a.key) : undefined;
      if (!task) {
        ui.toast(t('widget.missing'), 'info');
        return;
      }
      if (a.action === 'task') {
        clearView();
        openEditTask(task);
      } else if (!task.completed) {
        await markTaskDone(task);
      }
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Keeping the widgets' snapshot current

const PUSH_DELAY_MS = 2000;

let placed = 0;
let lastSent = '';
let lastDay = '';
let timer: ReturnType<typeof setTimeout> | undefined;

async function push(): Promise<void> {
  if (!placed || !useData.getState().hydrated) return;
  const now = new Date();
  const snapshot = buildSnapshot(now);
  // Sent again only when something in it changed (or a new day moved its range).
  const same = JSON.stringify({ ...snapshot, made: 0 });
  if (same === lastSent) return;
  const { widgets } = await Widgets.setSnapshot({ snapshot });
  placed = widgets;
  lastSent = same;
  lastDay = format(now, DAY);
}

/** Sends a new snapshot soon, after a burst of changes has settled. */
export function refreshWidgets(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void push().catch((err) => console.warn('Updating the widgets failed', err instanceof Error ? err.name : 'error')), PUSH_DELAY_MS);
}

/** Asks how many widgets are placed; with none, nothing is kept for them. */
async function countWidgets(): Promise<void> {
  const { widgets } = await Widgets.getStatus();
  placed = widgets;
  if (widgets) {
    lastSent = '';
    refreshWidgets();
  } else if (lastSent !== 'cleared') {
    await Widgets.clear();
    lastSent = 'cleared';
  }
}

/**
 * Starts feeding the widgets and taking their taps (Android only). Returns a
 * function that stops it.
 */
export function startWidgets(): () => void {
  if (!isAndroid) return () => {};
  void countWidgets().catch(() => {});
  const unsubData = useData.subscribe((s, prev) => {
    if (s.revision !== prev.revision || s.calendars !== prev.calendars || s.hydrated !== prev.hydrated) refreshWidgets();
  });
  const unsubSettings = useSettings.subscribe((s, prev) => {
    if (s.language !== prev.language || s.deviceLanguage !== prev.deviceLanguage || s.timeFormat !== prev.timeFormat || s.weekStartsOn !== prev.weekStartsOn || s.myEmails !== prev.myEmails) refreshWidgets();
  });
  const handles = [
    Widgets.addListener('widgetsChanged', () => void countWidgets().catch(() => {})),
    Widgets.addListener('widgetAction', (action) => void runWidgetAction(action).catch((err) => console.warn('A widget action failed', err instanceof Error ? err.name : 'error'))),
    // Back in front on another day: the range moves with it.
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && lastDay && lastDay !== format(new Date(), DAY)) refreshWidgets();
    }),
  ];
  const daily = setInterval(() => {
    if (lastDay && lastDay !== format(new Date(), DAY)) refreshWidgets();
  }, 3600_000);
  return () => {
    unsubData();
    unsubSettings();
    clearInterval(daily);
    clearTimeout(timer);
    for (const h of handles) void h.then((l) => l.remove()).catch(() => {});
  };
}
