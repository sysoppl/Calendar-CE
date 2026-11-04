// VTODO support.
import ICAL from 'ical.js';
import { addMissingTimezones, relatedToEnd } from './events';
import { cloneRoot, errorKind, newUid, wrapCalendar, type ParsedObject } from './parse';
import { applyRecurrence, budgetRecurrence, readRecurrence, recurToIcal } from './recurrence';
import { dateToIcal, nowUtc, setTextProp, setTimeProp, startOfLocalDay, zoneOf } from './time';
import { localTimezone } from './timezone';
import type { Task, TaskData, TaskStatus } from './types';

function todoOf(root: ICAL.Component): ICAL.Component | undefined {
  const todos = root.getAllSubcomponents('vtodo');
  return todos.find((c) => !c.hasProperty('recurrence-id')) ?? todos[0];
}

function timeValue(comp: ICAL.Component, name: string): ICAL.Time | undefined {
  const v = comp.getFirstPropertyValue(name);
  return v instanceof ICAL.Time ? v : undefined;
}

function readStatus(comp: ICAL.Component): TaskStatus {
  const s = String(comp.getFirstPropertyValue('status') ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'IN-PROCESS' || s === 'CANCELLED') return s;
  return 'NEEDS-ACTION';
}

/**
 * A task's reminders as the editor shows them, in minutes before the due
 * time, and the VALARMs they come from. A trigger relative to the start (as
 * RELATED is when not given) counts from DTSTART, one relative to the end
 * from DUE (RFC 5545 3.8.6.3); a task without DTSTART has both count from
 * DUE, as other apps read them. A trigger at a fixed instant, and any of a
 * task without a due time, is not shown; saving keeps those as written.
 */
function readTaskAlarms(comp: ICAL.Component): { alarms: number[]; shown: Set<ICAL.Component> } {
  const due = timeValue(comp, 'due');
  const start = timeValue(comp, 'dtstart');
  const alarms: number[] = [];
  const shown = new Set<ICAL.Component>();
  for (const a of comp.getAllSubcomponents('valarm')) {
    const trigger = a.getFirstProperty('trigger');
    // Read also without a due time: a trigger that cannot be read makes the task one that cannot be.
    const value = trigger?.getFirstValue();
    if (!due || !(value instanceof ICAL.Duration)) continue;
    const fromStart = !relatedToEnd(trigger!) && start ? (due.toJSDate().getTime() - start.toJSDate().getTime()) / 60000 : 0;
    alarms.push(Math.round(fromStart - value.toSeconds() / 60));
    shown.add(a);
  }
  return { alarms, shown };
}

export function readTaskData(comp: ICAL.Component): TaskData {
  const due = timeValue(comp, 'due');
  const start = timeValue(comp, 'dtstart');
  const completedAt = timeValue(comp, 'completed');
  const status = readStatus(comp);
  const { alarms } = readTaskAlarms(comp);
  const related = comp
    .getAllProperties('related-to')
    .find((p) => !p.getParameter('reltype') || String(p.getParameter('reltype')).toUpperCase() === 'PARENT');
  return {
    uid: String(comp.getFirstPropertyValue('uid') ?? ''),
    title: String(comp.getFirstPropertyValue('summary') ?? ''),
    description: String(comp.getFirstPropertyValue('description') ?? ''),
    due: due?.toJSDate(),
    dueAllDay: due?.isDate ?? false,
    start: start?.toJSDate(),
    completed: status === 'COMPLETED' || !!completedAt,
    completedAt: completedAt?.toJSDate(),
    status,
    priority: Number(comp.getFirstPropertyValue('priority') ?? 0) || 0,
    percent: Number(comp.getFirstPropertyValue('percent-complete') ?? 0) || 0,
    categories: comp
      .getAllProperties('categories')
      .flatMap((p) => p.getValues().map(String))
      .filter(Boolean),
    parentUid: related ? String(related.getFirstValue()) : undefined,
    ...readRecurrence(comp),
    alarms,
    created: timeValue(comp, 'created')?.toJSDate(),
    modified: timeValue(comp, 'last-modified')?.toJSDate(),
  };
}

/**
 * The task in an object, or undefined when there is none or it cannot be
 * read. ical.js decodes values only when they are asked for, so a malformed
 * DUE or TRIGGER parses fine and throws here; one such item in a feed must
 * not take every list and view down with it.
 */
