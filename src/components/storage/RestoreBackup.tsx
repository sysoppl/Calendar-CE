// Restoring a backup file (lib/backup.ts): choosing the file, what it holds,
// whether the settings come too, and the restore with its progress. Used in
// Settings › Backup and on the welcome screen of a new install.
import { useRef, useState, type ReactNode } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { t as text, useT, type MessageKey } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { BackupError, MAX_BACKUP_BYTES, parseBackup, restoreBackup, type ParsedBackup, type RestoreResult } from '@/lib/backup';
import { isAndroid } from '@/lib/platform';
import { errorMessage, useUi } from '@/store/ui';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Controls';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/ProgressBar';

const PROBLEMS: Record<BackupError['problem'], MessageKey> = {
  'not-backup': 'backup.error.notBackup',
  newer: 'backup.error.newer',
  damaged: 'backup.error.damaged',
  'too-large': 'backup.error.tooLarge',
};

/** Reads a chosen file as a backup; a toast says why when it is not one. */
async function readBackup(file: File): Promise<ParsedBackup | null> {
  const ui = useUi.getState();
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too-large');
    const raw = await file.text();
    // A moment for the button's spinner to show before the reading takes the page.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return parseBackup(raw);
  } catch (err) {
    ui.toast(err instanceof BackupError ? text(PROBLEMS[err.problem]) : text('backup.error.read'), 'error');
    return null;
  }
}

interface RestoreBackupProps {
  /** Renders the way in: what opens the file picker. */
  children: (open: () => void, busy: boolean) => ReactNode;
  /** The settings box starts ticked (a new install, which has none of its own yet). */
  settingsByDefault?: boolean;
  /** After a restore that went through. */
  onRestored?: (result: RestoreResult) => void | Promise<void>;
}

/** A way into restoring a backup: a hidden file input, and the dialog once a file is read. */
export function RestoreBackup({ children, settingsByDefault = false, onRestored }: RestoreBackupProps) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setReading(true);
    try {
      setBackup(await readBackup(file));
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      {/* The app's file picker may grey out a file whose type it does not know as JSON: no filter there. */}
      <input ref={input} type="file" accept={isAndroid ? undefined : '.json,application/json'} hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {children(() => input.current?.click(), reading)}
      {backup && <RestoreDialog backup={backup} settingsByDefault={settingsByDefault} onClose={() => setBackup(null)} onRestored={onRestored} />}
    </>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-text-weak">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function RestoreDialog({
  backup,
  settingsByDefault,
  onClose,
  onRestored,
}: {
  backup: ParsedBackup;
  settingsByDefault: boolean;
  onClose: () => void;
  onRestored?: RestoreBackupProps['onRestored'];
}) {
  const t = useT();
  const fmt = useFormat();
  const [settings, setSettings] = useState(settingsByDefault);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;
  const empty = !backup.calendars.length && !backup.generated.length;

  const restore = async () => {
    setProgress({ done: 0, total: backup.items });
    const ui = useUi.getState();
    try {
      const result = await restoreBackup(backup, { settings, onProgress: (done, total) => setProgress({ done, total }) });
      ui.toast(t('backup.restored'), 'success');
      if (result.feedsFailed.length) ui.toast(t('backup.feedsFailed', { names: result.feedsFailed.join(', ') }), 'error');
      onClose();
      await onRestored?.(result);
    } catch (err) {
      ui.toast(t('backup.restoreFailed', { reason: errorMessage(err) }), 'error');
      setProgress(null);
    }
  };

  return (
    <Modal
      open
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      title={t('backup.restore.title')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('confirm.cancel')}
          </Button>
          <Button variant="primary" icon={<ArchiveRestore size={16} />} loading={busy} disabled={empty} onClick={() => void restore()}>
            {t('backup.restore.go')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <dl className="border-border-weak rounded-lg border px-3 py-1.5">
          <Fact label={t('backup.restore.made')} value={fmt.date(backup.createdAt, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: fmt.hour12 })} />
          <Fact label={t('backup.restore.calendars')} value={backup.calendars.length} />
          <Fact label={t('backup.restore.items')} value={backup.items} />
          {backup.generated.length > 0 && <Fact label={t('backup.restore.generated')} value={backup.generated.length} />}
          {backup.damaged > 0 && <Fact label={t('backup.restore.damaged')} value={backup.damaged} />}
        </dl>
        {empty ? <p className="text-text-weak">{t('backup.restore.empty')}</p> : <p className="text-text-weak">{t('backup.restore.merge')}</p>}
        {!empty && (
          <Checkbox checked={settings} onChange={setSettings}>
            {t('backup.restore.settings')}
          </Checkbox>
        )}
        {progress && (
          <ProgressBar label={t('backup.restore.progress')} value={progress.done} max={Math.max(1, progress.total)} valueText={t('backup.restore.count', { done: progress.done, total: progress.total })} />
        )}
      </div>
    </Modal>
  );
}
