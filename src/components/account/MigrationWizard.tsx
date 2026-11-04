import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Circle, Copy, Info, MoveRight, Server } from 'lucide-react';
import {
  clearMigration,
  pendingMigration,
  planMigration,
  runMigration,
  type MigratedCalendar,
  type MigrationJournal,
  type MigrationPlan,
  type MigrationProgress,
  type MigrationResult,
} from '@/lib/migrate';
import { normalizeItemColor } from '@/lib/color';
import { calendarsFor, isGeneratedCalendar, useData, type Account } from '@/store/data';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { intlLocale, useLang, useT, type TFunction } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button, Spinner } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { OptionCard } from '@/components/ui/OptionCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { KIND_ICON, MetaLine, accountDetail, accountTitle, errorText, placePhrases, statsText, useAccountStats, useDefaultAccountId, type AccountStats, type PlacePhrases } from './shared';

export interface WizardPreset {
  sourceId?: string;
  targetId?: string;
  mode?: Mode;
}

type Mode = 'copy' | 'move';
type Step = 'resume' | 'places' | 'mode' | 'summary' | 'run' | 'end';
type Outcome = { kind: 'done'; result: MigrationResult } | { kind: 'stopped' } | { kind: 'failed'; error: unknown };

/**
 * After a move nothing may be left pointing at calendars that are gone: new
 * events and tasks go to the moved calendars, and new calendars to the place
 * the data went to when it came from the default one.
 */
function settleDefaults(result: MigrationResult, target: Account | undefined, sourceWasDefault: boolean) {
  if (!target || !result.calendars.some((c) => c.deleted)) return;
  if (sourceWasDefault) useApp.getState().setStorageMode(target.kind);
  const { calendars } = useData.getState();
  const settings = useSettings.getState();
  const moved = result.calendars.map((c) => calendars.find((x) => x.id === c.targetId)).filter((c) => !!c && !c.readOnly);
  const exists = (id: string | undefined) => !!id && calendars.some((c) => c.id === id && !c.readOnly);
  const patch: { defaultCalendarId?: string; defaultTaskListId?: string } = {};
  if (!exists(settings.defaultCalendarId)) patch.defaultCalendarId = calendarsFor('VEVENT', moved.map((c) => c!))[0]?.id;
  if (!exists(settings.defaultTaskListId)) patch.defaultTaskListId = calendarsFor('VTODO', moved.map((c) => c!))[0]?.id;
  if (patch.defaultCalendarId || patch.defaultTaskListId) settings.update(Object.fromEntries(Object.entries(patch).filter(([, v]) => v)));
}

