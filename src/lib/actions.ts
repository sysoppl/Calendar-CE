// High level operations triggered from the UI. They wrap the pure iCalendar
// functions, the data store and user prompts (scope, confirm, toasts, undo).
import { t } from '@/i18n';
import { getParsedObject, selfEmailsFor } from '@/hooks/useCalendarData';
import { calendarsFor, uidOf, useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { errorMessage, useUi, type EventEditorState, type TaskEditorState } from '@/store/ui';
import { refreshNow } from './autoSync';
import { defaultAlarmsFor } from './calendarAlarms';
import { createEventIcs, deleteEvent, duplicateEventIcs, eventDataFor, respondToEvent, updateEvent, type WriteOp } from './ical/events';
import { newUid, type RawObject } from './ical/parse';
import { createTaskIcs, emptyTask, setTaskCompleted, updateTaskIcs } from './ical/tasks';
import { localTimezone } from './ical/timezone';
import { nextSlot } from './date';
import type { EditScope, EventData, Occurrence, PartStat, Task, TaskData } from './ical/types';

const toast = (...args: Parameters<ReturnType<typeof useUi.getState>['toast']>) => useUi.getState().toast(...args);

function snapshot(urls: string[]): Map<string, RawObject | undefined> {
  const { objects } = useData.getState();
  const out = new Map<string, RawObject | undefined>();
  for (const url of urls) {
    let found: RawObject | undefined;
    for (const map of Object.values(objects)) if (map[url]) found = map[url];
    out.set(url, found);
  }
  return out;
}

function currentRaw(url: string): RawObject | undefined {
  return snapshot([url]).get(url);
}

/**
 * Applies ops and offers an Undo that restores every touched object to its
 * previous content.
 */
async function applyWithUndo(ops: WriteOp[], message: string) {
  const before = snapshot(ops.filter((o) => o.type !== 'create').map((o) => (o as { url: string }).url));
  const touched = await useData.getState().applyOps(ops);
  const created = touched.filter((_, i) => ops[i].type === 'create');
  toast(message, 'success', {
    label: t('toast.undo'),
    run: () => {
      void (async () => {
        try {
          const undo: WriteOp[] = [];
          for (const url of created) {
            const cur = currentRaw(url);
            if (cur) undo.push({ type: 'delete', url, etag: cur.etag });
          }
          for (const [url, prev] of before) {
            const cur = currentRaw(url);
            if (!prev) continue;
            if (cur) undo.push({ type: 'update', url, etag: cur.etag, data: prev.data });
            else {
              undo.push({ type: 'create', calendarId: prev.calendarId, uid: uidOf(prev) ?? newUid(), data: prev.data });
            }
          }
          await useData.getState().applyOps(undo);
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      })();
    },
  });
}

// -----------------------------------------------------------------------------
// Events

export function defaultEventCalendarId(): string | undefined {
  const { calendars } = useData.getState();
  const writable = calendarsFor('VEVENT', calendars).filter((c) => !c.readOnly);
  const preferred = useSettings.getState().defaultCalendarId;
  return (writable.find((c) => c.id === preferred) ?? writable.find((c) => c.visible) ?? writable[0])?.id;
}

export function newEventDraft(start: Date, end?: Date, allDay = false): EventEditorState | null {
  const calendarId = defaultEventCalendarId();
  if (!calendarId) {
    toast(t('editor.noCalendar'), 'error');
    return null;
  }
  const s = useSettings.getState();
  const finalEnd = end ?? (allDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) : new Date(start.getTime() + s.defaultEventDuration * 60000));
  return {
    mode: 'create',
    calendarId,
    data: {
      uid: newUid(),
      title: '',
      description: '',
      location: '',
      start,
      end: finalEnd,
      allDay,
      timezone: localTimezone(),
      // The calendar's own defaults, else the general ones.
      alarms: defaultAlarmsFor(calendarId, allDay, s),
      busy: !allDay,
      attendees: [],
      categories: [],
    },
  };
}

export function openNewEvent(start: Date, end?: Date, allDay = false) {
  const draft = newEventDraft(start, end, allDay);
  if (draft) useUi.getState().openEventEditor(draft);
}

/**
 * Starts a new event in place: a placeholder appears in the grid
 * at the next half hour, with the quick-create popover beside it. Phones get
 * the full editor, whose sheet has room for the whole form.
 */
export function startNewEvent() {
  const ui = useUi.getState();
  const now = new Date();
  // In the grid views the event lands on the day being looked at, elsewhere on today.
  const day = ui.view === 'day' || ui.view === 'days' || ui.view === 'week' ? ui.date : now;
  const start = nextSlot(new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes()));
  if (window.matchMedia('(max-width: 760px)').matches) return openNewEvent(start);
  if (!defaultEventCalendarId()) return toast(t('editor.noCalendar'), 'error');
  ui.openQuickCreate({ start, end: new Date(start.getTime() + useSettings.getState().defaultEventDuration * 60000), allDay: false });
}

