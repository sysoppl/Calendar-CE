// Reminder scheduling.
//
// * Android: reminders for the next 45 days are handed to a native engine
//   that schedules exact AlarmManager alarms, restores them after reboots,
//   and refreshes server calendars hourly in the background (WorkManager),
//   so reminders fire even when the app is closed or never opened.
// * Web: timers for alarms in the next 24 hours fire Notification API popups
//   (or an in-app toast when permission is missing) while the tab is open.
//
// A notification names the time of its event or task as seen when it is
// shown, not when the reminder was computed: "Today at 18:00", "Tomorrow at
// 9:00", "Thursday at 18:00", further away the short date; an all-day item
// gets the day alone. The place goes on a second line. The Android engine
// words it the same way (reminders/RelativeWhen.java), so it gets the item's
// time rather than a text.
import { differenceInCalendarDays } from 'date-fns';
import { t, resolveLang, translate } from '@/i18n';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { makeFormatter, type Formatter } from '@/hooks/useFormat';
import { expandEvent } from './ical/events';
import { parseObject } from './ical/parse';
import { readTask } from './ical/tasks';
import { selfEmailsByAccount } from './identity';
import { isNative } from './platform';
import { NativeReminders, type NativeReminder } from './nativeReminders';

export interface Reminder {
  id: number;
  key: string;
  calendarId: string;
  at: Date;
  title: string;
  /**
   * The event's start or the task's due time, which the notification words
   * when it is shown (`reminderText`).
   */
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  /** A task: `start` and `end` are both its due time. */
  task?: boolean;
  /**
   * Wall-clock time rather than an instant: the item's time names no zone
   * (all-day events, date-only task dues, times without TZID or UTC) and the
   * trigger is relative to it. Moves with the clock when the zone changes.
   */
  floating?: boolean;
}

const WEB_HORIZON = 24 * 3600000;
export const NATIVE_HORIZON_DAYS = 45;

/** FNV-1a; identical to Reminder.idFor() on Android. */
export function reminderId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) & 0x7fffffff;
}

/**
 * Notifications one event or task may set off (per instance). Anyone can put
 * an item into a calendar the user shows (a feed, an invitation), and its
 * VALARMs as written would otherwise each be a notification in the app's name.
 */
export const MAX_ALARMS_PER_ITEM = 5;

/** Longer titles and places are not shown in a notification: no real item needs one, a message posing as the app might. */
export const MAX_REMINDER_TEXT = 200;

/** The item's distinct reminder offsets, at most `MAX_ALARMS_PER_ITEM`: those nearest its time. */
export function cappedAlarms(offsets: readonly number[]): number[] {
  const distinct = [...new Set(offsets)];
  if (distinct.length <= MAX_ALARMS_PER_ITEM) return distinct;
  return distinct
    .sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)
    .slice(0, MAX_ALARMS_PER_ITEM)
    .sort((a, b) => a - b);
}

/** A notification's title: the item's own, or a plain one for an empty or overlong title. */
function reminderTitle(title: string, task: boolean): string {
  if (title.length > MAX_REMINDER_TEXT) return t(task ? 'reminders.title.task' : 'reminders.title.event');
  return title || t('grid.noTitle');
}

/**
 * How long after its time a reminder this page has not shown yet is still set
 * off: a timer a frozen or throttled tab runs late must not lose its reminder
 * to a recomputation in between. As MISSED_GRACE_MS on Android.
 */
export const LATE_MS = 30 * 60000;

/**
 * A reminder's key: the item, its time and the offset. The item's time is in
 * it so that a reminder of a moved item is a new one, which fires even when
 * the earlier one already did. Earlier versions keyed an event's reminders
 * without its time; for a reminder whose time has passed, Android also counts
 * one shown under that key as shown (ReminderStore.earlierKey), so the change
 * of keys sets off none twice.
 */
export function reminderKey(item: string, time: Date, minutes: number): string {
  return `${item}|${time.getTime()}|${minutes}`;
}

/** Of two instances a fixed trigger at `at` could go with, true when `a` is the better one: the first at or after it, else the last before it. */
function nearerAfter(a: Date, b: Date, at: Date): boolean {
  const aAfter = a >= at;
  if (aAfter !== b >= at) return aAfter;
  return aAfter ? a < b : a > b;
}

/**
 * All reminders that fire between now and now + horizon, for every calendar
 * (hidden calendars still remind you; hiding only declutters the view), or
 * for the calendars `only` picks. With `lateMs`, also those that came due
 * that long before now (see LATE_MS).
 */