export function MigrationWizard({ preset, onClose }: { preset: WizardPreset; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const accounts = useData((s) => s.accounts);
  const allCalendars = useData((s) => s.calendars);
  const stats = useAccountStats();
  const defaultId = useDefaultAccountId();
  const [journal] = useState<MigrationJournal | null>(() => pendingMigration());
  const [step, setStep] = useState<Step>(journal && !preset.sourceId ? 'resume' : 'places');

  const sources = accounts.filter((a) => (stats[a.id]?.calendars ?? 0) > 0);
  const [sourceId, setSourceId] = useState<string | undefined>(() => {
    if (preset.sourceId) return preset.sourceId;
    const own = sources.find((a) => a.id === defaultId) ?? sources[0];
    return own?.id;
  });
  const [targetId, setTargetId] = useState<string | undefined>(() => preset.targetId ?? accounts.find((a) => a.id !== sourceId)?.id);
  const [mode, setMode] = useState<Mode | null>(preset.mode ?? null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const starts = useRef<Record<string, number>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const controller = useRef<AbortController | null>(null);
  const known = useRef(new Set(accounts.map((a) => a.id)));
  const formId = useId();

  const source = accounts.find((a) => a.id === sourceId);
  const target = accounts.find((a) => a.id === targetId);
  const p = placePhrases(source, target, t);

  // A place set up from here (the CalDAV dialog) becomes the destination.
  useEffect(() => {
    const added = accounts.find((a) => !known.current.has(a.id));
    for (const a of accounts) known.current.add(a.id);
    if (added && added.id !== sourceId) setTargetId(added.id);
  }, [accounts, sourceId]);

  // A destination that is now the source, or gone, is no destination.
  useEffect(() => {
    if (targetId && (targetId === sourceId || !accounts.some((a) => a.id === targetId))) setTargetId(undefined);
  }, [accounts, sourceId, targetId]);

  const running = step === 'run';
  const toSummary = (from = sourceId, to = targetId) => {
    if (!from || !to) return;
    try {
      setPlan(planMigration(from, to));
      setPlanError(null);
      setStep('summary');
    } catch (err) {
      setPlanError(errorText(err));
    }
  };

  const start = async (current: MigrationPlan, deleteSource: boolean) => {
    const abort = new AbortController();
    controller.current = abort;
    starts.current = {};
    setProgress(null);
    setOutcome(null);
    setStep('run');
    const sourceWasDefault = current.sourceAccountId === defaultId;
    try {
      const result = await runMigration(current, {
        deleteSource,
        signal: abort.signal,
        onProgress: (p) => {
          if (p.phase === 'copy' && p.calendarId && !(p.calendarId in starts.current)) starts.current[p.calendarId] = p.done;
          setProgress(p);
        },
      });
      if (deleteSource) settleDefaults(result, useData.getState().accounts.find((a) => a.id === current.targetAccountId), sourceWasDefault);
      setOutcome({ kind: 'done', result });
    } catch (err) {
      setOutcome(abort.signal.aborted ? { kind: 'stopped' } : { kind: 'failed', error: err });
    } finally {
      controller.current = null;
      setStep('end');
    }
  };

  const again = () => {
    if (!plan) return;
    try {
      const next = planMigration(plan.sourceAccountId, plan.targetAccountId);
      setPlan(next);
      void start(next, mode === 'move');
    } catch (err) {
      setOutcome({ kind: 'failed', error: err });
    }
  };

  let body: ReactNode;
  let footer: ReactNode;
  let stepNo = 0;

  if (step === 'resume' && journal) {
    const from = accounts.find((a) => a.id === journal.sourceAccountId);
    const to = accounts.find((a) => a.id === journal.targetAccountId);
    const date = new Date(journal.startedAt).toLocaleString(intlLocale(lang), { dateStyle: 'medium', timeStyle: 'short' });
    const was = placePhrases(from, to, t);
    body = (
      <div className="pb-2">
        <h3 className="mb-2 font-semibold">{t('migrate.resume.title')}</h3>
        <p className="mb-4">
          {t(journal.deleteSource ? 'migrate.resume.move' : 'migrate.resume.copy', { from: was.from, to: was.to, date })}
        </p>
        <p className="text-text-weak text-[0.8125rem]">{t('migrate.resume.discardHint')}</p>
        {planError && (
          <Alert tone="danger" className="mt-4">
            {planError}
          </Alert>
        )}
      </div>
    );
    footer = (
      <>
        <Button
          onClick={() => {
            clearMigration();
            setStep('places');
          }}
        >
          {t('migrate.resume.discard')}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setSourceId(journal.sourceAccountId);
            setTargetId(journal.targetAccountId);
            setMode(journal.deleteSource ? 'move' : 'copy');
            toSummary(journal.sourceAccountId, journal.targetAccountId);
          }}
        >
          {t('migrate.resume.continue')}
        </Button>
      </>
    );
  } else if (step === 'places') {
    stepNo = 1;
    const targets = accounts.filter((a) => a.id !== sourceId);
    body = (
      <form
        id={formId}
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sourceId && target) setStep('mode');
        }}
      >
        {sources.length === 0 ? (
          <Alert tone="info">{t('migrate.places.nothing')}</Alert>
        ) : (
          <>
            <PlaceGroup legend={t('migrate.places.from')} name="from">
              {sources.map((a) => (
                <PlaceOption key={a.id} account={a} name="from" checked={a.id === sourceId} onChange={() => setSourceId(a.id)} stats={stats[a.id]} />
              ))}
            </PlaceGroup>
            <PlaceGroup legend={t('migrate.places.to')} name="to">
              {targets.length === 0 && <p className="text-text-weak text-[0.8125rem]">{t('migrate.places.noTarget')}</p>}
              {targets.map((a) => (
                <PlaceOption key={a.id} account={a} name="to" checked={a.id === targetId} onChange={() => setTargetId(a.id)} stats={stats[a.id]} />
              ))}
            </PlaceGroup>
            <div className="mt-1">
              <div className="text-text-weak mb-2 text-[0.6875rem] font-semibold tracking-wide uppercase">{t('migrate.places.add')}</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<Server size={14} />} onClick={() => useUi.getState().openAccountDialog(true)}>
                  {t('migrate.places.addCaldav')}
                </Button>
              </div>
            </div>
          </>
        )}
      </form>
    );
    footer = (
      <>
        <Button onClick={onClose}>{t('settings.cancel')}</Button>
        <Button type="submit" form={formId} variant="primary" disabled={!source || !target}>
          {t('migrate.next')}
        </Button>
      </>
    );
  } else if (step === 'mode') {
    stepNo = 2;
    const sourceDefault = sourceId === defaultId;
    body = (
      <div className="pb-2">
        <p className="text-text-weak mb-4">{t('migrate.mode.intro', { to: p.to })}</p>
        <div className="grid gap-3">
          <OptionCard
            icon={<Copy size={20} />}
            title={t('migrate.mode.copy')}
            summary={t('migrate.mode.copySummary', { to: p.to, inFrom: p.inFrom })}
            good={[t('migrate.mode.copyGood')]}
            caveats={[t('migrate.mode.copyCaveat')]}
            selected={mode === 'copy'}
            onSelect={() => setMode('copy')}
            headingLevel={4}
            compact
          />
          <OptionCard
            icon={<MoveRight size={20} />}
            title={t('migrate.mode.move')}
            summary={t('migrate.mode.moveSummary', { to: p.to, from: p.from })}
            good={[t('migrate.mode.moveGood'), ...(sourceDefault ? [t('migrate.mode.moveDefault', { inTo: p.inTo })] : [])]}
            caveats={[t('migrate.mode.moveCaveat', { inFrom: p.inFrom })]}
            selected={mode === 'move'}
            onSelect={() => setMode('move')}
            headingLevel={4}
            compact
          />
        </div>
        {planError && (
          <Alert tone="danger" className="mt-4">
            {planError}
          </Alert>
        )}
      </div>
    );
    footer = (
      <>
        <Button onClick={() => setStep('places')}>{t('migrate.back')}</Button>
        <Button variant="primary" disabled={!mode} onClick={() => toSummary()}>
          {t('migrate.next')}
        </Button>
      </>
    );
  } else if (step === 'summary' && plan) {
    stepNo = 3;
    const move = mode === 'move';
    const colour = (id: string) => normalizeItemColor(allCalendars.find((c) => c.id === id)?.color);
    // Calendars are matched by name only when the one there is empty; one with items gets a twin.
    const key = (name: string) => name.trim().toLowerCase();
    const objects = useData.getState().objects;
    const filled = new Set(
      allCalendars.filter((c) => c.accountId === plan.targetAccountId && !isGeneratedCalendar(c) && Object.keys(objects[c.id] ?? {}).length > 0).map((c) => key(c.name)),
    );
    const twins = plan.resumes ? [] : plan.calendars.filter((c) => filled.has(key(c.name))).map((c) => c.name);
    const notes: ReactNode[] = [];
    if (plan.resumes) notes.push(t('migrate.summary.resumes'));
    if (twins.length) notes.push(t('migrate.summary.sameNames', { inTo: p.inTo, names: twins.join(', ') }));
    if (move) notes.push(t('migrate.summary.safeDelete', { from: p.from, inTo: p.inTo }));
    if (move && plan.sourceAccountId === defaultId) notes.push(t('migrate.summary.newDefault', { inTo: p.inTo }));
    if (plan.generated.length) notes.push(t('migrate.summary.generated', { names: plan.generated.map((g) => g.name).join(', ') }));
    if (target?.kind === 'caldav') notes.push(t('migrate.summary.toCaldav'));
    if (target?.kind === 'local') notes.push(t('migrate.summary.toLocal'));
    body = (
      <form
        id={formId}
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (plan.calendars.length) void start(plan, move);
        }}
      >
        <h3 className="mb-3 font-semibold">
          {t(move ? 'migrate.summary.titleMove' : 'migrate.summary.titleCopy', { from: p.from, to: p.to })}
        </h3>
        {plan.calendars.length === 0 ? (
          <Alert tone="info">{t('migrate.summary.empty', { inFrom: p.inFrom })}</Alert>
        ) : (
          <ul className="border-border-weak divide-border-weak mb-4 divide-y rounded-xl border">
            {plan.calendars.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colour(c.id) }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  {c.readOnly && move && <span className="text-text-weak block text-xs">{t('migrate.summary.readOnly')}</span>}
                </span>
                <span className="text-text-weak shrink-0 text-xs tabular-nums">{t('migrate.items', { n: c.items })}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="flex flex-col gap-2 text-[0.8125rem]">
          {notes.map((note, i) => (
            <li key={i} className="flex gap-2">
              <Info size={15} className="text-text-hint mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0">{note}</span>
            </li>
          ))}
        </ul>
      </form>
    );
    footer = (
      <>
        <Button onClick={() => setStep(journal && plan.resumes && !preset.sourceId ? 'resume' : 'mode')}>{t('migrate.back')}</Button>
        <Button type="submit" form={formId} variant="primary" disabled={!plan.calendars.length}>
          {t(move ? 'migrate.start.move' : 'migrate.start.copy')}
        </Button>
      </>
    );
  } else if (step === 'run' && plan) {
    body = <RunView plan={plan} progress={progress} starts={starts.current} places={p} />;
    footer = (
      <Button onClick={() => controller.current?.abort()} disabled={progress?.phase === 'done'}>
        {t('migrate.run.stop')}
      </Button>
    );
  } else if (step === 'end' && outcome && plan) {
    const done = outcome.kind === 'done' ? outcome.result : null;
    body = <EndView outcome={outcome} plan={plan} move={mode === 'move'} source={source} places={p} />;
    footer =
      done?.complete ? (
        <Button variant="primary" onClick={onClose}>
          {t('migrate.done')}
        </Button>
      ) : (
        <>
          <Button onClick={onClose}>{t('migrate.close')}</Button>
          <Button variant="primary" onClick={again}>
            {outcome.kind === 'failed' ? t('migrate.tryAgain') : t('migrate.continue')}
          </Button>
        </>
      );
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        dismissible={!running}
        size="lg"
        fullscreenOnMobile
        title={t('migrate.title')}
        // Fresh buttons per step: one that turned into the next step's submit button during its own click would submit that step too.
        footer={<Fragment key={step}>{footer}</Fragment>}
      >
        {stepNo > 0 && <p className="text-text-weak -mt-1 mb-3 text-xs font-medium">{t('migrate.step', { n: stepNo, total: 3 })}</p>}
        {body}
      </Modal>
    </>
  );
}

