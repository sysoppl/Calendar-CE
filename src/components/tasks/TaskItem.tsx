import { Check, Flag, Repeat, Trash2, CalendarClock, ListTree } from 'lucide-react';
import { isSameDay } from '@/lib/date';
import { DEFAULT_TASK_COLOR, calendarColor, readableText } from '@/lib/color';
import { deleteTask, openEditTask, toggleTask } from '@/lib/actions';
import type { Task } from '@/lib/ical/types';
import { canDeleteItems, type Calendar } from '@/store/data';
import { useFormat } from '@/hooks/useFormat';
import { useT } from '@/i18n';

function priorityColor(p: number): string | undefined {
  if (!p) return undefined;
  if (p <= 4) return 'var(--danger)';
  if (p === 5) return 'var(--warning)';
  return 'var(--primary)';
}

function TaskCheckbox({ task, color, size = 20 }: { task: Task; color: string; size?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.completed}
      aria-label={task.title}
      onClick={(e) => {
        e.stopPropagation();
        void toggleTask(task);
      }}
      className="group/check flex shrink-0 items-center justify-center rounded-full border-2 transition-colors"
      style={{ width: size, height: size, borderColor: color, background: task.completed ? color : 'transparent' }}
    >
      <Check
        size={size * 0.6}
        strokeWidth={3.5}
        color={task.completed ? readableText(color) : color}
        className={task.completed ? '' : 'opacity-0 group-hover/check:opacity-60'}
      />
    </button>
  );
}

export function TaskItem({
  task,
  calendar,
  showList,
  subtaskCount = 0,
  depth = 0,
}: {
  task: Task;
  calendar?: Calendar;
  showList: boolean;
  subtaskCount?: number;
  depth?: number;
}) {
  const t = useT();
  const fmt = useFormat();
  const color = calendarColor(calendar?.color, DEFAULT_TASK_COLOR);
  const now = new Date();
  const overdue = !task.completed && task.due && (task.dueAllDay ? task.due < new Date(now.getFullYear(), now.getMonth(), now.getDate()) : task.due < now);
  const pColor = priorityColor(task.priority);

  let dueLabel: string | undefined;
  if (task.due) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (isSameDay(task.due, now)) dueLabel = t('tasks.group.today');
    else if (isSameDay(task.due, tomorrow)) dueLabel = t('tasks.group.tomorrow');
    else dueLabel = fmt.date(task.due, { day: 'numeric', month: 'short', year: task.due.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
    if (!task.dueAllDay) dueLabel += `, ${fmt.time(task.due)}`;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openEditTask(task)}
      onKeyDown={(e) => {
        // Not for Enter on the checkbox or the buttons inside the row.
        if (e.key === 'Enter' && e.target === e.currentTarget) openEditTask(task);
      }}
      className="group hover:bg-bg-weak flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors"
      style={{ paddingLeft: 12 + depth * 24 }}
    >
      <div className="pt-0.5">
        <TaskCheckbox task={task} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`break-words ${task.completed ? 'text-text-hint line-through' : ''}`}>{task.title || t('grid.noTitle')}</div>
        {(dueLabel || showList || task.isRecurring || subtaskCount > 0 || task.description || task.percent > 0) && (
          <div className="text-text-weak mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem]">
            {dueLabel && (
              <span className={`flex items-center gap-1 ${overdue ? 'text-danger font-medium' : ''}`}>
                <CalendarClock size={12} />
                {dueLabel}
              </span>
            )}
            {task.isRecurring && <Repeat size={12} aria-label={t('tasks.recurring')} />}
            {subtaskCount > 0 && (
              <span className="flex items-center gap-1">
                <ListTree size={12} />
                {subtaskCount}
              </span>
            )}
            {task.percent > 0 && task.percent < 100 && !task.completed && <span>{task.percent}%</span>}
            {showList && calendar && (
              <span className="flex min-w-0 items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate">{calendar.name}</span>
              </span>
            )}
          </div>
        )}
      </div>
      {pColor && !task.completed && <Flag size={14} className="mt-1 shrink-0" style={{ color: pColor }} fill={pColor} aria-label={t('tasks.priority')} />}
      {(!calendar || canDeleteItems(calendar)) && (
        <button
          type="button"
          aria-label={t('event.delete')}
          className="text-text-hint hover:text-danger hover:bg-bg-strong -mr-1 shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:hidden"
          onClick={(e) => {
            e.stopPropagation();
            void deleteTask(task);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
