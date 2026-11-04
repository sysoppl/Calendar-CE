import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { changeSettings } from '@/lib/saveFeedback';
import { ToggleRow } from '@/components/ui/Controls';

export function TasksSection() {
  const t = useT();
  const s = useSettings();
  return (
    <>
      <ToggleRow label={t('settings.showTasksInCalendar')} checked={s.showTasksInCalendar} onChange={(showTasksInCalendar) => changeSettings({ showTasksInCalendar })} />
      <ToggleRow label={t('settings.showCompletedTasks')} checked={s.showCompletedTasks} onChange={(showCompletedTasks) => changeSettings({ showCompletedTasks })} />
    </>
  );
}