function PlaceGroup({ legend, name, children }: { legend: string; name: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5" name={name}>
      <legend className="mb-2 font-semibold">{legend}</legend>
      <div className="grid gap-2">{children}</div>
    </fieldset>
  );
}

function PlaceOption({
  account,
  name,
  checked,
  onChange,
  stats,
}: {
  account: Account;
  name: string;
  checked: boolean;
  onChange: () => void;
  stats: AccountStats | undefined;
}) {
  const t = useT();
  const Icon = KIND_ICON[account.kind];

  return (
    <label
      className={`relative flex items-center gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--primary)] ${
        checked ? 'border-primary bg-primary-weak cursor-pointer' : 'border-border-weak hover:border-border cursor-pointer'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span className="bg-primary-weak text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words">{accountTitle(account, t)}</span>
        <MetaLine parts={[accountDetail(account), statsText(stats, t)]} />
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${checked ? 'bg-primary border-primary text-primary-contrast' : 'border-border'}`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
    </label>
  );
}

function RunView({
  plan,
  progress,
  starts,
  places,
}: {
  plan: MigrationPlan;
  progress: MigrationProgress | null;
  starts: Record<string, number>;
  places: PlacePhrases;
}) {
  const t = useT();
  const phase = progress?.phase ?? 'prepare';
  const name = progress?.calendarName ?? '';
  const label =
    phase === 'prepare'
      ? t('migrate.phase.prepare')
      : phase === 'copy'
        ? t('migrate.phase.copy', { name, to: places.to })
        : phase === 'verify'
          ? t('migrate.phase.verify', { inTo: places.inTo })
          : phase === 'delete'
            ? t('migrate.phase.delete', { name, from: places.from })
            : t('migrate.phase.done');
  const counted = phase !== 'prepare' && !!progress && progress.total > 0;
  const index = plan.calendars.findIndex((c) => c.id === progress?.calendarId);

  return (
    <div className="pb-2">
      <ProgressBar
        label={label}
        value={counted ? progress!.done : phase === 'prepare' ? null : 1}
        max={counted ? progress!.total : 1}
        valueText={counted ? t('migrate.run.count', { done: progress!.done, total: progress!.total }) : undefined}
      />
      <p className="text-text-weak mt-2 mb-4 text-xs">{t('migrate.run.hint')}</p>
      <ul className="border-border-weak divide-border-weak divide-y rounded-xl border">
        {plan.calendars.map((c, i) => {
          const active = phase === 'copy' && c.id === progress?.calendarId;
          const finished = phase === 'verify' || phase === 'delete' || phase === 'done' || (phase === 'copy' && index >= 0 && i < index);
          const copied = c.id in starts && progress ? (active ? progress.done - starts[c.id] : null) : null;
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="text-text-hint flex w-4 shrink-0 justify-center" aria-hidden>
                {active ? <Spinner size={15} className="text-primary" /> : finished ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={15} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-text-weak shrink-0 text-xs tabular-nums">
                {active && copied !== null ? t('migrate.run.calendarCount', { n: copied }) : finished ? t('migrate.run.calendarDone') : t('migrate.items', { n: c.items })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function keptText(c: MigratedCalendar, t: TFunction, places: PlacePhrases): string {
  switch (c.kept) {
    case 'read-only':
      return t('migrate.kept.readOnly', { inFrom: places.inFrom });
    case 'unreadable':
      return t('migrate.kept.unreadable', { inFrom: places.inFrom });
    case 'unverified':
      return t('migrate.kept.unverified', { inFrom: places.inFrom, inTo: places.inTo });
    case 'failed':
      return t('migrate.kept.failed', { error: c.error ?? '' });
    default:
      return '';
  }
}

function EndView({
  outcome,
  plan,
  move,
  source,
  places,
}: {
  outcome: Outcome;
  plan: MigrationPlan;
  move: boolean;
  source: Account | undefined;
  places: PlacePhrases;
}) {
  const t = useT();
  const [removed, setRemoved] = useState(false);
  const result = outcome.kind === 'done' ? outcome.result : null;
  const names = useMemo(() => Object.fromEntries(plan.calendars.map((c) => [c.id, c.name])), [plan]);

  if (outcome.kind === 'stopped') {
    return (
      <Alert tone="warning" role="note" title={t('migrate.end.stoppedTitle')}>
        {t('migrate.end.stopped', { inTo: places.inTo, from: places.from })}
      </Alert>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <Alert tone="danger" title={t('migrate.end.failedTitle')}>
        <p>{errorText(outcome.error)}</p>
        <p className="mt-1">{t('migrate.end.failed', { from: places.from })}</p>
      </Alert>
    );
  }

  const r = result!;
  const unreadable = r.calendars.filter((c) => c.unreadable > 0);
  const offerRemove = move && r.sourceEmpty && source?.kind === 'caldav' && !removed;
  return (
    <div className="pb-2">
      {r.complete ? (
        <Alert tone="success" title={t(move ? 'migrate.end.movedTitle' : 'migrate.end.copiedTitle', { to: places.to })} className="mb-4">
          {t('migrate.end.counts', { copied: r.copied, present: r.present })}
        </Alert>
      ) : (
        <Alert tone="warning" role="note" title={t('migrate.end.partialTitle')} className="mb-4">
          {t('migrate.end.partial', { inFrom: places.inFrom })}
        </Alert>
      )}
      <ul className="border-border-weak divide-border-weak mb-4 divide-y rounded-xl border">
        {r.calendars.map((c) => {
          const kept = keptText(c, t, places);
          return (
            <li key={c.sourceId} className="flex items-start gap-3 px-3 py-2.5">
              <span className="mt-0.5 flex w-4 shrink-0 justify-center" aria-hidden>
                {kept ? <AlertCircle size={16} className="text-warning" /> : <CheckCircle2 size={16} className="text-success" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{names[c.sourceId] ?? c.name}</span>
                <span className="text-text-weak block text-xs">
                  {t('migrate.end.calendarCounts', { copied: c.copied, present: c.present })}
                  {c.deleted && ` · ${t('migrate.end.removed', { from: places.from })}`}
                </span>
                {kept && <span className="text-text block text-xs">{kept}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {(unreadable.length > 0 || r.generated.length > 0) && (
        <>
          <h3 className="mb-2 text-[0.8125rem] font-semibold">{t('migrate.end.skipped')}</h3>
          <ul className="mb-4 flex flex-col gap-2 text-[0.8125rem]">
            {unreadable.map((c) => (
              <li key={c.sourceId} className="flex gap-2">
                <ArrowRight size={14} className="text-text-hint mt-1 shrink-0" aria-hidden />
                <span>{t('migrate.end.unreadable', { n: c.unreadable, name: c.name, inFrom: places.inFrom })}</span>
              </li>
            ))}
            {r.generated.length > 0 && (
              <li className="flex gap-2">
                <ArrowRight size={14} className="text-text-hint mt-1 shrink-0" aria-hidden />
                <span>{t('migrate.end.generated', { names: r.generated.map((g) => g.name).join(', ') })}</span>
              </li>
            )}
          </ul>
        </>
      )}
      {offerRemove && (
        <div className="border-border-weak flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <p className="min-w-0 flex-1 text-[0.8125rem]">{t('migrate.end.sourceEmpty', { name: source!.name })}</p>
          <Button
            size="sm"
            onClick={() => {
              void useData.getState().removeAccount(source!.id);
              setRemoved(true);
            }}
          >
            {t('migrate.end.removeAccount')}
          </Button>
        </div>
      )}
    </div>
  );
}
