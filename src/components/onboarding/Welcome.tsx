import { useId, type ReactNode } from 'react';
import { AlertCircle, ArchiveRestore, ArrowLeftRight, ArrowRight, Check, ChevronRight, MonitorSmartphone, Server } from 'lucide-react';
import { useT, type MessageKey } from '@/i18n';
import { isNative } from '@/lib/platform';
import type { StorageMode } from '@/store/app';
import { Button } from '@/components/ui/Button';
import { CloudPromo } from '@/components/ui/CloudPromo';
import { LogoMark } from '@/components/layout/Logo';
import { RestoreBackup } from '@/components/storage/RestoreBackup';
import { useTypeset } from './typeset';
import { WeekPreview } from './WeekPreview';

export interface StorageOption {
  mode: StorageMode;
  icon: ReactNode;
  key: 'local' | 'caldav';
  good: MessageKey[];
  caveats: MessageKey[];
  /** What else to know in a browser, where the app runs from a server. */
  webCaveats?: MessageKey[];
}

// From the least to set up to the most: nothing, then a server.
export const OPTIONS: StorageOption[] = [
  {
    mode: 'local',
    icon: <MonitorSmartphone size={20} />,
    key: 'local',
    good: ['welcome.local.good.1', 'welcome.local.good.2', 'welcome.local.good.3'],
    caveats: ['welcome.local.caveat.1', 'welcome.local.caveat.2'],
  },
  {
    mode: 'caldav',
    icon: <Server size={20} />,
    key: 'caldav',
    good: ['welcome.caldav.good.1', 'welcome.caldav.good.2', 'welcome.caldav.good.3'],
    caveats: ['welcome.caldav.caveat.1', 'welcome.caldav.caveat.2', 'welcome.caldav.caveat.3'],
    // In a browser the account goes through the app's DAV proxy by default, which sees the password.
    webCaveats: ['welcome.caldav.caveat.web'],
  },
];

/** What to know before choosing `option` where the app runs now. */
export function caveatsOf(option: StorageOption, native = isNative): MessageKey[] {
  return native ? option.caveats : [...option.caveats, ...(option.webCaveats ?? [])];
}

/**
 * The first screen of a new install: what the app is, and the places a
 * calendar can be kept, side by side. The choice can be changed later.
 */
export function Welcome({
  busy,
  onChoose,
  onRestored,
}: {
  busy: StorageMode | null;
  onChoose: (mode: StorageMode) => void;
  /** After a backup file was restored onto this device: the calendars are kept here from then on. */
  onRestored?: () => void | Promise<void>;
}) {
  const t = useT();
  const ts = useTypeset();
  return (
    <div className="flex flex-col sm:my-auto">
      {/*
        Wide screens show a drawing of the week view beside the title, with the
        logo next to the title rather than above it, so that the options still
        fit a laptop's screen; phones keep the room for the options.
      */}
      <div className="mx-auto mt-1 flex w-full max-w-2xl flex-col items-center text-center sm:mt-0 lg:max-w-none lg:flex-row lg:justify-center lg:gap-16 lg:text-left">
        <div className="flex min-w-0 flex-col items-center lg:max-w-xl lg:items-start">
          <div className="flex flex-col items-center lg:flex-row lg:gap-4">
            <LogoMark size={44} />
            <h1 className="mt-3 text-[1.625rem] leading-tight font-semibold tracking-tight text-balance sm:text-[2.25rem] lg:mt-0">{t('welcome.title')}</h1>
          </div>
          <p className="text-frame-weak mt-2 max-w-xl text-[1rem] leading-relaxed text-balance sm:text-[1.0625rem]">{ts(t('welcome.promise'))}</p>
        </div>
        <WeekPreview className="hidden w-[16rem] shrink-0 lg:flex" />
      </div>

      <h2 className="sr-only">{t('welcome.question')}</h2>
      <ul className="mx-auto mt-6 grid w-full max-w-xl gap-4 sm:mt-8 lg:max-w-4xl lg:grid-cols-2 lg:items-stretch">
        {OPTIONS.map((o) => (
          <li key={o.mode} className="flex min-w-0">
            <OptionCard option={o} busy={busy} onChoose={onChoose} />
          </li>
        ))}
      </ul>

      {/* A device that lost its data (or a new one) starts from a backup file of the device storage. */}
      {onRestored && (
        <div className="mx-auto mt-4 flex w-full max-w-xl justify-center">
          <RestoreBackup settingsByDefault onRestored={onRestored}>
            {(open, reading) => (
              <Button variant="frame" className="w-full sm:w-auto" icon={<ArchiveRestore size={16} />} loading={reading} disabled={busy !== null} onClick={open}>
                <span className="truncate">{t('welcome.restore')}</span>
              </Button>
            )}
          </RestoreBackup>
        </div>
      )}

      {/* The icon sits in the text, so it stays next to the first word however the line breaks. */}
      <p className="text-frame-weak mx-auto mt-6 max-w-xl text-center text-[0.875rem] text-balance lg:mt-5">
        <ArrowLeftRight size={16} className="mr-2 inline-block align-[-3px]" aria-hidden />
        {ts(t('welcome.moveLater'))}
      </p>

      <CloudPromo className="mx-auto mt-6 w-full max-w-xl lg:max-w-4xl" />
    </div>
  );
}