export function openEditEvent(occ: Occurrence) {
  const obj = getParsedObject(occ.objectUrl);
  if (!obj) return;
  useUi.getState().openEventEditor({ mode: 'edit', calendarId: occ.calendarId, occurrence: occ, data: eventDataFor(obj, occ) });
}

async function chooseScope(occ: Occurrence, kind: 'edit' | 'delete'): Promise<EditScope | null> {
  if (!occ.isRecurring) return 'all';
  return useUi.getState().askScope(kind, true);
}

/** Saves the event editor. Returns true when the editor can close. */
export async function saveEvent(state: EventEditorState, data: EventData, calendarId: string): Promise<boolean> {
  try {
    if (state.mode === 'create') {
      await applyWithUndo([{ type: 'create', calendarId, uid: data.uid, data: createEventIcs(data) }], t('toast.eventCreated'));
      return true;
    }
    const occ = state.occurrence!;
    const obj = getParsedObject(occ.objectUrl);
    if (!obj) throw new Error(t('data.itemMissing'));

    if (calendarId !== occ.calendarId) {
      // Moving calendars always moves the whole series.
      const [op] = updateEvent(obj, occ, data, 'all');
      await useData.getState().moveObject(obj.url, calendarId, (op as { data: string }).data, obj.uid);
      toast(t('toast.eventSaved'), 'success');
      return true;
    }

    const scope = await chooseScope(occ, 'edit');
    if (!scope) return false;
    await applyWithUndo(updateEvent(obj, occ, data, scope), t('toast.eventSaved'));
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

export async function deleteOccurrence(occ: Occurrence): Promise<boolean> {
  const obj = getParsedObject(occ.objectUrl);
  if (!obj) return false;
  let scope: EditScope | null;
  if (occ.isRecurring) scope = await useUi.getState().askScope('delete', true);
  else {
    const ok = await useUi.getState().confirm({
      title: t('confirm.deleteEventTitle'),
      message: t('confirm.deleteEvent', { title: occ.title || t('grid.noTitle') }),
      confirmLabel: t('confirm.delete'),
      danger: true,
    });
    scope = ok ? 'all' : null;
  }
  if (!scope) return false;
  try {
    useUi.getState().openPopover(null);
    await applyWithUndo(deleteEvent(obj, occ, scope), t('toast.eventDeleted'));
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

/** Drag & drop / resize. */
export async function moveOccurrence(occ: Occurrence, start: Date, end: Date, allDay = occ.allDay) {
  const obj = getParsedObject(occ.objectUrl);
  if (!obj) return;
  const cal = useData.getState().calendars.find((c) => c.id === occ.calendarId);
  if (cal?.readOnly) {
    toast(t('event.readOnly'), 'error');
    return;
  }
  const scope = await chooseScope(occ, 'edit');
  if (!scope) return;
  const data = { ...eventDataFor(obj, occ), start, end, allDay };
  try {
    await applyWithUndo(updateEvent(obj, occ, data, scope), t('toast.eventSaved'));
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

export async function duplicateOccurrence(occ: Occurrence) {
  const obj = getParsedObject(occ.objectUrl);
  if (!obj) return;
  const cal = useData.getState().calendars.find((c) => c.id === occ.calendarId);
  const target = cal && !cal.readOnly ? cal.id : defaultEventCalendarId();
  if (!target) return;
  const data = eventDataFor(obj, occ);
  const copy = duplicateEventIcs(obj, false);
  useUi.getState().openPopover(null);
  // Non-recurring events are copied verbatim; recurring instances become a
  // standalone copy of the clicked occurrence.
  const ics = occ.isRecurring ? createEventIcs({ ...data, uid: copy.uid, rrule: undefined, attendees: [] }) : copy.data;
  try {
    await applyWithUndo([{ type: 'create', calendarId: target, uid: copy.uid, data: ics }], t('toast.eventCreated'));
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

/** Answers an invitation (yes / maybe / no) for one instance or the whole series. */
export async function respondToOccurrence(occ: Occurrence, status: PartStat) {
  const obj = getParsedObject(occ.objectUrl);
  if (!obj) return;
  const scope: EditScope | null = occ.isRecurring ? await useUi.getState().askScope('edit', false) : 'all';
  if (!scope) return;
  try {
    await applyWithUndo(respondToEvent(obj, occ, selfEmailsFor(occ.calendarId), status, scope), t('toast.replySaved'));
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

export function occurrenceIcs(occ: Occurrence): string | undefined {
  return currentRaw(occ.objectUrl)?.data;
}

// -----------------------------------------------------------------------------
// Tasks

export function defaultTaskListId(): string | undefined {
  const { calendars } = useData.getState();
  const writable = calendarsFor('VTODO', calendars).filter((c) => !c.readOnly);
  const preferred = useSettings.getState().defaultTaskListId;
  return (writable.find((c) => c.id === preferred) ?? writable.find((c) => c.visible) ?? writable[0])?.id;
}

export function openNewTask(over: Partial<TaskData> = {}, calendarId?: string) {
  const listId = calendarId ?? defaultTaskListId();
  if (!listId) {
    toast(t('tasks.noLists'), 'error');
    return;
  }
  useUi.getState().openTaskEditor({ mode: 'create', calendarId: listId, data: emptyTask(over) });
}

export function openEditTask(shown: Task) {
  // A later date of a repeating task opens the task itself.
  const task = shown.upcomingOf ?? shown;
  useUi.getState().openTaskEditor({ mode: 'edit', calendarId: task.calendarId, objectUrl: task.objectUrl, data: { ...task } });
}

export async function quickAddTask(title: string, calendarId: string, due?: Date): Promise<boolean> {
  const data = emptyTask({ title, due, dueAllDay: true });
  try {
    await useData.getState().applyOps([{ type: 'create', calendarId, uid: data.uid, data: createTaskIcs(data) }]);
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

export async function saveTask(state: TaskEditorState, data: TaskData, calendarId: string): Promise<boolean> {
  try {
    if (state.mode === 'create') {
      await applyWithUndo([{ type: 'create', calendarId, uid: data.uid, data: createTaskIcs(data) }], t('toast.taskCreated'));
      return true;
    }
    const obj = getParsedObject(state.objectUrl!);
    if (!obj) throw new Error(t('data.itemMissing'));
    const ics = updateTaskIcs(obj, data);
    if (calendarId !== state.calendarId) {
      await useData.getState().moveObject(obj.url, calendarId, ics, obj.uid);
      toast(t('toast.taskSaved'), 'success');
    } else {
      await applyWithUndo([{ type: 'update', url: obj.url, etag: obj.etag, data: ics }], t('toast.taskSaved'));
    }
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

export async function toggleTask(task: Task) {
  // A later date of a repeating task is not due yet: ticking it would complete
  // the date before it, so the task opens instead.
  if (task.upcomingOf) return openEditTask(task);
  const obj = getParsedObject(task.objectUrl);
  if (!obj) return;
  try {
    const ics = setTaskCompleted(obj, !task.completed);
    await applyWithUndo(
      [{ type: 'update', url: obj.url, etag: obj.etag, data: ics }],
      task.completed ? t('toast.taskReopened') : t('toast.taskCompleted'),
    );
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

/**
 * Marks a task done (a repeating one moves on to its next date), with the
 * same Undo as ticking it. False when it is done already or the calendar
 * refused the change, which the toast then says.
 */
export async function markTaskDone(task: Task): Promise<boolean> {
  const obj = getParsedObject(task.objectUrl);
  if (!obj || task.completed) return false;
  try {
    await applyWithUndo([{ type: 'update', url: obj.url, etag: obj.etag, data: setTaskCompleted(obj, true) }], t('toast.taskCompleted'));
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

export async function deleteTask(task: Task): Promise<boolean> {
  const ok = await useUi.getState().confirm({
    title: t('confirm.deleteTaskTitle'),
    message: t('confirm.deleteTask', { title: task.title || t('grid.noTitle') }),
    confirmLabel: t('confirm.delete'),
    danger: true,
  });
  if (!ok) return false;
  try {
    await applyWithUndo([{ type: 'delete', url: task.objectUrl, etag: task.etag }], t('toast.taskDeleted'));
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

// -----------------------------------------------------------------------------
// Sync

/**
 * Brings every account and feed up to date now (the hidden R key, "Try
 * again"). The app syncs by itself (lib/autoSync.ts), so a refresh that
 * works says nothing; one that fails says why, unless `silent`.
 */
export async function syncNow(silent = false) {
  try {
    await refreshNow();
  } catch (err) {
    if (!silent) toast(t('toast.syncFailed', { error: errorMessage(err) }), 'error');
  }
}
