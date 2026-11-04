import { useEffect, useId, useState } from 'react';
import { useT, type TFunction } from '@/i18n';
import { useFormat, type Formatter } from '@/hooks/useFormat';
import { detectPreset, endOfDayLocal, presetRule, weekdayCode, weekdayPosition, type RepeatPreset } from '@/lib/ical/recurrence';
import type { RecurrenceFreq, RecurrenceRule, RuleAsWritten } from '@/lib/ical/types';
import { describeAsWritten, ordinal, weekdayName } from '@/lib/describe';
import { useSettings } from '@/store/settings';
import { DateField } from '@/components/ui/DateTimeFields';

const ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** One weekday of the month at a position the editor names, as its model holds it (see editorModel). */
const NTH_DAY = /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/;

export const REPEAT_PRESETS: RepeatPreset[] = ['none', 'daily', 'weekly', 'weekdays', 'monthly', 'yearly', 'custom'];

/** Name of a repeat preset for an event starting at `start` ("Every week on Tuesday"). */
export function presetLabel(p: RepeatPreset, start: Date, t: TFunction, fmt: Formatter): string {
  switch (p) {
    case 'none':
      return t('repeat.none');
    case 'daily':
      return t('repeat.daily');
    case 'weekly':
      return t('repeat.weekly', { day: weekdayName(fmt, weekdayCode(start)) });
    case 'weekdays':
      return t('repeat.weekdays');
    case 'monthly':
      return t('repeat.monthly', { n: start.getDate() });
    case 'yearly':
      return t('repeat.yearly', { date: fmt.date(start, { day: 'numeric', month: 'long' }) });
    default:
      return t('repeat.custom');
  }
}

const FREQS: RecurrenceFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/**
 * Where the custom rule editor starts: the rule it is given, else the
 * frequency, interval and end of one as written, with its weekdays when they
 * are all its weekly rule says about days.
 */
function customStart(rule: RecurrenceRule | undefined, asWritten: RuleAsWritten | undefined, start: Date): RecurrenceRule {
  if (rule) return rule;
  const written = asWritten?.rules.length === 1 ? asWritten.rules[0] : undefined;
  const freq = FREQS.find((f) => f === written?.freq);
  if (!written || !freq) return { freq: 'WEEKLY', interval: 1, byDay: [weekdayCode(start)] };
  const days = (written.by.BYDAY ?? []).map(String);
  const plainDays = days.length > 0 && days.every((d) => ORDER.includes(d)) && !written.by.BYSETPOS?.length;
  return {
    freq,
    interval: written.interval,
    count: written.count,
    until: written.until,
    byDay: freq === 'WEEKLY' ? (plainDays ? ORDER.filter((d) => days.includes(d)) : [weekdayCode(start)]) : undefined,
    byMonthDay: freq === 'MONTHLY' ? [start.getDate()] : undefined,
  };
}

/**
 * The repeat select with the custom rule editor. A recurrence the editor
 * cannot show (`asWritten`) is an option of its own, described where that is
 * possible, and stays selected until another one is chosen; choosing it again
 * takes back that choice. `onChange` gets either a rule or the recurrence as
 * written to keep.
 */
