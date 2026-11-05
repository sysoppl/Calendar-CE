import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Flag, AlignLeft, ListTodo, Repeat, Bell, ListTree, X, Gauge, Plus } from 'lucide-react';
import { useUi, type TaskEditorState } from '@/store/ui';
import { calendarsFor, canDeleteItems, useData } from '@/store/data';
import { useT } from '@/i18n';
import { useTasks } from '@/hooks/useCalendarData';
import { deleteTask, saveTask } from '@/lib/actions';
import { minutesOfDay, setMinutesOfDay } from '@/lib/date';
import type { TaskData } from '@/lib/ical/types';
import { createTaskIcs, emptyTask } from '@/lib/ical/tasks';
import { normalizeItemColor } from '@/lib/color';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { IconRow as Row, SegmentedControl, Toggle } from '@/components/ui/Controls';
import { DateField, TimeField } from '@/components/ui/DateTimeFields';
import { RecurrenceFields } from '@/components/events/RecurrenceFields';
import { AlarmFields, PersistentField } from '@/components/events/AlarmFields';
import { TaskItem } from './TaskItem';

export function TaskEditor() {
  const state = useUi((s) => s.taskEditor);
  if (!state) return null;
  return <TaskForm key={state.objectUrl ?? state.data.uid} state={state} />;
}

const PRIORITIES = [
  { value: 0, key: 'tasks.priority.none' },
  { value: 9, key: 'tasks.priority.low' },
  { value: 5, key: 'tasks.priority.medium' },
  { value: 1, key: 'tasks.priority.high' },
] as const;

function normalizePriority(p: number) {
  if (!p) return 0;
  if (p <= 4) return 1;
  if (p === 5) return 5;
  return 9;
}

