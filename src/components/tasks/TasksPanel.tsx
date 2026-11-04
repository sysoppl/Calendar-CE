import { useMemo, useState } from 'react';
import { X, Plus, Eye, EyeOff, ChevronDown, ListTodo, CheckCircle2 } from 'lucide-react';
import { useTasks, useCalendarMap } from '@/hooks/useCalendarData';
import { useIsNarrow } from '@/hooks/useMediaQuery';
import { useSettings } from '@/store/settings';
import { calendarsFor, useData } from '@/store/data';
import { useT } from '@/i18n';
import { MAX_TASK_DEPTH, sortTasks, taskKey, taskTree } from '@/lib/ical/tasks';
import { quickParse } from '@/lib/quickParse';
import { normalizeItemColor } from '@/lib/color';
import { defaultTaskListId, openNewTask, quickAddTask } from '@/lib/actions';
import type { Task } from '@/lib/ical/types';
import { IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { useBackdropDismiss } from '@/components/ui/backdrop';
import { TaskItem } from './TaskItem';

type GroupId = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'noDate' | 'completed';

function groupOf(task: Task, now: Date): GroupId {
  if (task.completed) return 'completed';
  if (!task.due) return 'noDate';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const after = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  if (task.dueAllDay ? task.due < today : task.due < now) return 'overdue';
  if (task.due < tomorrow) return 'today';
  if (task.due < after) return 'tomorrow';
  return 'upcoming';
}

export function TasksPanel() {
  const open = useSettings((s) => s.tasksPanelOpen);
  const narrow = useIsNarrow();
  const update = useSettings((s) => s.update);
  const surface = useSettings((s) => s.surface);
  const backdrop = useBackdropDismiss(() => update({ tasksPanelOpen: false }));
  if (!open) return null;
  if (narrow) {
    return (
      <div className="animate-fade fixed inset-0 z-40" style={{ background: 'var(--backdrop)' }} {...backdrop}>
        <aside
          className="animate-slide-right bg-bg text-text pt-safe pb-safe absolute inset-y-0 right-0 flex w-[min(400px,100vw)] flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <PanelContent />
        </aside>
      </div>
    );
  }
  return (
    <aside className={`bg-bg text-text border-border-weak ml-2 flex w-[340px] shrink-0 flex-col overflow-hidden border xl:w-[360px] ${surface === 'card' ? 'mb-2 rounded-xl' : 'rounded-t-xl border-b-0'}`}>
      <PanelContent />
    </aside>
  );
}

function PanelContent() {
  const t = useT();
  const tasks = useTasks();
  const calendarMap = useCalendarMap();
  const calendars = useData((s) => s.calendars);
  const taskLists = useMemo(() => calendarsFor('VTODO', calendars), [calendars]);
  const showCompleted = useSettings((s) => s.showCompletedTasks);
  const update = useSettings((s) => s.update);
  const [listFilter, setListFilter] = useState<string>('all');
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => tasks.filter((x) => listFilter === 'all' || x.calendarId === listFilter), [tasks, listFilter]);

  const { groups, childrenOf } = useMemo(() => {
    const now = new Date();
    // Cycle-safe: a task naming itself or a cycle of tasks is shown as a root.
    const { roots, childrenOf } = taskTree(sortTasks(filtered));
    const order: GroupId[] = ['overdue', 'today', 'tomorrow', 'upcoming', 'noDate', 'completed'];
    const map = new Map<GroupId, Task[]>(order.map((g) => [g, []]));
    for (const task of roots) map.get(groupOf(task, now))!.push(task);
    return { groups: order.map((g) => ({ id: g, tasks: map.get(g)! })).filter((g) => g.tasks.length && (g.id !== 'completed' || showCompleted)), childrenOf };
  }, [filtered, showCompleted]);

  const targetList = listFilter !== 'all' ? listFilter : defaultTaskListId();
  const writableTarget = targetList && !calendarMap.get(targetList)?.readOnly;

  const submit = async () => {
    const text = input.trim();
    if (!text || !targetList) return;
    const parsed = quickParse(text);
    setInput('');
    const ok = await quickAddTask(parsed.title || text, targetList, parsed.due);
    if (!ok) setInput(text);
  };

  // `above` holds the keys of the tasks this one is shown under, so no path through the tree comes back to one.
  const renderTask = (task: Task, depth: number, above: ReadonlySet<string> = new Set()): React.ReactNode => {
    const key = taskKey(task);
    const path = new Set(above).add(key);
    const kids =
      depth + 1 < MAX_TASK_DEPTH ? (childrenOf.get(key) ?? []).filter((k) => (showCompleted || !k.completed) && !path.has(taskKey(k))) : [];
    return (
      <div key={task.objectUrl}>
        <TaskItem task={task} calendar={calendarMap.get(task.calendarId)} showList={listFilter === 'all' && taskLists.length > 1} subtaskCount={kids.length} depth={depth} />
        {kids.map((k) => renderTask(k, depth + 1, path))}
      </div>
    );
  };

  const filterName = listFilter === 'all' ? t('tasks.allLists') : calendarMap.get(listFilter)?.name;
  const openCount = filtered.filter((x) => !x.completed).length;

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="text-base font-semibold">{t('tasks.title')}</h2>
        {openCount > 0 && <span className="bg-bg-strong text-text-weak ml-1 rounded-full px-2 text-xs font-semibold">{openCount}</span>}
        <div className="flex-1" />
        <IconButton label={showCompleted ? t('tasks.hideCompleted') : t('tasks.showCompleted')} onClick={() => update({ showCompletedTasks: !showCompleted })} active={showCompleted}>
          {showCompleted ? <Eye size={18} /> : <EyeOff size={18} />}
        </IconButton>
        <IconButton label={t('tasks.newTitle')} onClick={() => openNewTask({}, writableTarget ? targetList : undefined)}>
          <Plus size={20} />
        </IconButton>
        <IconButton label={t('tasks.close')} onClick={() => update({ tasksPanelOpen: false })}>
          <X size={20} />
        </IconButton>
      </div>

      {taskLists.length === 0 ? (
        <div className="text-text-weak flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <ListTodo size={44} strokeWidth={1.25} className="text-text-hint" />
          <p>{t('tasks.noLists')}</p>
        </div>
      ) : (
        <>
          <div className="px-4 pb-2">
            <Menu
              placement="bottom-start"
              trigger={
                <button type="button" className="hover:bg-bg-weak -ml-2 flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem] font-medium">
                  {listFilter !== 'all' && <span className="h-2.5 w-2.5 rounded-full" style={{ background: normalizeItemColor(calendarMap.get(listFilter)?.color) }} />}
                  <span className="truncate">{filterName}</span>
                  <ChevronDown size={14} />
                </button>
              }
              items={[
                { label: t('tasks.allLists'), checked: listFilter === 'all', onSelect: () => setListFilter('all') },
                'separator',
                ...taskLists.map((c) => ({
                  label: (
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: normalizeItemColor(c.color) }} />
                      {c.name}
                    </span>
                  ),
                  checked: listFilter === c.id,
                  onSelect: () => setListFilter(c.id),
                })),
              ]}
            />
          </div>
          {writableTarget && (
            <form
              className="px-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="field flex items-center gap-2 py-1.5">
                <Plus size={18} className="text-primary shrink-0" />
                <input className="field-plain py-0.5" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('tasks.addPlaceholder')} aria-label={t('tasks.add')} />
              </div>
            </form>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
            {groups.length === 0 && (
              <div className="text-text-weak flex flex-col items-center gap-3 px-6 py-12 text-center">
                <CheckCircle2 size={44} strokeWidth={1.25} className="text-success" />
                <p>{t('tasks.empty')}</p>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.id} className="mb-1">
                <button
                  type="button"
                  className={`hover:bg-bg-weak flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-[0.75rem] font-semibold tracking-wide uppercase ${g.id === 'overdue' ? 'text-danger' : 'text-text-weak'}`}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                  aria-expanded={!collapsed[g.id]}
                >
                  <ChevronDown size={14} className={`transition-transform ${collapsed[g.id] ? '-rotate-90' : ''}`} />
                  {t(`tasks.group.${g.id}`)}
                  <span className="text-text-hint font-normal">{g.tasks.length}</span>
                </button>
                {!collapsed[g.id] && g.tasks.map((task) => renderTask(task, 0))}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
