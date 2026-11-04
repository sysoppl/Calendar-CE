import { describe, expect, it } from 'vitest';
import { parseObject } from './parse';
import { createTaskIcs, emptyTask, MAX_TASK_DEPTH, readTask, setTaskCompleted, sortTasks, taskItemKey, tasksInRange, taskTree, updateTaskIcs } from './tasks';
import type { Task } from './types';

const obj = (data: string, etag = '"1"') =>
  parseObject({ url: `https://x.test/t/${etag}.ics`, etag, calendarId: 't', data: data.replace(/\r?\n/g, '\r\n') })!;

describe('tasks', () => {
  it('reads common VTODO properties', () => {
    const task = readTask(
      obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:t1
SUMMARY:Buy milk
DUE;VALUE=DATE:20261015
PRIORITY:1
STATUS:NEEDS-ACTION
CATEGORIES:home,errands
RELATED-TO:parent-1
END:VTODO
END:VCALENDAR`),
    )!;
    expect(task).toMatchObject({
      uid: 't1',
      title: 'Buy milk',
      dueAllDay: true,
      priority: 1,
      completed: false,
      categories: ['home', 'errands'],
      parentUid: 'parent-1',
    });
    expect(task.due).toEqual(new Date(2026, 9, 15));
  });

  it('creates, updates and completes a task', () => {
    const ics = createTaskIcs(emptyTask({ uid: 'n1', title: 'Write report', due: new Date(2026, 9, 20), priority: 5 }));
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('DUE;VALUE=DATE:20261020');
    const o = obj(ics);
    const t = readTask(o)!;
    expect(t.title).toBe('Write report');

    const updated = obj(updateTaskIcs(o, { ...t, title: 'Write final report', description: 'Q3' }), '"2"');
    expect(readTask(updated)).toMatchObject({ title: 'Write final report', description: 'Q3', priority: 5 });

    const done = obj(setTaskCompleted(updated, true), '"3"');
    expect(readTask(done)).toMatchObject({ completed: true, status: 'COMPLETED', percent: 100 });
    const undone = obj(setTaskCompleted(done, false), '"4"');
    expect(readTask(undone)).toMatchObject({ completed: false, status: 'NEEDS-ACTION', percent: 0 });
    expect(setTaskCompleted(done, false)).not.toContain('COMPLETED:');
  });

  it('keeps the progress, 100 included, of a task not marked as completed', () => {
    const o = obj(createTaskIcs(emptyTask({ uid: 'p1', title: 'Paint' })));
    for (const percent of [50, 100]) {
      const saved = readTask(obj(updateTaskIcs(o, { ...readTask(o)!, percent, status: 'IN-PROCESS' }), '"2"'));
      expect(saved).toMatchObject({ completed: false, status: 'IN-PROCESS', percent });
    }
    const none = readTask(obj(updateTaskIcs(o, { ...readTask(o)!, percent: 0, status: 'NEEDS-ACTION' }), '"2"'));
    expect(none).toMatchObject({ percent: 0 });
  });

  it('shows a repeating task in the calendar on each of its dates', () => {
    const ics = createTaskIcs(emptyTask({ uid: 'm1', title: 'Pay rent', due: new Date(2026, 9, 15), dueAllDay: true, rrule: { freq: 'MONTHLY', interval: 1 } }));
    const task = readTask(obj(ics))!;
    const now = new Date(2026, 9, 1);
    const shown = tasksInRange([task], new Date(2026, 9, 1), new Date(2027, 0, 1), false, now);
    expect(shown.map((t) => t.due!.toDateString())).toEqual([15, 15, 15].map((d, i) => new Date(2026, 9 + i, d).toDateString()));
    expect(shown[0]).toBe(task);
    expect(shown.slice(1).map((t) => t.upcomingOf)).toEqual([task, task]);
    expect(new Set(shown.map(taskItemKey)).size).toBe(3);
    // Only the dates within the range, and not before the task is due.
    expect(tasksInRange([task], new Date(2026, 11, 1), new Date(2027, 0, 1), false, now).map((t) => t.due!.getMonth())).toEqual([11]);
    expect(tasksInRange([task], new Date(2026, 8, 1), new Date(2026, 9, 1), false, now)).toEqual([]);
    // A count ends the series; a completed task is not repeated.
    const twice = readTask(obj(createTaskIcs(emptyTask({ uid: 'm2', title: 'Twice', due: new Date(2026, 9, 15), dueAllDay: true, rrule: { freq: 'MONTHLY', interval: 1, count: 2 } }))))!;
    expect(tasksInRange([twice], new Date(2026, 9, 1), new Date(2027, 6, 1), false, now)).toHaveLength(2);
    expect(tasksInRange([{ ...task, completed: true }], new Date(2026, 9, 1), new Date(2027, 0, 1), true, now)).toHaveLength(1);
    // A timed one keeps its time of day.
    const timed = readTask(obj(createTaskIcs(emptyTask({ uid: 'm3', title: 'Call', due: new Date(2026, 9, 15, 9, 30), dueAllDay: false, rrule: { freq: 'MONTHLY', interval: 1 } }))))!;
    expect(tasksInRange([timed], new Date(2026, 9, 1), new Date(2027, 0, 1), false, now).map((t) => [t.due!.getDate(), t.due!.getHours(), t.due!.getMinutes()])).toEqual([[15, 9, 30], [15, 9, 30], [15, 9, 30]]);
  });

  it('repeats an overdue task only from today on, however long ago it was due', () => {
    const daily = readTask(obj(createTaskIcs(emptyTask({ uid: 'd1', title: 'Water plants', due: new Date(2025, 0, 1), dueAllDay: true, rrule: { freq: 'DAILY', interval: 1 } }))))!;
    const shown = tasksInRange([daily], new Date(2026, 9, 1), new Date(2026, 10, 1), false, new Date(2026, 9, 28, 15));
    // The task itself is due long before; copies from today to the end of the month.
    expect(shown.map((t) => t.due!.getDate())).toEqual([28, 29, 30, 31]);
  });

  it('keeps an all-day task’s distance from its start in days across a change of clocks', () => {
    // Starts on a Saturday, due on the Monday after; the clocks change on the Sunday of 25 October 2026 in Europe.
    const weekly = readTask(obj(createTaskIcs(emptyTask({ uid: 'w1', title: 'Report', start: new Date(2026, 9, 17), due: new Date(2026, 9, 19), dueAllDay: true, rrule: { freq: 'WEEKLY', interval: 1 } }))))!;
    const shown = tasksInRange([weekly], new Date(2026, 9, 19), new Date(2026, 10, 10), false, new Date(2026, 9, 1));
    expect(shown.map((t) => [t.due!.getDay(), t.due!.getHours(), t.start!.getDay()])).toEqual([[1, 0, 6], [1, 0, 6], [1, 0, 6], [1, 0, 6]]);
  });

  it('advances recurring tasks instead of completing them', () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const ymd = `${future.getFullYear()}${String(future.getMonth() + 1).padStart(2, '0')}${String(future.getDate()).padStart(2, '0')}`;
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:r1
SUMMARY:Water plants
DUE;VALUE=DATE:${ymd}
RRULE:FREQ=WEEKLY
END:VTODO
END:VCALENDAR`);
    const next = readTask(obj(setTaskCompleted(o, true), '"2"'))!;
    expect(next.completed).toBe(false);
    expect(Math.round((next.due!.getTime() - future.setHours(0, 0, 0, 0)) / 86400000)).toBe(7);
  });

  it('moves an overdue recurring task past today in one step', () => {
    const past = new Date();
    past.setDate(past.getDate() - 23);
    const ymd = `${past.getFullYear()}${String(past.getMonth() + 1).padStart(2, '0')}${String(past.getDate()).padStart(2, '0')}`;
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:r2
SUMMARY:Water plants
DUE;VALUE=DATE:${ymd}
RRULE:FREQ=WEEKLY
END:VTODO
END:VCALENDAR`);
    const next = readTask(obj(setTaskCompleted(o, true), '"2"'))!;
    expect(next.completed).toBe(false);
    // 23 days overdue, weekly: the next open occurrence is in 5 days.
    expect(Math.round((next.due!.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)).toBe(5);
  });

  it('sorts open tasks by due date then priority', () => {
    const mk = (title: string, over: object) => ({ ...emptyTask({ title, ...over }), objectUrl: title, calendarId: 'c', etag: '', isRecurring: false });
    const sorted = sortTasks([
      mk('done', { completed: true, due: new Date(2026, 0, 1) }),
      mk('later', { due: new Date(2026, 5, 1) }),
      mk('nodue-high', { priority: 1 }),
      mk('soon', { due: new Date(2026, 1, 1) }),
    ]);
    expect(sorted.map((t) => t.title)).toEqual(['soon', 'later', 'nodue-high', 'done']);
  });

  it.each([
    ['DUE:2026-10-12', 'DUE'],
    ['COMPLETED:yesterday', 'COMPLETED'],
    ['RRULE:FREQ=WEEKLY;UNTIL=garbage', 'RRULE'],
    ['BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-15M\nEND:VALARM', 'TRIGGER'],
  ])('reads no task from a VTODO with an unreadable %s', (line) => {
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:broken
SUMMARY:Broken
${line}
END:VTODO
END:VCALENDAR`);
    expect(o.kind).toBe('task');
    expect(readTask(o)).toBeUndefined();
  });

  it.each([
    ['never matches', 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30'],
    ['runs every second', 'FREQ=SECONDLY'],
  ])('completes a task whose rule %s, without searching for ever', (_, rule) => {
    const past = new Date();
    past.setDate(past.getDate() - 7);
    const stamp = past.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:hostile
SUMMARY:Hostile
DUE:${stamp}
RRULE:${rule}
END:VTODO
END:VCALENDAR`);
    const started = performance.now();
    const done = readTask(obj(setTaskCompleted(o, true), '"2"'))!;
    expect(done.completed).toBe(true);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('an edit keeps rule parts the editor does not show', () => {
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:r3
SUMMARY:Report
DUE;VALUE=DATE:20261030
RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1
END:VTODO
END:VCALENDAR`);
    const t = readTask(o)!;
    const updated = updateTaskIcs(o, { ...t, title: 'Monthly report' });
    expect(updated).toMatch(/RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1/);
    const changed = updateTaskIcs(o, { ...t, rrule: { freq: 'WEEKLY', interval: 1 } });
    expect(changed).toMatch(/RRULE:FREQ=WEEKLY\r\n/);
  });
});

