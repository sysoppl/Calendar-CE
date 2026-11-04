import { ListTodo, Keyboard } from 'lucide-react';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { useTasks } from '@/hooks/useCalendarData';
import { useKeyboardUi } from '@/hooks/useKeyboardUi';
import { IconButton } from '@/components/ui/Button';

/** Thin vertical bar on the right. */
export function AppRail() {
  const t = useT();
  const open = useSettings((s) => s.tasksPanelOpen);
  const update = useSettings((s) => s.update);
  const tasks = useTasks();
  const keys = useKeyboardUi();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dueCount = tasks.filter((x) => !x.completed && x.due && x.due <= today).length;

  return (
    <nav className="bg-frame flex w-14 shrink-0 flex-col items-center gap-1 pt-1 pb-3" aria-label={t('nav.tools')}>
      <div className="relative">
        <IconButton tone="frame" size={40} label={t('nav.tasks')} active={open} onClick={() => update({ tasksPanelOpen: !open })}>
          <ListTodo size={20} />
        </IconButton>
        {dueCount > 0 && (
          <span className="bg-primary text-primary-contrast pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] font-bold">
            {dueCount > 99 ? '99+' : dueCount}
          </span>
        )}
      </div>
      <div className="flex-1" />
      {/* The list of shortcuts is of use only with a keyboard (a tablet may have none). */}
      {keys && (
        <IconButton tone="frame" size={40} label={t('nav.shortcuts')} onClick={() => useUi.getState().setShortcutsOpen(true)}>
          <Keyboard size={19} />
        </IconButton>
      )}
    </nav>
  );
}
