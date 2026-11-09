// Settings › Backup: the one-file backup of what this device keeps (lib/backup.ts),
// restoring one, the reminder, and what can delete calendars kept here.
import { useId, useState } from 'react';
import { ArchiveRestore, DatabaseBackup } from 'lucide-react';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { useKeepsCalendarsOnDevice } from '@/lib/deviceStorage';
import { changeSettings } from '@/lib/saveFeedback';
import { useApp } from '@/store/app';
import { BACKUP_REMINDER_PRESETS, MAX_BACKUP_REMINDER_DAYS, useSettings } from '@/store/settings';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SettingGroup, SettingRow } from '@/components/ui/Controls';
import { backUpNow } from '@/components/storage/backupActions';
import { DeletionRisks } from '@/components/storage/DeviceStorage';
import { RestoreBackup } from '@/components/storage/RestoreBackup';
import { SELECT } from './styles';

/** The select's value for a number of days that is no preset. */
const CUSTOM = 'custom';

function ReminderRow() {
  const t = useT();
  const id = useId();
  const days = useSettings((s) => s.backupReminderDays);
  const preset = days === 0 || BACKUP_REMINDER_PRESETS.includes(days);
  // Chosen "Custom" with a preset still set: the field shows until another choice.
  const [custom, setCustom] = useState(!preset);
  const [draft, setDraft] = useState(String(days || 30));
  const showCustom = custom || !preset;

  const choose = (value: string) => {
    if (value === CUSTOM) {
      setCustom(true);
      setDraft(String(days || 30));
      return;
    }
    setCustom(false);
    changeSettings({ backupReminderDays: Number(value) });
  };
  const commit = (value: string) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return setDraft(String(days || 30));
    const clamped = Math.min(MAX_BACKUP_REMINDER_DAYS, n);
    setDraft(String(clamped));
    if (clamped !== days) changeSettings({ backupReminderDays: clamped });
  };

  return (
    <SettingRow label={t('backup.reminder')} hint={t('backup.reminder.hint')} htmlFor={`${id}-select`}>
      <div className="flex w-full flex-wrap items-center gap-2">
        <select id={`${id}-select`} className={SELECT} value={showCustom ? CUSTOM : String(days)} onChange={(e) => choose(e.target.value)}>
          <option value="0">{t('backup.reminder.off')}</option>
          {BACKUP_REMINDER_PRESETS.map((n) => (
            <option key={n} value={n}>
              {t('backup.reminder.every', { n })}
            </option>
          ))}
          <option value={CUSTOM}>{t('backup.reminder.custom')}</option>
        </select>
        {showCustom && (
          <label className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BACKUP_REMINDER_DAYS}
              step={1}
              className="field w-24"
              aria-label={t('backup.reminder.customLabel')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              }}
            />
            <span className="text-text-weak">{t('backup.reminder.days')}</span>
          </label>
        )}
      </div>
    </SettingRow>
  );
}

export function BackupSection() {
  const t = useT();
  const fmt = useFormat();
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const keeps = useKeepsCalendarsOnDevice();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await backUpNow();
    } finally {
      setSaving(false);
    }
  };

  const last =
    lastBackupAt === undefined
      ? t('backup.last.none')
      : t('backup.last', { date: fmt.date(new Date(lastBackupAt), { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: fmt.hour12 }) });

  return (
    <>
      <p className="text-text-weak pt-2">{t('backup.intro')}</p>
      <SettingGroup title={t('backup.group.file')}>
        <SettingRow label={t('backup.make')} hint={`${last} ${t('backup.make.hint')}`}>
          <Button icon={<DatabaseBackup size={16} />} loading={saving} onClick={() => void save()}>
            {t('backup.make.button')}
          </Button>
        </SettingRow>
        <SettingRow label={t('backup.restore')} hint={t('backup.restore.hint')}>
          <RestoreBackup>
            {(open, busy) => (
              <Button icon={<ArchiveRestore size={16} />} loading={busy} onClick={open}>
                {t('backup.restore.button')}
              </Button>
            )}
          </RestoreBackup>
        </SettingRow>
        <ReminderRow />
      </SettingGroup>
      {keeps && (
        <Alert tone="warning" role="note" className="mt-4" title={t('storage.notice.title')}>
          <p>{t('storage.notice.intro')}</p>
          <DeletionRisks className="mt-1" />
        </Alert>
      )}
    </>
  );
}