export function readTask(obj: ParsedObject): Task | undefined {
  const comp = todoOf(obj.root);
  if (!comp) return undefined;
  let data: TaskData;
  let dueFloating: boolean;
  let zone: string | undefined;
  try {
    data = readTaskData(comp);
    const due = timeValue(comp, 'due');
    dueFloating = !!due && zoneOf(due) === 'floating';
    const anchor = timeValue(comp, 'dtstart') ?? due;
    zone = anchor && !anchor.isDate ? zoneOf(anchor) : undefined;
  } catch (err) {
    console.warn('Could not read task', errorKind(err));
    return undefined;
  }
  return { ...data, objectUrl: obj.url, calendarId: obj.calendarId, etag: obj.etag, isRecurring: !!(data.rrule || data.ruleAsWritten), dueFloating, zone };
}

function applyTaskData(comp: ICAL.Component, data: TaskData) {
  // Read before the dates change: what the editor showed is what it replaces.
  let shownAlarms: Set<ICAL.Component>;
  try {
    shownAlarms = readTaskAlarms(comp).shown;
  } catch {
    shownAlarms = new Set();
  }
  setTextProp(comp, 'summary', data.title.trim());
  setTextProp(comp, 'description', data.description);
  const tz = localTimezone();

  if (data.due) setTimeProp(comp, 'due', dateToIcal(data.due, tz, data.dueAllDay));
  else comp.removeAllProperties('due');
  if (data.start) setTimeProp(comp, 'dtstart', dateToIcal(data.start, tz, data.dueAllDay));
  else comp.removeAllProperties('dtstart');
  comp.removeAllProperties('duration');

  const status: TaskStatus = data.completed ? 'COMPLETED' : data.status === 'COMPLETED' ? 'NEEDS-ACTION' : data.status;
  comp.updatePropertyWithValue('status', status);
  if (data.completed) {
    comp.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(data.completedAt ?? new Date(), true));
    comp.updatePropertyWithValue('percent-complete', 100);
  } else {
    comp.removeAllProperties('completed');
    // 100 is kept too: a task can be all done and not yet marked as completed.
    const percent = Math.min(100, Math.round(data.percent));
    if (percent > 0) comp.updatePropertyWithValue('percent-complete', percent);
    else comp.removeAllProperties('percent-complete');
  }

  if (data.priority > 0) comp.updatePropertyWithValue('priority', data.priority);
  else comp.removeAllProperties('priority');

  comp.removeAllProperties('categories');
  if (data.categories.length) {
    const prop = new ICAL.Property('categories');
    prop.setValues(data.categories);
    comp.addProperty(prop);
  }

  // An unchanged rule, or one the editor could only show, stays as written
  // (see applyRecurrence); without a date to repeat from there is none.
  applyRecurrence(comp, data.due || data.start ? data : {}, data.dueAllDay);

  const parentProps = comp
    .getAllProperties('related-to')
    .filter((p) => !p.getParameter('reltype') || String(p.getParameter('reltype')).toUpperCase() === 'PARENT');
  parentProps.forEach((p) => comp.removeProperty(p));
  if (data.parentUid) comp.addPropertyWithValue('related-to', data.parentUid);

  for (const a of comp.getAllSubcomponents('valarm')) if (shownAlarms.has(a)) comp.removeSubcomponent(a);
  if (data.due) {
    for (const minutes of data.alarms) {
      const alarm = new ICAL.Component('valarm');
      alarm.updatePropertyWithValue('action', 'DISPLAY');
      alarm.updatePropertyWithValue('description', data.title || 'Task');
      const trigger = new ICAL.Property('trigger');
      trigger.setValue(ICAL.Duration.fromSeconds(-minutes * 60));
      trigger.setParameter('related', 'END');
      alarm.addProperty(trigger);
      comp.addSubcomponent(alarm);
    }
  }

  const now = nowUtc();
  comp.updatePropertyWithValue('dtstamp', now);
  comp.updatePropertyWithValue('last-modified', now);
  comp.updatePropertyWithValue('sequence', Number(comp.getFirstPropertyValue('sequence') ?? 0) + 1);
}

function serialize(root: ICAL.Component) {
  addMissingTimezones(root);
  return root.toString() + '\r\n';
}

export function emptyTask(over: Partial<TaskData> = {}): TaskData {
  return {
    uid: newUid(),
    title: '',
    description: '',
    dueAllDay: true,
    completed: false,
    status: 'NEEDS-ACTION',
    priority: 0,
    percent: 0,
    categories: [],
    alarms: [],
    ...over,
  };
}

