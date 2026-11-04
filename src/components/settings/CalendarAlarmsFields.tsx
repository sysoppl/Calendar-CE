// "Default notifications" of the calendar dialog: for events with a time and
// for all-day events, either the general defaults (Settings → General) or a
// list of the calendar's own, edited with the controls of the event editor.
import { useId } from 'react';
import { intlLocale, useLang, useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { generalAlarms, type AlarmKind, type CalendarAlarms } from '@/lib/calendarAlarms';
import { describeAlarm } from '@/lib/describe';
import { useSettings } from '@/store/settings';
import { AlarmFields } from '@/components/events/AlarmFields';
import { TOUCH_MIN_H } from '@/components/ui/touch';

const RADIO = 'h-4 w-4 shrink-0 accent-[var(--primary)]';
const CHOICE = `flex cursor-pointer items-center gap-3 rounded-lg py-1 has-[:disabled]:cursor-default has-[:disabled]:opacity-60 ${TOUCH_MIN_H}`;

/**
 * `value` is what the calendar has of its own; a kind it lacks follows the
 * general default. `disabledReason`, when given, is why nothing here can be
 * changed now, shown under the hint.
 */
export function CalendarAlarmsFields({ value, onChange, disabledReason }: { value: CalendarAlarms; onChange: (next: CalendarAlarms) => void; disabledReason?: string }) {
  const t = useT();
  const id = useId();
  const disabled = disabledReason !== undefined;
  const set = (kind: AlarmKind, list: number[] | undefined) => {
    const next: CalendarAlarms = { ...value };
    if (list) next[kind] = list;
    else delete next[kind];
    onChange(next);
  };
  return (
    <fieldset className="mb-4 min-w-0 border-0 p-0" disabled={disabled} aria-describedby={disabled ? `${id}-hint ${id}-why` : `${id}-hint`} data-calendar-alarms>
      <legend className="mb-1 p-0 text-[0.8125rem] font-semibold">{t('calendarAlarms.title')}</legend>
      <p id={`${id}-hint`} className="text-text-weak mb-2 text-xs">
        {t('calendarAlarms.hint')}
      </p>
      {disabled && (
        <p id={`${id}-why`} className="text-text-weak mb-2 text-xs font-semibold">
          {disabledReason}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <KindFields kind="timed" list={value.timed} onChange={(list) => set('timed', list)} />
        <KindFields kind="allDay" list={value.allDay} onChange={(list) => set('allDay', list)} />
      </div>
    </fieldset>
  );
}

/** One kind: "Same as general settings (…)" or "Custom" with the calendar's own list. */
function KindFields({ kind, list, onChange }: { kind: AlarmKind; list: number[] | undefined; onChange: (list: number[] | undefined) => void }) {
  const t = useT();
  const fmt = useFormat();
  const lang = useLang();
  const name = useId();
  const allDay = kind === 'allDay';
  const general = useSettings((s) => (allDay ? s.defaultAllDayAlarms : s.defaultAlarms));
  const title = t(allDay ? 'calendarAlarms.allDay' : 'calendarAlarms.timed');
  // Inside the brackets of a sentence: "(15 minutes before)", "(on the day at 9:00)".
  const lower = (text: string) => text.charAt(0).toLocaleLowerCase(intlLocale(lang)) + text.slice(1);
  const summary = general.length ? general.map((m) => lower(describeAlarm(m, allDay, t, fmt))).join(', ') : t('calendarAlarms.generalNone');
  const custom = list !== undefined;
  return (
    <fieldset className="border-border-weak min-w-0 rounded-lg border px-3 pt-1 pb-2" data-kind={kind}>
      <legend className="px-1 text-[0.8125rem] font-medium">{title}</legend>
      <label className={CHOICE}>
        <input type="radio" name={name} value="general" checked={!custom} onChange={() => onChange(undefined)} className={RADIO} />
        <span className="min-w-0">{t('calendarAlarms.general', { alarms: summary })}</span>
      </label>
      <label className={CHOICE}>
        {/* A custom list starts from what applies now. */}
        <input type="radio" name={name} value="custom" checked={custom} onChange={() => onChange(generalAlarms(allDay))} className={RADIO} />
        <span className="min-w-0">{t('calendarAlarms.custom')}</span>
      </label>
      {custom && (
        <div className="mt-1 pl-7">
          {!list.length && <p className="text-text-weak mb-1 text-[0.8125rem]">{t('calendarAlarms.customNone')}</p>}
          <AlarmFields alarms={list} allDay={allDay} onChange={onChange} label={`${title}: ${t('editor.notifications')}`} />
        </div>
      )}
    </fieldset>
  );
}