describe('a task\'s time and colour', () => {
  const todo = (lines: string, etag: string) =>
    readTask(
      obj(
        `BEGIN:VCALENDAR
BEGIN:VTODO
UID:${etag}
SUMMARY:Call back
${lines}
END:VTODO
END:VCALENDAR`,
        etag,
      ),
    )!;

  it('marks a due date or time that names no zone as floating', () => {
    expect(todo('DUE;VALUE=DATE:20261015', '"d1"')).toMatchObject({ dueAllDay: true, dueFloating: true });
    expect(todo('DUE:20261015T070000', '"d2"')).toMatchObject({ dueAllDay: false, dueFloating: true, due: new Date(2026, 9, 15, 7) });
    expect(todo('DUE;TZID=Europe/Warsaw:20261015T070000', '"d3"').dueFloating).toBe(false);
    expect(todo('DUE:20261015T070000Z', '"d4"').dueFloating).toBe(false);
    expect(todo('DTSTART:20261015T070000', '"d5"').dueFloating).toBe(false);
    // What the app writes itself is anchored to a zone.
    const own = readTask(obj(createTaskIcs(emptyTask({ uid: 'own', due: new Date(2026, 9, 15, 7), dueAllDay: false })), '"d6"'))!;
    expect(own.dueFloating).toBe(false);
  });

  it('never hands on a COLOR it was given', () => {
    const task = todo('DUE:20261015T070000\nCOLOR:url(https://tracker.example/beacon)', '"c1"');
    expect(JSON.stringify(task)).not.toMatch(/tracker/);
  });
});

