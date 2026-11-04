import { useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { clearMigration, pendingMigration } from '@/lib/migrate';
import { useData, type Account } from '@/store/data';
import { useApp } from '@/store/app';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CloudPromo } from '@/components/ui/CloudPromo';
import { MigrationWizard, type WizardPreset } from './MigrationWizard';
import { Badge, GroupHeading, KIND_ICON, MetaLine, accountDetail, accountTitle, placePhrases, statsText, useAccountStats, useDefaultAccountId } from './shared';

/** Settings → "Account & storage": where the calendars are kept, and moving them. */
export function AccountSection() {
  const [wizard, setWizard] = useState<WizardPreset | null>(null);
  // Bumped when the wizard closes, so the note about an interrupted run is read again.
  const [round, setRound] = useState(0);

  return (
    <>
      {/* While the wizard runs, its own journal is not news. */}
      {!wizard && <PendingMove key={round} onContinue={() => setWizard({})} />}
      <StorageSummary onMove={() => setWizard({})} />
      <CloudPromo compact className="mt-8" />
      {wizard && (
        <MigrationWizard
          preset={wizard}
          onClose={() => {
            setWizard(null);
            setRound((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function PendingMove({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  const accounts = useData((s) => s.accounts);
  const [dropped, setDropped] = useState(false);
  // The journal names accounts; one that is gone makes the run void.
  const journal = useMemo(() => (dropped ? null : pendingMigration()), [accounts, dropped]);
  if (!journal) return null;
  const places = placePhrases(
    accounts.find((a) => a.id === journal.sourceAccountId),
    accounts.find((a) => a.id === journal.targetAccountId),
    t,
  );
  return (
    <Alert
      tone="warning"
      role="note"
      className="mt-2 mb-2"
      title={t('migrate.pending.title')}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={onContinue}>
            {t('migrate.resume.continue')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              clearMigration();
              setDropped(true);
            }}
          >
            {t('migrate.resume.discard')}
          </Button>
        </>
      }
    >
      {t(journal.deleteSource ? 'migrate.pending.move' : 'migrate.pending.copy', { from: places.from, to: places.to })}
    </Alert>
  );
}

function StorageSummary({ onMove }: { onMove: () => void }) {
  const t = useT();
  const accounts = useData((s) => s.accounts);
  const stats = useAccountStats();
  const defaultId = useDefaultAccountId();
  const setStorageMode = useApp((s) => s.setStorageMode);

  // The default place, then every other one that holds calendars of its own.
  const places = accounts
    .filter((a) => a.id === defaultId || (stats[a.id]?.calendars ?? 0) > 0)
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
  // Storage modes name a kind; for CalDAV that means the first account of the kind.
  const firstOfKind = (a: Account) => accounts.find((x) => x.kind === a.kind)?.id === a.id;

  return (
    <section aria-labelledby="storage-heading">
      <GroupHeading id="storage-heading" major first>
        {t('storage.heading')}
      </GroupHeading>
      <ul className="border-border-weak divide-border-weak divide-y rounded-2xl border">
        {places.map((a) => {
          const Icon = KIND_ICON[a.kind];
          const isDefault = a.id === defaultId;
          const detail = accountDetail(a);
          return (
            <li key={a.id} className="flex gap-3 p-4 sm:px-5">
              <span className="bg-primary-weak text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-hidden>
                <Icon size={20} />
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="min-w-0 font-semibold break-words">{accountTitle(a, t)}</span>
                    {isDefault && <Badge tone="primary">{t('storage.default')}</Badge>}
                  </div>
                  {isDefault && <p className="text-text-weak mt-0.5 text-[0.8125rem]">{t(`storage.about.${a.kind}`)}</p>}
                  {/* Whose it is and what it holds, as in the wizard's list of places. */}
                  <MetaLine className="mt-0.5" parts={[detail, statsText(stats[a.id], t)]} />
                </div>
                {!isDefault && firstOfKind(a) && (
                  <Button size="sm" onClick={() => setStorageMode(a.kind)}>
                    {t('storage.makeDefault')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-text-weak mt-2 text-xs">{t('storage.defaultHint')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button icon={<ArrowRightLeft size={16} />} onClick={onMove}>
          {t('storage.move')}
        </Button>
        <button
          type="button"
          className="text-primary inline-flex min-h-[var(--touch,0px)] items-center rounded-sm text-[0.8125rem] font-medium underline-offset-2 hover:underline"
          onClick={() => useUi.getState().openSettings('calendars')}
        >
          {t('storage.caldavLink')}
        </button>
      </div>
    </section>
  );
}
