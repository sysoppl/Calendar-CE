import { CalendarPlus, ListTodo, Plus } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import { nextSlot } from '@/lib/date';
import { openNewEvent, openNewTask } from '@/lib/actions';
import { FAB_ACTIONS, useSettings, type FabAction } from '@/store/settings';
import { Menu } from '@/components/ui/Menu';

const CLASS =
  'bg-primary text-primary-contrast shadow-elevated fixed right-4 bottom-[calc(3.5rem+1rem+var(--safe-bottom))] z-20 flex h-14 w-14 items-center justify-center rounded-2xl';

const newEvent = () => openNewEvent(nextSlot());
const newTask = () => openNewTask();

/**
 * The round + button over the calendar on phones, where the sidebar's
 * button is out of sight. It sits above the bar of views (ViewBar, 3.5rem
 * tall plus the gesture area), at the same distance from it as from the
 * screen's edge. What it starts is a setting (General › New events): a new
 * event at the next free slot (the default), a new task, or a small menu
 * that offers the two.
 */
export function Fab() {
  const t = useT();
  const mobile = useIsMobile();
  const stored = useSettings((s) => s.fabAction);
  // A value this version does not know (a damaged store) is the default.
  const action: FabAction = FAB_ACTIONS.includes(stored) ? stored : 'event';
  if (!mobile) return null;
  if (action === 'choose') {
    return (
      <Menu
        placement="top-end"
        trigger={
          <button type="button" aria-label={t('fab.choose')} className={CLASS}>
            <Plus size={26} strokeWidth={2.5} />
          </button>
        }
        items={[
          { label: t('sidebar.newEvent'), icon: <CalendarPlus size={16} />, onSelect: newEvent },
          { label: t('sidebar.newTask'), icon: <ListTodo size={16} />, onSelect: newTask },
        ]}
      />
    );
  }
  const task = action === 'task';
  return (
    <button type="button" aria-label={t(task ? 'sidebar.newTask' : 'sidebar.newEvent')} onClick={task ? newTask : newEvent} className={CLASS}>
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
