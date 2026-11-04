import { useData } from '@/store/data';
import { useT } from '@/i18n';
import { useDelayed } from '@/hooks/useDelayed';
import { ActivityBar } from '@/components/ui/ActivityBar';
import { Spinner } from '@/components/ui/Button';

/**
 * What the calendar shows while it is being brought up to date: the thin
 * line along its top edge during any sync, and over an empty calendar, while
 * an account is fetched for the first time (just connected), a note that
 * its calendars are on their way, so an empty grid is not taken for an empty
 * calendar. Inside the calendar's (positioned) panel.
 */
export function SyncActivity() {
  const t = useT();
  const syncing = useData((s) => Object.values(s.syncing).some(Boolean));
  const firstFetch = useData((s) => s.accounts.some((a) => s.syncing[a.id] && !a.lastSync && !s.calendars.some((c) => c.accountId === a.id)));
  const showFirst = useDelayed(firstFetch);
  return (
    <>
      <ActivityBar active={syncing} label={t('status.syncing')} />
      {showFirst && (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-10 flex justify-center px-4">
          <p role="status" className="animate-fade bg-bg-elevated border-border-weak shadow-elevated text-text flex items-center gap-2.5 rounded-full border px-4 py-2 text-[0.875rem]">
            <Spinner size={16} className="text-primary" />
            {t('status.firstSync')}
          </p>
        </div>
      )}
    </>
  );
}