describe('taskTree', () => {
  const task = (url: string, uid: string, parentUid?: string, calendarId = 'local|tasks'): Task =>
    ({ ...emptyTask({ uid, title: url, parentUid }), objectUrl: url, calendarId, etag: '1', isRecurring: false }) as Task;
  const shape = (tasks: Task[]) => {
    const { roots, childrenOf } = taskTree(tasks);
    return { roots: roots.map((x) => x.objectUrl), children: Object.fromEntries([...childrenOf].map(([k, v]) => [k, v.map((x) => x.objectUrl)])) };
  };

  it('puts subtasks under their parent of the same list', () => {
    expect(shape([task('a', 'A'), task('b', 'B', 'A'), task('c', 'C', 'B'), task('x', 'X', 'A', 'local|other'), task('o', 'O', 'missing')])).toEqual({
      roots: ['a', 'x', 'o'],
      children: { 'local|tasks|A': ['b'], 'local|tasks|B': ['c'] },
    });
  });

  it('shows a task that names its own UID, or one two tasks share, as a root', () => {
    // The case that sent the panel into endless recursion.
    expect(shape([task('x1', 'X'), task('x2', 'X', 'X')])).toEqual({ roots: ['x1', 'x2'], children: {} });
    expect(shape([task('s', 'S', 'S')])).toEqual({ roots: ['s'], children: {} });
    // A real subtask of a shared UID still sits under it.
    expect(shape([task('x1', 'X'), task('x2', 'X', 'X'), task('y', 'Y', 'X')])).toEqual({ roots: ['x1', 'x2'], children: { 'local|tasks|X': ['y'] } });
  });

  it('breaks a cycle by showing its tasks as roots', () => {
    expect(shape([task('a', 'A', 'B'), task('b', 'B', 'A')]).roots).toEqual(['a', 'b']);
    const ring = shape([task('a', 'A', 'C'), task('b', 'B', 'A'), task('c', 'C', 'B'), task('d', 'D', 'A')]);
    expect(ring.roots).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows a chain deeper than the limit from where it gets too deep', () => {
    const chain = Array.from({ length: 40 }, (_, i) => task(`t${i}`, `T${i}`, i ? `T${i - 1}` : undefined));
    const { roots } = taskTree(chain);
    expect(roots[0].objectUrl).toBe('t0');
    expect(roots.length).toBeGreaterThan(1);
    expect(roots.every((r) => r.objectUrl === 't0' || Number(r.objectUrl.slice(1)) >= MAX_TASK_DEPTH)).toBe(true);
  });

  it('takes little time for many tasks', () => {
    const many = Array.from({ length: 5000 }, (_, i) => task(`t${i}`, `T${i}`, i % 2 ? `T${i - 1}` : `T${i + 1}`));
    const started = performance.now();
    taskTree(many);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('a repeating task with a COUNT', () => {
  const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const days = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  };

  it('goes on with the instances left, and is completed once none is', () => {
    let o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:count
SUMMARY:Take the pills
DUE;VALUE=DATE:${ymd(days(1))}
RRULE:FREQ=DAILY;COUNT=3
END:VTODO
END:VCALENDAR`);
    o = obj(setTaskCompleted(o, true), '"2"');
    expect(o.data).toContain('COUNT=2');
    expect(readTask(o)).toMatchObject({ completed: false, due: new Date(days(2).setHours(0, 0, 0, 0)) });
    o = obj(setTaskCompleted(o, true), '"3"');
    expect(o.data).toContain('COUNT=1');
    o = obj(setTaskCompleted(o, true), '"4"');
    expect(readTask(o)!.completed).toBe(true);
  });

  it('counts the instances an overdue task skipped as used', () => {
    const o = obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:count-late
SUMMARY:Take the pills
DUE;VALUE=DATE:${ymd(days(-2))}
RRULE:FREQ=DAILY;COUNT=5
END:VTODO
END:VCALENDAR`);
    // Due two days ago: that one, yesterday's and today's... today's is the next one not overdue.
    const next = obj(setTaskCompleted(o, true), '"2"');
    expect(readTask(next)!.due).toEqual(new Date(days(0).setHours(0, 0, 0, 0)));
    expect(next.data).toContain('COUNT=3');
  });
});

describe("a task's reminders", () => {
  const task = (alarms: string) =>
    obj(`BEGIN:VCALENDAR
BEGIN:VTODO
UID:alarms
SUMMARY:Report
DTSTART:20261012T080000Z
DUE:20261012T120000Z
${alarms}
END:VTODO
END:VCALENDAR`);

  it('count from the start or from the due time, as RELATED says', () => {
    const t = readTask(
      task(`BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;RELATED=END:-PT15M
END:VALARM`),
    )!;
    // Half an hour before the start is four and a half hours before the due time.
    expect(t.alarms).toEqual([270, 15]);
  });

  it('keep one the editor cannot show when the task is saved', () => {
    const o = task(`BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;VALUE=DATE-TIME:20261011T180000Z
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;RELATED=END:-PT15M
END:VALARM`);
    const t = readTask(o)!;
    expect(t.alarms).toEqual([15]);
    const saved = updateTaskIcs(o, { ...t, alarms: [60] });
    expect(saved).toContain('TRIGGER;VALUE=DATE-TIME:20261011T180000Z');
    expect(saved).toContain('TRIGGER;RELATED=END:-PT1H');
    expect(saved).not.toContain('-PT15M');
  });
});
