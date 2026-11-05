// Notifications that stay (src/lib/persistent.ts) until they are dealt with.
// The native engine and this page keep each one up after it was shown and
// name it by its reminder key; this module says which have been dealt with in
// the calendar itself: a task completed or deleted, an event deleted, moved or
// cancelled, or the choice turned off. Those are taken down.
//
// Two forms of key name an item: the app's ("<object URL>[#<recurrence id>]
// |<item time>|<minutes>") and that of Android's background refresh of CalDAV
// calendars ("<calendar id>|<UID>|<item time>|<offset>"). A snoozed copy adds
// "|snooze<time>".
//
// A notification is taken down only on good grounds: the item's calendar was
// brought up to date since this page started or woke (else another device may
// have changed it, and what the store holds says nothing), or this page saw the
// item still open and then changed (completed here, say, while offline).
import { t } from '@/i18n';
import { getParsedObject } from '@/hooks/useCalendarData';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { markTaskDone } from './actions';
import { expandEvent } from './ical/events';
import { parseObject, type ParsedObject } from './ical/parse';
import { readTask } from './ical/tasks';
import { selfEmailsByAccount } from './identity';

/** Where a standing notification's item is: open, dealt with, or not found in any calendar. */
export type StandingState = 'open' | 'finished' | 'gone';

interface Found {
  obj: ParsedObject;
  calendar: Calendar | undefined;
}

/** The item part and the item's time of a reminder key, or undefined for a key of another form (a test). */
export function splitReminderKey(key: string): { item: string; time: number } | undefined {
  const m = /^(.+)\|(-?\d+)\|(-?\d+)$/s.exec(key.replace(/\|snooze\d+$/, ''));
  return m ? { item: m[1], time: Number(m[2]) } : undefined;
}

function findItem(item: string): Found | undefined {
  const { calendars, objects } = useData.getState();
  const calendarOf = (obj: ParsedObject) => calendars.find((c) => c.id === obj.calendarId);
  // The app's form: the object's URL, of an event's instance with its recurrence id.
  for (const url of [item, item.slice(0, Math.max(0, item.lastIndexOf('#')))]) {
    const obj = url ? getParsedObject(url) : null;
    if (obj) return { obj, calendar: calendarOf(obj) };
  }
  // The background refresh's form: the calendar's id and the UID.
  for (const cal of calendars) {
    if (!item.startsWith(`${cal.id}|`)) continue;
    const uid = item.slice(cal.id.length + 1);
    for (const raw of Object.values(objects[cal.id] ?? {})) {
      const obj = parseObject(raw);
      if (obj?.uid === uid) return { obj, calendar: cal };
    }
  }
  return undefined;
}

/** Whether the item behind a reminder key still wants its notification. */
export function standingState(key: string): StandingState | undefined {
  const parts = splitReminderKey(key);
  if (!parts) return undefined;
  const found = findItem(parts.item);
  if (!found) return 'gone';
  const { obj, calendar } = found;
  if (obj.kind === 'task') {
    const task = readTask(obj);
    if (!task) return undefined;
    // A repeating task that was completed is due on its next date: this one is done.
    const time = (task.due ?? task.start)?.getTime();
    return task.completed || task.status === 'CANCELLED' || !task.persistent || time !== parts.time ? 'finished' : 'open';
  }
  if (obj.kind !== 'event') return undefined;
  const { accounts } = useData.getState();
  const self = calendar && selfEmailsByAccount(accounts, useSettings.getState().myEmails).get(calendar.accountId);
  let occs;
  try {
    occs = expandEvent(obj, new Date(parts.time), new Date(parts.time + 1), self);
  } catch {
    return undefined;
  }
  const occ = occs.find((o) => o.start.getTime() === parts.time);
  return occ && occ.persistent && occ.status !== 'CANCELLED' && occ.selfStatus !== 'DECLINED' ? 'open' : 'finished';
}

/** When this page started or last woke: what a sync brought before may be behind. */
let since = Date.now();

/** The page did not run for a while: the store may be behind again. */
export function noteStandingWoke(at = Date.now()) {
  since = Math.max(since, at);
}

/** Keys this page saw still wanted: a change it then sees is one made since. */
const seenOpen = new Set<string>();

/** Whether what the store holds of these calendars (all of them: undefined) was brought up to date since `since`. */
function current(calendar: Calendar | undefined): boolean {
  const { accounts, calendars, hydrated } = useData.getState();
  if (!hydrated) return false;
  const ids = new Set((calendar ? [calendar] : calendars).map((c) => c.accountId));
  return accounts.filter((a) => (calendar ? ids.has(a.id) : true)).every((a) => a.kind === 'local' || (a.lastSync ?? 0) >= since);
}

/** Of the given standing notifications' keys, those to take down. */
export function finishedStanding(keys: readonly string[]): string[] {
  if (!useData.getState().hydrated) return [];
  const out: string[] = [];
  for (const key of keys) {
    const state = standingState(key);
    if (!state) continue;
    if (state === 'open') {
      seenOpen.add(key);
      continue;
    }
    const parts = splitReminderKey(key)!;
    if (seenOpen.has(key) || current(findItem(parts.item)?.calendar)) {
      seenOpen.delete(key);
      out.push(key);
    }
  }
  return out;
}

/** How long Done waits for a task the store does not hold yet (a sync that started with the app). */
const DONE_WAIT_MS = 60_000;

/**
 * Done on a task's standing notification: the task is marked done, and the
 * notification goes (`clear`) once it is. A task the store does not hold is
 * waited for while syncs bring news, then the notification goes on its own.
 */
export function completeFromReminder(key: string, clear: (keys: string[]) => void | Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    let busy = false;
    let unsub = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (taken: boolean) => {
      unsub();
      clearTimeout(timer);
      if (taken) void Promise.resolve(clear([key])).catch(() => {});
      resolve();
    };
    const attempt = async (last: boolean) => {
      if (busy) return;
      // Data that never loaded leaves the notification to Dismiss.
      if (!useData.getState().hydrated) return last ? finish(false) : undefined;
      const parts = splitReminderKey(key);
      const found = parts && findItem(parts.item);
      const task = found?.obj.kind === 'task' ? readTask(found.obj) : undefined;
      if (!found || (found.obj.kind === 'task' && !task)) {
        if (!last && !(parts && current(undefined))) return;
        useUi.getState().toast(t('reminders.done.missing'), 'info');
        return finish(true);
      }
      // An event has no Done; one that reaches here (an earlier notification) is simply taken down.
      if (!task || task.completed || (task.due ?? task.start)?.getTime() !== parts!.time) return finish(true);
      busy = true;
      seenOpen.add(key);
      // Kept up when the calendar refused the change (it says why); Dismiss takes it down.
      finish(await markTaskDone(task));
    };
    unsub = useData.subscribe((s, prev) => {
      if (s.revision !== prev.revision || s.hydrated !== prev.hydrated) void attempt(false);
    });
    timer = setTimeout(() => void attempt(true), DONE_WAIT_MS);
    void attempt(false);
  });
}
