// What the calendar says to someone who keeps calendars on this device
// (lib/deviceStorage.ts): once, that this is at their own risk, to be
// accepted; once, what can delete them; and, every so many days, that a
// new backup is due.
import { useEffect, useState } from 'react';
import { DatabaseBackup, TriangleAlert, X } from 'lucide-react';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { useNow } from '@/hooks/useNow';
import { askToPersist, backupDue, deletionRisks, deviceItemCount, noteKeeping, snoozeBackupReminder, useKeepsCalendarsOnDevice, type DevicePlace } from '@/lib/deviceStorage';
import { useApp } from '@/store/app';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TOUCH_HIT } from '@/components/ui/touch';
import { backUpNow } from './backupActions';

/** "Keep them elsewhere" puts the question off for as long as the app runs. */
let putOff = false;

/**
 * The first time calendars are kept on this device (on the welcome screen's
 * choice, or for an install from before this question): that they exist only
 * here, and that keeping them here is at the user's own risk. It is answered,
 * not dismissed: accepted for good, or put off while the user looks at the
 * other places (Settings › Account & storage, which can move them).
 */
export function StorageRiskDialog() {
  const t = useT();
  const keeps = useKeepsCalendarsOnDevice();
  const accepted = useApp((s) => s.riskAcceptedAt !== undefined);
  const [later, setLater] = useState(putOff);
  if (!keeps || accepted || later) return null;

  const accept = () => {
    useApp.getState().updateDeviceStorage({ riskAcceptedAt: Date.now() });
    // A browser may keep the site's data through a shortage of space when asked (it may ask the user).
    void askToPersist();
  };
  const elsewhere = () => {
    putOff = true;
    setLater(true);
    useUi.getState().openSettings('account');
  };

  return (
    <Modal
      open
      dismissible={false}
      onClose={() => {}}
      title={t('storage.risk.title')}
      initialFocus="[data-accept-risk]"
      footer={
        <>
          <Button onClick={elsewhere}>{t('storage.risk.other')}</Button>
          <Button variant="primary" data-accept-risk onClick={accept}>
            {t('storage.risk.accept')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <p>{t('storage.risk.body')}</p>
        <p className="text-text-weak">{t('storage.risk.backup')}</p>
        <p className="font-semibold">{t('storage.risk.own')}</p>
      </div>
    </Modal>
  );
}

/** The list of what deletes the calendars kept on this device, in the words of where the app runs. */
export function DeletionRisks({ place, className = '' }: { place?: DevicePlace; className?: string }) {
  const t = useT();
  return (
    <ul className={`list-disc pl-5 ${className}`}>
      {deletionRisks(place).map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}

const BOX = 'bg-bg text-text border-border-weak mb-2 rounded-xl border text-[0.8125rem]';

/**
 * Above the calendar, for whoever keeps calendars here and accepted that:
 * once, what can delete them, until it is closed; after that, whenever a
 * backup is due (Settings › Backup › Backup reminder), a line that offers one.
 */
export function DeviceStorageNotices({ className = '' }: { className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const now = useNow().getTime();
  const keeps = useKeepsCalendarsOnDevice();
  const state = useApp((s) => s);
  const days = useSettings((s) => s.backupReminderDays);
  const hasItems = useData((s) => deviceItemCount(s.calendars, s.objects) > 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => noteKeeping(keeps), [keeps]);

  if (!keeps || state.riskAcceptedAt === undefined) return null;

  const backUp = async () => {
    setBusy(true);
    try {
      await backUpNow();
    } finally {
      setBusy(false);
    }
  };

  if (state.riskNoticeClosedAt === undefined) {
    return (
      <section role="status" aria-labelledby="device-risks-title" data-device-notice="risks" className={`${BOX} flex items-start gap-2 py-2 pr-1 pl-3 ${className}`}>
        <TriangleAlert size={16} className="text-warning mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 leading-snug">
          <h2 id="device-risks-title" className="font-semibold">
            {t('storage.notice.title')}
          </h2>
          <p className="mt-0.5">{t('storage.notice.intro')}</p>
          <DeletionRisks className="text-text-weak mt-1" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('storage.notice.outro')}</span>
            <Button size="sm" variant="primary" className={TOUCH_HIT} loading={busy} onClick={() => void backUp()}>
              {t('backup.make.button')}
            </Button>
          </div>
        </div>
        <IconButton label={t('storage.notice.close')} size={32} className={TOUCH_HIT} onClick={() => useApp.getState().updateDeviceStorage({ riskNoticeClosedAt: Date.now() })}>
          <X size={16} />
        </IconButton>
      </section>
    );
  }

  if (!hasItems || !backupDue(now, state, days)) return null;
  const last = state.lastBackupAt === undefined ? undefined : new Date(state.lastBackupAt);
  // Short, to fit two lines beside the button on a phone; the year only when it is another one.
  const date = last && fmt.date(last, { day: 'numeric', month: 'short', year: last.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
  const text = date ? t('backup.due.since', { date }) : t('backup.due.never');
  return (
    <div role="status" data-device-notice="backup" className={`${BOX} flex items-center gap-x-2 py-1 pr-1 pl-3 ${className}`}>
      <DatabaseBackup size={16} className="text-warning shrink-0" aria-hidden />
      {/* Two lines at most on a phone: the button stays. */}
      <span className="line-clamp-2 min-w-0 flex-1 leading-snug" title={text}>
        {text}
      </span>
      <Button size="sm" variant="primary" className={TOUCH_HIT} loading={busy} onClick={() => void backUp()}>
        {t('backup.due.action')}
      </Button>
      <IconButton label={t('backup.due.later')} size={32} className={TOUCH_HIT} onClick={() => snoozeBackupReminder()}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
