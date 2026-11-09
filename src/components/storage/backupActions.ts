// "Back up now", wherever it is offered (the notices above the calendar,
// Settings › Backup): makes the file of what this device keeps and saves it.
import { t } from '@/i18n';
import { backupFileName, makeBackup } from '@/lib/backup';
import { noteBackupSaved } from '@/lib/deviceStorage';
import { saveTextFile } from '@/lib/files';
import { errorMessage, useUi } from '@/store/ui';

let saving = false;

/**
 * Saves a backup file. True once it is saved (in a browser: handed to the
 * download), which the reminder then counts from; false when it was not
 * (cancelled in the picker, failed: said in a toast).
 */
export async function backUpNow(): Promise<boolean> {
  if (saving) return false;
  saving = true;
  const ui = useUi.getState();
  try {
    const made = makeBackup();
    const outcome = await saveTextFile(backupFileName(t('backup.file.name')), made.text, 'application/json');
    if (outcome === 'cancelled') return false;
    if (outcome === 'failed') {
      ui.toast(t('backup.saveFailed'), 'error');
      return false;
    }
    noteBackupSaved();
    ui.toast(t(outcome === 'saved' ? 'backup.saved' : 'backup.downloaded'), 'success');
    if (made.unreadable.length) ui.toast(t('backup.unreadable', { names: made.unreadable.join(', ') }), 'error');
    return true;
  } catch (err) {
    ui.toast(errorMessage(err), 'error');
    return false;
  } finally {
    saving = false;
  }
}
