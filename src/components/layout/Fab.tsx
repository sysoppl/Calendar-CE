import { Plus } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import { nextSlot } from '@/lib/date';
import { openNewEvent } from '@/lib/actions';

/**
 * The round "new event" button over the calendar on phones, where the
 * sidebar's button is out of sight. It sits above the bar of views (ViewBar,
 * 3.5rem tall plus the gesture area), at the same distance from it as from
 * the screen's edge.
 */
export function Fab() {
  const t = useT();
  const mobile = useIsMobile();
  if (!mobile) return null;
  return (
    <button
      type="button"
      aria-label={t('sidebar.newEvent')}
      onClick={() => openNewEvent(nextSlot())}
      className="bg-primary text-primary-contrast shadow-elevated fixed right-4 bottom-[calc(3.5rem+1rem+var(--safe-bottom))] z-20 flex h-14 w-14 items-center justify-center rounded-2xl"
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