export function computeReminders(now: Date, horizonMs: number, only?: (calendar: Calendar) => boolean, lateMs = 0): Reminder[] {
  const { accounts, calendars, objects } = useData.getState();
  const s = useSettings.getState();
  const self = selfEmailsByAccount(accounts, s.myEmails);
  const from = new Date(now.getTime() - lateMs);
  const end = new Date(now.getTime() + horizonMs);
  // Look ahead far enough for alarms set up to 4 weeks in advance.
  const expandEnd = new Date(end.getTime() + 28 * 86400000);
  const out: Reminder[] = [];

  for (const cal of calendars) {
    if (only && !only(cal)) continue;
    for (const raw of Object.values(objects[cal.id] ?? {})) {
      const obj = parseObject(raw);
      if (!obj) continue;
      if (obj.kind === 'event') {
        let occs;
        try {
          occs = expandEvent(obj, from, expandEnd, self.get(cal.accountId));
        } catch {
          continue;
        }
        // A trigger at a fixed instant fires once, not once per instance of a
        // series: it goes with the instance it is nearest before (RFC 5545 3.8.6.3).
        const fixed = new Map<number, Reminder>();
        for (const occ of occs) {
          // No reminders for cancelled events or invitations the user declined.
          if (occ.status === 'CANCELLED' || occ.selfStatus === 'DECLINED') continue;
          for (const minutes of cappedAlarms(occ.alarms)) {
            const at = new Date(occ.start.getTime() - minutes * 60000);
            if (at < from || at > end) continue;
            const key = reminderKey(occ.key, occ.start, minutes);
            const reminder: Reminder = {
              id: reminderId(key),
              key,
              calendarId: cal.id,
              at,
              title: reminderTitle(occ.title, false),
              start: occ.start,
              end: occ.end,
              allDay: occ.allDay,
              location: (occ.location.length <= MAX_REMINDER_TEXT && occ.location) || undefined,
              floating: occ.floating && !occ.fixedAlarms?.includes(minutes),
            };
            if (!occ.fixedAlarms?.includes(minutes)) out.push(reminder);
            else {
              const other = fixed.get(at.getTime());
              if (!other || nearerAfter(occ.start, other.start, at)) fixed.set(at.getTime(), reminder);
            }
          }
        }
        out.push(...fixed.values());
      } else if (obj.kind === 'task') {
        const task = readTask(obj);
        if (!task || task.completed || !task.due) continue;
        for (const minutes of cappedAlarms(task.alarms)) {
          const at = new Date(task.due.getTime() - minutes * 60000);
          if (at < from || at > end) continue;
          const key = reminderKey(task.objectUrl, task.due, minutes);
          out.push({
            id: reminderId(key),
            key,
            calendarId: cal.id,
            at,
            title: reminderTitle(task.title, true),
            start: task.due,
            end: task.due,
            allDay: task.dueAllDay,
            task: true,
            floating: !!task.dueFloating,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Days ahead that a notification names by their weekday; a week ahead would share today's name. */
const WEEKDAY_NAMES_UP_TO = 6;

/** The formatter of the interface's language and clock, as the settings have them now. */
function currentFormatter(): Formatter {
  const s = useSettings.getState();
  return makeFormatter(resolveLang(s), s.timeFormat);
}

/**
 * The time of an event or a task as a notification shown at `now` names it:
 * today, tomorrow and yesterday by name ("Today at 18:00", "Jutro o godzinie
 * 9:00"), the rest of the coming week by the weekday ("Thursday at 18:00",
 * "czwartek o godzinie 18:00"), anything further by the short date, with the
 * year when it is another one. An all-day item gets the day alone. As
 * RelativeWhen.java does on Android.
 */
export function whenText(start: Date, allDay: boolean, now: Date, fmt: Formatter = currentFormatter()): string {
  const days = differenceInCalendarDays(start, now);
  let day: string;
  if (days === 0) day = translate(fmt.lang, 'reminders.when.today');
  else if (days === 1) day = translate(fmt.lang, 'reminders.when.tomorrow');
  else if (days === -1) day = translate(fmt.lang, 'reminders.when.yesterday');
  else if (days > 1 && days <= WEEKDAY_NAMES_UP_TO) day = fmt.date(start, { weekday: 'long' });
  else day = fmt.date(start, { day: 'numeric', month: 'short', year: start.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  return allDay ? day : translate(fmt.lang, 'reminders.when.at', { day, time: fmt.time(start) });
}

/** The text of a reminder's notification shown at `now`: the item's time, and its place on a second line. */
export function reminderText(r: Reminder, now: Date, fmt: Formatter = currentFormatter()): string {
  return [whenText(r.start, r.allDay, now, fmt), r.location].filter(Boolean).join('\n');
}

/**
 * A reminder as the native engine takes it: the item's time, which the
 * notification words when it is shown, and the place as the line below it.
 */
export function toNativeReminder(r: Reminder): NativeReminder {
  const item: NativeReminder = { key: r.key, at: r.at.getTime(), title: r.title, body: r.location ?? '', start: r.start.getTime() };
  if (r.allDay) item.allDay = true;
  if (r.floating) item.floating = true;
  return item;
}

// -----------------------------------------------------------------------------
// Permissions

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function notificationPermission(): Promise<PermissionState> {
  if (isNative) {
    try {
      return (await NativeReminders.getStatus()).permission;
    } catch {
      return 'prompt';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (isNative) return (await NativeReminders.requestNotificationPermission()).permission;
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission();
  return p === 'default' ? 'prompt' : p;
}

/** The app icon of a web notification, and the white drawing for the small badge (scripts/render-icons.mjs). */
export const NOTIFICATION_ICON = '/icons/icon-192.png';
export const NOTIFICATION_BADGE = '/icons/badge-96.png';

function show(title: string, body: string) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE, tag: title });
      return;
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
  useUi.getState().toast(`${title} — ${body.split('\n')[0]}`, 'info');
}

export async function showTestNotification() {
  if (isNative) {
    await NativeReminders.testNotification({ delaySeconds: 5, title: t('app.name'), body: t('settings.testNotification') });
    return;
  }
  show(t('app.name'), t('settings.testNotification'));
}

// -----------------------------------------------------------------------------
// Schedulers

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const fired = new Set<string>();
/** When this page began to set off reminders: a late one is one it set up and missed, not one from before it opened. */
let webSince: number | undefined;

function scheduleWeb(enabled: boolean) {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (!enabled) return;
  const now = new Date();
  webSince ??= now.getTime();
  for (const r of computeReminders(now, WEB_HORIZON, undefined, Math.min(LATE_MS, Math.max(0, now.getTime() - webSince)))) {
    if (fired.has(r.key)) continue;
    timers.set(
      r.key,
      setTimeout(() => {
        fired.add(r.key);
        // Worded now: set up last night, "Tomorrow" is "Today" by the time it shows.
        show(r.title, reminderText(r, new Date()));
      }, Math.max(0, r.at.getTime() - Date.now())),
    );
  }
}

async function scheduleNative(enabled: boolean) {
  const sets: Record<string, NativeReminder[]> = {};
  // Every calendar gets an entry (possibly empty) so removed reminders are cleared.
  for (const cal of useData.getState().calendars) sets[cal.id] = [];
  if (enabled) {
    // From now on: the native store keeps a late one it has not shown yet
    // itself (ReminderStore.withLate). It knows which it showed, also under
    // the background worker's keys, which are not these.
    for (const r of computeReminders(new Date(), NATIVE_HORIZON_DAYS * 86400000)) sets[r.calendarId].push(toNativeReminder(r));
  }
  await NativeReminders.setReminders({ sets, enabled });
}

/** Gives the native background worker what it needs to refresh server calendars. */
async function pushSyncConfig() {
  const { accounts, calendars, hydrated } = useData.getState();
  // Passwords are unwrapped while the store loads; a list sent before that
  // would hand the worker accounts it cannot sign in to.
  if (!hydrated) return;
  const enabled = useSettings.getState().notificationsEnabled;
  await NativeReminders.setSyncConfig({
    config: {
      enabled,
      horizonDays: NATIVE_HORIZON_DAYS,
      calendars: calendars.flatMap((c) => {
        // No credentials leave the web layer while reminders are switched off.
        if (!enabled) return [];
        const account = accounts.find((a) => a.id === c.accountId);
        // The worker speaks CalDAV only; local calendars never change behind our back.
        if (!c.url || account?.kind !== 'caldav' || account.password === undefined) return [];
        return [
          {
            key: c.id,
            name: c.name,
            url: c.url,
            username: account.username ?? '',
            password: account.password,
            visible: true,
            components: c.components,
          },
        ];
      }),
    },
  });
}

let debounce: ReturnType<typeof setTimeout> | undefined;

/** Recomputes reminders; call whenever data or settings change. */
export function rescheduleReminders() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    // Never push before local data is loaded: an empty list would cancel
    // every alarm (including ones from the background worker). Hydration
    // bumps the revision, which calls us again.
    if (!useData.getState().hydrated) return;
    const enabled = useSettings.getState().notificationsEnabled;
    if (isNative) void scheduleNative(enabled).catch((err) => console.warn('Scheduling reminders failed', err));
    else scheduleWeb(enabled);
  }, 1000);
}

/**
 * Starts watching the store and refreshes the schedule hourly. Asking for the
 * notification permission is `startNotificationAccess`'s (lib/notificationAccess.ts).
 */
export function startReminders(): () => void {
  rescheduleReminders();
  if (isNative) void pushSyncConfig().catch(() => {});
  const unsubData = useData.subscribe((s, prev) => {
    if (s.revision !== prev.revision || s.calendars !== prev.calendars) rescheduleReminders();
    if (isNative && (s.accounts !== prev.accounts || s.calendars !== prev.calendars || s.hydrated !== prev.hydrated)) void pushSyncConfig().catch(() => {});
  });
  const unsubSettings = useSettings.subscribe((s, prev) => {
    if (s.notificationsEnabled !== prev.notificationsEnabled || s.language !== prev.language || s.deviceLanguage !== prev.deviceLanguage || s.timeFormat !== prev.timeFormat || s.myEmails !== prev.myEmails) {
      rescheduleReminders();
      if (isNative) void pushSyncConfig().catch(() => {});
    }
  });
  const hourly = setInterval(rescheduleReminders, 3600000);
  return () => {
    unsubData();
    unsubSettings();
    clearInterval(hourly);
  };
}
