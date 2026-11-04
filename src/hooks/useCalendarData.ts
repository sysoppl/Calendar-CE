import { useMemo } from 'react';
import { expandEvent } from '@/lib/ical/events';
import { errorKind, parseObject, type ParsedObject } from '@/lib/ical/parse';
import { readTask } from '@/lib/ical/tasks';
import type { Occurrence, Task } from '@/lib/ical/types';
import type { Range } from '@/lib/date';
import { selfEmailsByAccount } from '@/lib/identity';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';

export function useCalendarMap(): Map<string, Calendar> {
  const calendars = useData((s) => s.calendars);
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
}

/** The user's own addresses for each account (see `selfEmailsByAccount`). */
export function useSelfEmails(): Map<string, Set<string>> {
  const accounts = useData((s) => s.accounts);
  const myEmails = useSettings((s) => s.myEmails);
  return useMemo(() => selfEmailsByAccount(accounts, myEmails), [accounts, myEmails]);
}

/** Non-reactive variant for a single calendar. */
export function selfEmailsFor(calendarId: string): Set<string> {
  const { accounts, calendars } = useData.getState();
  const accountId = calendars.find((c) => c.id === calendarId)?.accountId;
  return selfEmailsByAccount(accounts, useSettings.getState().myEmails).get(accountId ?? '') ?? new Set();
}

/** The events in `range`; none, at no cost, without a range (a period that is not drawn just now). */
export function useOccurrences(range: Range | null): Occurrence[] {
  const calendars = useData((s) => s.calendars);
  const objects = useData((s) => s.objects);
  const self = useSelfEmails();
  const showDeclined = useSettings((s) => s.showDeclinedEvents);
  const startMs = range ? range.start.getTime() : NaN;
  const endMs = range ? range.end.getTime() : NaN;
  return useMemo(() => {
    if (Number.isNaN(startMs)) return [];
    const start = new Date(startMs);
    const end = new Date(endMs);
    const out: Occurrence[] = [];
    for (const cal of calendars) {
      if (!cal.visible || !cal.components.includes('VEVENT')) continue;
      for (const raw of Object.values(objects[cal.id] ?? {})) {
        const obj = parseObject(raw);
        if (obj?.kind !== 'event') continue;
        try {
          for (const occ of expandEvent(obj, start, end, self.get(cal.accountId))) {
            if (showDeclined || occ.selfStatus !== 'DECLINED') out.push(occ);
          }
        } catch (err) {
          console.warn('Could not expand an event', errorKind(err));
        }
      }
    }
    return out.sort(
      (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()),
    );
  }, [calendars, objects, self, showDeclined, startMs, endMs]);
}

export function useTasks(opts: { includeHidden?: boolean } = {}): Task[] {
  const calendars = useData((s) => s.calendars);
  const objects = useData((s) => s.objects);
  const includeHidden = !!opts.includeHidden;
  return useMemo(() => {
    const out: Task[] = [];
    for (const cal of calendars) {
      if (!cal.components.includes('VTODO')) continue;
      if (!includeHidden && !cal.visible) continue;
      for (const raw of Object.values(objects[cal.id] ?? {})) {
        const obj = parseObject(raw);
        if (obj?.kind !== 'task') continue;
        const task = readTask(obj);
        if (task) out.push(task);
      }
    }
    return out;
  }, [calendars, objects, includeHidden]);
}

/** Looks up and parses a single object from the store (non-reactive). */
/** How far from where it was an instance of a series is looked for again (`currentOccurrence`). */
const MOVED_WITHIN_MS = 366 * 86400000;

/**
 * An occurrence as the store has it now: a sync may have moved the event
 * since `occ` was read. An instance of a series is looked for by its key
 * within a year of where it was; undefined when it is not there any more.
 */
export function currentOccurrence(occ: Occurrence): Occurrence | undefined {
  const obj = getParsedObject(occ.objectUrl);
  if (obj?.kind !== 'event') return undefined;
  const from = occ.recurrenceId ? new Date(occ.start.getTime() - MOVED_WITHIN_MS) : new Date(-8.64e15);
  const to = occ.recurrenceId ? new Date(occ.end.getTime() + MOVED_WITHIN_MS) : new Date(8.64e15);
  try {
    return expandEvent(obj, from, to, selfEmailsFor(occ.calendarId)).find((o) => o.key === occ.key);
  } catch {
    return undefined;
  }
}

export function getParsedObject(url: string): ParsedObject | null {
  const { objects } = useData.getState();
  for (const map of Object.values(objects)) {
    const raw = map[url];
    if (raw) return parseObject(raw);
  }
  return null;
}