export function RecurrenceFields({
  rule,
  asWritten,
  start,
  onChange,
  initialCustom = false,
}: {
  rule?: RecurrenceRule;
  asWritten?: RuleAsWritten;
  start: Date;
  onChange: (r?: RecurrenceRule, asWritten?: RuleAsWritten) => void;
  /** Start with the custom rule editor open, whatever the rule looks like. */
  initialCustom?: boolean;
}) {
  const t = useT();
  const fmt = useFormat();
  const hintId = useId();
  // What the event had when the editor opened, offered for as long as it is open.
  const [kept] = useState(() => (rule ? undefined : asWritten));
  const [preset, setPreset] = useState<RepeatPreset | 'asWritten'>(() =>
    kept ? 'asWritten' : initialCustom && rule ? 'custom' : detectPreset(rule, start),
  );
  useEffect(() => {
    // Keep weekly presets in sync when the start date moves.
    if (preset !== 'custom' && preset !== 'none' && preset !== 'asWritten') onChange(presetRule(preset, start));
  }, [start.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const keptLabel = kept && (describeAsWritten(kept, start, t, fmt) ?? '');

  return (
    <div className="flex flex-col gap-3">
      <select
        className="field"
        value={preset}
        aria-label={t('editor.repeat')}
        aria-describedby={preset === 'asWritten' ? hintId : undefined}
        onChange={(e) => {
          const p = e.target.value as RepeatPreset | 'asWritten';
          setPreset(p);
          if (p === 'asWritten') onChange(undefined, kept);
          else if (p === 'custom') onChange(customStart(rule, kept, start));
          else onChange(presetRule(p, start));
        }}
      >
        {REPEAT_PRESETS.map((p) => [
          p === 'custom' && kept && (
            <option key="asWritten" value="asWritten">
              {keptLabel ? t('repeat.asWritten', { rule: keptLabel }) : t('repeat.asWrittenUnknown')}
            </option>
          ),
          <option key={p} value={p}>
            {presetLabel(p, start, t, fmt)}
          </option>,
        ])}
      </select>
      {preset === 'asWritten' && (
        <p id={hintId} className="text-text-weak text-xs">
          {t('repeat.asWrittenHint')}
        </p>
      )}
      {preset === 'custom' && rule && <CustomRule rule={rule} start={start} onChange={onChange} />}
    </div>
  );
}

function CustomRule({ rule, start, onChange }: { rule: RecurrenceRule; start: Date; onChange: (r: RecurrenceRule) => void }) {
  const t = useT();
  const fmt = useFormat();
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const days = [...ORDER.slice(weekStartsOn), ...ORDER.slice(0, weekStartsOn)];
  const ends: 'never' | 'count' | 'until' = rule.count ? 'count' : rule.until ? 'until' : 'never';
  const pos = weekdayPosition(start);
  const monthlyMode = rule.byDay?.length ? 'weekday' : 'day';
  // The option in use names the day the rule has, which need not be the
  // start's (a rule from another app, or the 4th Friday that is also the
  // last); the other one names what choosing it gives.
  const nth = monthlyMode === 'weekday' ? NTH_DAY.exec(rule.byDay![0]) : null;
  const monthDay = monthlyMode === 'day' && rule.byMonthDay?.length ? rule.byMonthDay[0] : start.getDate();
  const weekdayPos = nth ? Number(nth[1]) : pos;
  const weekday = nth ? nth[2] : weekdayCode(start);

  return (
    <div className="bg-bg-weak flex flex-col gap-4 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span>{t('repeat.every')}</span>
        <input
          type="number"
          min={1}
          max={999}
          value={rule.interval}
          onChange={(e) => onChange({ ...rule, interval: Math.max(1, Number(e.target.value) || 1) })}
          className="field w-20"
          aria-label={t('repeat.every')}
        />
        <select
          className="field w-auto"
          value={rule.freq}
          onChange={(e) => {
            const freq = e.target.value as RecurrenceFreq;
            onChange({
              freq,
              interval: rule.interval,
              count: rule.count,
              until: rule.until,
              byDay: freq === 'WEEKLY' ? [weekdayCode(start)] : undefined,
              byMonthDay: freq === 'MONTHLY' ? [start.getDate()] : undefined,
            });
          }}
        >
          {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as RecurrenceFreq[]).map((f) => (
            <option key={f} value={f}>
              {t(`repeat.unit.${f}`)}
            </option>
          ))}
        </select>
      </div>

      {rule.freq === 'WEEKLY' && (
        <div>
          <div className="text-text-weak mb-2 text-xs font-semibold">{t('repeat.onDays')}</div>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => {
              const on = rule.byDay?.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  title={weekdayName(fmt, d)}
                  onClick={() => {
                    const set = new Set(rule.byDay ?? []);
                    if (on) set.delete(d);
                    else set.add(d);
                    if (!set.size) set.add(weekdayCode(start));
                    onChange({ ...rule, byDay: ORDER.filter((x) => set.has(x)) });
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    on ? 'bg-primary text-primary-contrast' : 'bg-bg border-border hover:border-text-hint border'
                  }`}
                >
                  {weekdayName(fmt, d, 'short').slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rule.freq === 'MONTHLY' && (
        <select
          className="field"
          value={monthlyMode}
          onChange={(e) =>
            onChange(
              e.target.value === 'day'
                ? { ...rule, byDay: undefined, byMonthDay: [start.getDate()] }
                : { ...rule, byMonthDay: undefined, byDay: [`${pos}${weekdayCode(start)}`] },
            )
          }
        >
          <option value="day">{t('repeat.monthlyOnDay', { n: monthDay })}</option>
          <option value="weekday">{t('repeat.monthlyOnWeekday', { pos: ordinal(weekdayPos, weekday, fmt.lang, t) ?? '', day: weekdayName(fmt, weekday) })}</option>
        </select>
      )}

      <div>
        <div className="text-text-weak mb-2 text-xs font-semibold">{t('repeat.ends')}</div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3">
            <input type="radio" name="ends" checked={ends === 'never'} onChange={() => onChange({ ...rule, count: undefined, until: undefined })} className="h-4 w-4 accent-[var(--primary)]" />
            {t('repeat.never')}
          </label>
          <label className="flex flex-wrap items-center gap-3">
            <input type="radio" name="ends" checked={ends === 'count'} onChange={() => onChange({ ...rule, count: rule.count ?? 10, until: undefined })} className="h-4 w-4 accent-[var(--primary)]" />
            {t('repeat.after')}
            <input
              type="number"
              min={1}
              value={rule.count ?? 10}
              disabled={ends !== 'count'}
              onChange={(e) => onChange({ ...rule, count: Math.max(1, Number(e.target.value) || 1), until: undefined })}
              className="field w-20 disabled:opacity-50"
            />
            {t('repeat.occurrences')}
          </label>
          <label className="flex flex-wrap items-center gap-3">
            <input
              type="radio"
              name="ends"
              checked={ends === 'until'}
              onChange={() => onChange({ ...rule, count: undefined, until: rule.until ?? endOfDayLocal(new Date(start.getFullYear(), start.getMonth() + 3, start.getDate())) })}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {t('repeat.on')}
            <span className={ends === 'until' ? '' : 'pointer-events-none opacity-50'}>
              <DateField
                label={t('repeat.on')}
                className="w-auto"
                value={rule.until ?? endOfDayLocal(new Date(start.getFullYear(), start.getMonth() + 3, start.getDate()))}
                min={start}
                onChange={(d) => onChange({ ...rule, count: undefined, until: endOfDayLocal(d) })}
              />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