export function createTaskIcs(data: TaskData): string {
  const todo = new ICAL.Component('vtodo');
  todo.updatePropertyWithValue('uid', data.uid || newUid());
  todo.updatePropertyWithValue('created', nowUtc());
  applyTaskData(todo, data);
  todo.updatePropertyWithValue('sequence', 0);
  return serialize(wrapCalendar(todo));
}

export function updateTaskIcs(obj: ParsedObject, data: TaskData): string {
  const root = cloneRoot(obj);
  const comp = todoOf(root);
  if (!comp) throw new Error('Object does not contain a task');
  applyTaskData(comp, data);
  return serialize(root);
}

/**
 * Toggles completion. Completing a recurring task advances it to the next
 * occurrence instead (the common behaviour of Thunderbird, Tasks.org, etc.).
 * A COUNT goes on with the instances left: those passed are used up, and the
 * task is completed once none is.
 */
export function setTaskCompleted(obj: ParsedObject, completed: boolean): string {
  const root = cloneRoot(obj);
  const comp = todoOf(root);
  if (!comp) throw new Error('Object does not contain a task');
  const data = readTaskData(comp);
  const recur = comp.getFirstPropertyValue('rrule');
  const anchor = timeValue(comp, 'dtstart') ?? timeValue(comp, 'due');

  if (completed && recur instanceof ICAL.Recur && anchor) {
    const iter = recur.iterator(anchor);
    // A rule that takes too long to get to today (one that never matches, or
    // every second since last year) runs out of budget: the task is then
    // simply completed.
    budgetRecurrence([iter]);
    let next: ICAL.Time | null = iter.next(); // the anchor itself
    // An all-day task due today is not overdue yet.
    const now = anchor.isDate ? startOfLocalDay(new Date()).getTime() : Date.now();
    const due = timeValue(comp, 'due');
    const offset = due ? due.toJSDate().getTime() - anchor.toJSDate().getTime() : 0;
    // Skip to the first occurrence after the current one (and after today for overdue tasks).
    let passed = 0;
    do {
      next = iter.next();
      passed++;
    } while (next && next.toJSDate().getTime() + offset < Math.max(now, anchor.toJSDate().getTime() + 1));
    if (next) {
      const nextDate = next.toJSDate();
      const shifted: TaskData = {
        ...data,
        completed: false,
        status: 'NEEDS-ACTION',
        percent: 0,
        start: data.start ? nextDate : undefined,
        due: data.due ? (data.start ? keepDistance(nextDate, data.start, data.due) : nextDate) : undefined,
      };
      applyTaskData(comp, shifted);
      const rule = comp.getFirstProperty('rrule');
      const kept = rule?.getFirstValue();
      if (recur.count && kept instanceof ICAL.Recur) {
        const rest = kept.clone();
        rest.count = recur.count - passed;
        rule!.setValue(rest);
      }
      return serialize(root);
    }
  }

  // A reopened task starts again from nothing, not from the 100 its completion wrote.
  const percent = completed || data.percent < 100 ? data.percent : 0;
  applyTaskData(comp, { ...data, completed, completedAt: completed ? new Date() : undefined, status: completed ? 'COMPLETED' : 'NEEDS-ACTION', percent });
  return serialize(root);
}

/** Subtasks shown below one another at most this deep; deeper ones are not shown under their parent. */
export const MAX_TASK_DEPTH = 16;

/** A task's key in a tree: UIDs are unique within one list only. */
export const taskKey = (task: Pick<Task, 'calendarId' | 'uid'>) => `${task.calendarId}|${task.uid}`;

/** A task's key among the calendar's items: a repeating task is there once for each of its dates. */
export const taskItemKey = (task: Task) => (task.upcomingOf && task.due ? `${task.objectUrl}@${task.due.getTime()}` : task.objectUrl);

/** At most this many later dates of one repeating task in one range (a daily task over a year view). */
const MAX_UPCOMING = 400;

/**
 * The due date `at` gives a task whose rule counts from `anchor`, its start:
 * the same number of calendar days after it as `due` is after `anchor`, at
 * `due`'s time of day, so that a change of clocks between them neither moves
 * it by an hour nor an all-day one onto another day.
 */
function keepDistance(at: Date, anchor: Date, due: Date): Date {
  const days = Math.round((Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) / 86_400_000);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days, due.getHours(), due.getMinutes(), due.getSeconds());
}