/** What to keep in mind about an option: folded, one tap away, with how many points there are. */
function Caveats({ option }: { option: StorageOption }) {
  const t = useT();
  const ts = useTypeset();
  const caveats = caveatsOf(option).map((key) => ts(t(key)));
  return (
    <details className="group">
      <summary className="text-text-weak hover:text-text -mx-1 flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-[0.875rem] font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        {t('ui.option.caveats')}
        {/* The list says how many points it holds once open; the count is for the eye. */}
        <span aria-hidden className="text-text-hint tabular-nums">
          · {caveats.length}
        </span>
      </summary>
      <ul className="text-text-weak flex flex-col gap-2 pt-1 pb-1 text-[0.875rem]">
        {caveats.map((text, i) => (
          <Point key={i} icon={<AlertCircle size={16} className="text-warning" />}>
            {text}
          </Point>
        ))}
      </ul>
    </details>
  );
}

/** A place to keep the calendar: what speaks for it, what to know, and its button. */
function OptionCard({ option: o, busy, onChoose }: { option: StorageOption; busy: StorageMode | null; onChoose: (mode: StorageMode) => void }) {
  const t = useT();
  const ts = useTypeset();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} data-option={o.key} className="bg-bg text-text border-border-weak flex w-full min-w-0 flex-col rounded-2xl border p-5 text-pretty">
      <div className="flex items-center gap-3">
        <span aria-hidden className="bg-primary-weak text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          {o.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-[1.0625rem] leading-snug font-semibold break-words">
            {t(`welcome.${o.key}.title`)}
          </h3>
          <p className="text-text-weak text-[0.8125rem] leading-snug">{ts(t(`welcome.${o.key}.summary`))}</p>
        </div>
      </div>
      <ul aria-label={t('ui.option.good')} className="mt-4 flex flex-col gap-2 text-[0.9375rem]">
        {o.good.map((key) => (
          <Point key={key} icon={<Check size={16} strokeWidth={2.5} className="text-success" />}>
            {ts(t(key))}
          </Point>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        <Caveats option={o} />
        <Button variant="primary" className="mt-1 h-11 w-full" loading={busy === o.mode} disabled={busy !== null} onClick={() => onChoose(o.mode)}>
          <span className="truncate">{t(`welcome.${o.key}.action`)}</span>
          {busy !== o.mode && <ArrowRight size={16} className="shrink-0" aria-hidden />}
        </Button>
      </div>
    </section>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[0.1875rem] shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}