function TaskForm({ state }: { state: TaskEditorState }) {
  const t = useT();
  const close = () => useUi.getState().openTaskEditor(null);
  const calendars = useData((s) => s.calendars);
  const lists = useMemo(() => calendarsFor('VTODO', calendars).filter((c) => !c.readOnly || c.id === state.calendarId), [calendars, state.calendarId]);
  const allTasks = useTasks({ includeHidden: true });
  const [data, setData] = useState<TaskData>(state.data);
  const [calendarId, setCalendarId] = useState(state.calendarId);
  const [saving, setSaving] = useState(false);
  const [subtaskInput, setSubtaskInput] = useState('');
  const set = (patch: Partial<TaskData>) => setData((d) => ({ ...d, ...patch }));
  const list = calendars.find((c) => c.id === calendarId);

  const subtasks = allTasks.filter((x) => x.calendarId === calendarId && x.parentUid === data.uid);
  const parentCandidates = allTasks.filter((x) => x.calendarId === calendarId && x.uid !== data.uid && x.parentUid !== data.uid && !x.completed);

  const submit = async () => {
    // Enter and Ctrl+Enter bypass the disabled button.
    if (saving || !data.title.trim() || list?.readOnly) return;
    setSaving(true);
    const ok = await saveTask(state, { ...data, title: data.title.trim() }, calendarId);
    setSaving(false);
    if (ok) close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const addSubtask = async () => {
    const title = subtaskInput.trim();
    if (!title) return;
    const child = emptyTask({ title, parentUid: data.uid });
    setSubtaskInput('');
    try {
      await useData.getState().applyOps([{ type: 'create', calendarId, uid: child.uid, data: createTaskIcs(child) }]);
    } catch {
      setSubtaskInput(title);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      size="md"
      fullscreenOnMobile
      initialFocus="input[name=title]"
      title={state.mode === 'create' ? t('tasks.newTitle') : t('tasks.editTitle')}
      footer={
        <>
          {state.mode === 'edit' && state.objectUrl && canDeleteItems(calendars.find((c) => c.id === state.calendarId)) && (
            <Button
              variant="ghost"
              className="text-danger mr-auto"
              onClick={async () => {
                const task = allTasks.find((x) => x.objectUrl === state.objectUrl);
                if (task && (await deleteTask(task))) close();
              }}
            >
              {t('editor.delete')}
            </Button>
          )}
          <Button onClick={close}>{t('editor.cancel')}</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={!data.title.trim() || list?.readOnly}>
            {t('editor.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={data.completed}
            aria-label={data.completed ? t('tasks.reopen') : t('tasks.complete')}
            title={data.completed ? t('tasks.reopen') : t('tasks.complete')}
            onClick={() =>
              set({
                completed: !data.completed,
                status: data.completed ? 'NEEDS-ACTION' : 'COMPLETED',
                completedAt: data.completed ? undefined : new Date(),
                // Reopened, a task starts again from nothing, not from the 100 its completion wrote.
                percent: data.completed && data.percent >= 100 ? 0 : data.percent,
              })
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: normalizeItemColor(list?.color), background: data.completed ? normalizeItemColor(list?.color) : 'transparent' }}
          />
          <input
            name="title"
            value={data.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={t('tasks.taskTitle')}
            aria-label={t('tasks.taskTitle')}
            className={`border-border focus:border-primary min-w-0 flex-1 border-b-2 bg-transparent pb-2 text-xl font-semibold outline-none ${data.completed ? 'text-text-hint line-through' : ''}`}
          />
        </div>

        <Row icon={<ListTodo size={18} />}>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: normalizeItemColor(list?.color) }} />
            <select className="field" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} aria-label={t('tasks.list')}>
              {lists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </Row>

        <Row icon={<CalendarClock size={18} />}>
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              className="w-auto min-w-[9rem] flex-1"
              label={t('tasks.due')}
              placeholder={t('tasks.due')}
              value={data.due}
              // A timed task keeps its time when the day changes.
              onChange={(d) => set({ due: data.due && !data.dueAllDay ? setMinutesOfDay(d, minutesOfDay(data.due)) : d })}
            />
            {data.due && !data.dueAllDay && (
              <TimeField className="w-[6.75rem] sm:w-[7.5rem]" label={t('tasks.dueTime')} value={data.due} onChange={(m) => set({ due: setMinutesOfDay(data.due!, m) })} />
            )}
            {data.due && (
              <label className="flex items-center gap-2 text-[0.8125rem]">
                <Toggle
                  checked={!data.dueAllDay}
                  onChange={(v) => {
                    const d = data.due!;
                    set({ dueAllDay: !v, due: v ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9) : new Date(d.getFullYear(), d.getMonth(), d.getDate()) });
                  }}
                  label={t('tasks.dueTime')}
                />
                {t('tasks.dueTime')}
              </label>
            )}
            {data.due && (
              <button type="button" aria-label={t('tasks.clearDue')} title={t('tasks.clearDue')} className="text-text-weak hover:bg-bg-weak rounded-lg p-2" onClick={() => set({ due: undefined, rrule: undefined, ruleAsWritten: undefined, alarms: [] })}>
                <X size={16} />
              </button>
            )}
          </div>
          {!data.due && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[0, 1, 7].map((n) => {
                const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
                return (
                  <button key={n} type="button" className="border-border hover:bg-bg-weak rounded-full border px-3 py-1 text-[0.8125rem]" onClick={() => set({ due: d, dueAllDay: true })}>
                    {n === 0 ? t('tasks.group.today') : n === 1 ? t('tasks.group.tomorrow') : t('tasks.nextWeek')}
                  </button>
                );
              })}
            </div>
          )}
        </Row>

        {data.due && (
          <Row icon={<Repeat size={18} />}>
            <RecurrenceFields rule={data.rrule} asWritten={data.ruleAsWritten} start={data.due} onChange={(rrule, ruleAsWritten) => set({ rrule, ruleAsWritten })} />
          </Row>
        )}

        {data.due && (
          <Row icon={<Bell size={18} />}>
            <AlarmFields alarms={data.alarms} allDay={data.dueAllDay} onChange={(alarms) => set({ alarms, ...(alarms.length || !data.persistent ? {} : { persistent: false }) })} />
            {data.alarms.length > 0 && (
              <div className="mt-2">
                <PersistentField checked={!!data.persistent} task onChange={(persistent) => set({ persistent })} />
              </div>
            )}
          </Row>
        )}

        <Row icon={<Flag size={18} />} align="center">
          <SegmentedControl
            value={normalizePriority(data.priority)}
            onChange={(priority) => set({ priority })}
            options={PRIORITIES.map((p) => ({
              value: p.value,
              label: (
                <span className="flex items-center gap-1.5">
                  {p.value > 0 && <Flag size={12} fill="currentColor" style={{ color: p.value === 1 ? 'var(--danger)' : p.value === 5 ? 'var(--warning)' : 'var(--primary)' }} />}
                  {t(p.key)}
                </span>
              ),
            }))}
          />
        </Row>

        <Row icon={<Gauge size={18} />} align="center">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={data.completed ? 100 : data.percent}
              disabled={data.completed}
              onChange={(e) => set({ percent: Number(e.target.value), status: Number(e.target.value) > 0 ? 'IN-PROCESS' : 'NEEDS-ACTION' })}
              className="flex-1 accent-[var(--primary)]"
              aria-label={t('tasks.progress')}
            />
            <span className="text-text-weak w-10 text-right text-[0.8125rem] tabular-nums">{data.completed ? 100 : data.percent}%</span>
          </div>
        </Row>

        <Row icon={<AlignLeft size={18} />}>
          <textarea className="field min-h-24 resize-y" rows={3} value={data.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('tasks.notes')} aria-label={t('tasks.notes')} />
        </Row>

        <Row icon={<ListTree size={18} />}>
          <div className="flex flex-col gap-2">
            {parentCandidates.length > 0 && (
              <select className="field" value={data.parentUid ?? ''} onChange={(e) => set({ parentUid: e.target.value || undefined })} aria-label={t('tasks.subtaskOf')}>
                <option value="">{t('tasks.subtaskOf')}: —</option>
                {parentCandidates.map((p) => (
                  <option key={p.uid} value={p.uid}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
            {state.mode === 'edit' && (
              <div>
                <div className="text-text-weak mb-1 text-xs font-semibold">{t('tasks.subtasks')}</div>
                <div className="-mx-3">
                  {subtasks.map((s) => (
                    <TaskItem key={s.objectUrl} task={s} calendar={list} showList={false} />
                  ))}
                </div>
                <div className="field mt-1 flex items-center gap-2 py-1">
                  <Plus size={16} className="text-primary shrink-0" />
                  <input
                    className="field-plain py-0.5"
                    value={subtaskInput}
                    onChange={(e) => setSubtaskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addSubtask();
                      }
                    }}
                    placeholder={t('tasks.addSubtask')}
                    aria-label={t('tasks.addSubtask')}
                  />
                </div>
              </div>
            )}
          </div>
        </Row>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