/**
 * The tasks the calendar shows from `start` to `end`, at their due dates. An
 * open repeating task shows on its later dates too, as copies with
 * `upcomingOf` set: a task that repeats every month is on that day of every
 * month, and is due on the first of them. Only dates still to come get a
 * copy: ticking off an overdue task moves it past today (`setTaskCompleted`),
 * so the dates between are never due. A rule the editor cannot show
 * (`ruleAsWritten`) gives the first date only.
 */
export function tasksInRange(tasks: readonly Task[], start: Date, end: Date, showCompleted: boolean, now = new Date()): Task[] {
  const out: Task[] = [];
  for (const task of tasks) {
    const due = task.due;
    if (!due || (task.completed && !showCompleted)) continue;
    if (due >= start && due < end) out.push(task);
    if (!task.rrule || task.completed || due >= end) continue;
    const today = task.dueAllDay ? startOfLocalDay(now) : now;
    const from = new Date(Math.max(start.getTime(), today.getTime()));
    for (const later of laterDates(task, task.rrule, due, from, end)) out.push({ ...task, ...later, upcomingOf: task });
  }
  return out;
}

/** The dates (start, due) after `due`, from `from` and before `end`, that `rule` gives a task. */
function laterDates(task: Task, rule: NonNullable<Task['rrule']>, due: Date, from: Date, end: Date): { start?: Date; due: Date }[] {
  // The rule counts from the start where there is one (RFC 5545), in the zone it is written in.
  const anchor = task.start ?? due;
  const out: { start?: Date; due: Date }[] = [];
  try {
    // Read back from its text: a rule built from data has no INTERVAL, which the iterator cannot step by.
    const iter = ICAL.Recur.fromString(recurToIcal(rule, task.dueAllDay).toString()).iterator(dateToIcal(anchor, task.zone ?? localTimezone(), task.dueAllDay));
    budgetRecurrence([iter]);
    iter.next(); // the anchor itself: the task
    // Only the dates shown count towards the limit; those before `from` are passed over.
    for (let next = iter.next(); next && out.length < MAX_UPCOMING; next = iter.next()) {
      const at = next.toJSDate();
      const dueAt = task.start ? keepDistance(at, anchor, due) : at;
      if (dueAt >= end) break;
      if (dueAt > due && dueAt >= from) out.push({ start: task.start ? at : undefined, due: dueAt });
    }
  } catch (err) {
    console.warn('Could not repeat task', errorKind(err));
  }
  return out;
}

/**
 * Tasks as a tree (in the order given): the roots, and the subtasks of each
 * task's key. RELATED-TO comes from calendar data and may say anything: a
 * task naming its own UID (or a UID two tasks share), a cycle (A under B,
 * B under A) or a chain deeper than `MAX_TASK_DEPTH`. Such a task is shown as
 * a root instead, so no cycle hides a task and walking the tree always ends.
 */
export function taskTree(tasks: readonly Task[]): { roots: Task[]; childrenOf: Map<string, Task[]> } {
  const present = new Set(tasks.map(taskKey));
  const parentKeyOf = (task: Task) => (task.parentUid ? `${task.calendarId}|${task.parentUid}` : undefined);
  // Keys a chain may end at: one of their tasks has no parent here (with a UID several tasks share, any of them).
  const anchored = new Set<string>();
  // The parent of each other key; with a UID several tasks share, that of the first.
  const parentOf = new Map<string, string>();
  for (const task of tasks) {
    const key = taskKey(task);
    const up = parentKeyOf(task);
    if (!up || up === key || !present.has(up)) anchored.add(key);
    else if (!parentOf.has(key)) parentOf.set(key, up);
  }
  /** Whether going up from `key` reaches a task without a parent here, in a few steps and without coming back. */
  const reachesRoot = (start: string, own: string): boolean => {
    const seen = new Set([own]);
    let key: string | undefined = start;
    for (let depth = 1; depth < MAX_TASK_DEPTH; depth++) {
      if (seen.has(key)) return false;
      if (anchored.has(key)) return true;
      seen.add(key);
      key = parentOf.get(key);
      if (!key) return true;
    }
    return false;
  };
  const childrenOf = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    const parentKey = parentKeyOf(task);
    if (parentKey && present.has(parentKey) && reachesRoot(parentKey, taskKey(task))) {
      childrenOf.set(parentKey, [...(childrenOf.get(parentKey) ?? []), task]);
    } else roots.push(task);
  }
  return { roots, childrenOf };
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const ad = a.due?.getTime() ?? Infinity;
    const bd = b.due?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    const ap = a.priority || 10;
    const bp = b.priority || 10;
    if (ap !== bp) return ap - bp;
    return (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0);
  });
}
