// Human readable descriptions of recurrence rules and alarms.
import type { Lang, TFunction } from '@/i18n';
import type { Formatter } from '@/hooks/useFormat';
import type { RecurrenceRule, RuleAsWritten, WrittenRule } from './ical/types';
import { externalLink, type LinkContext } from './externalLink';

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function weekdayName(fmt: Formatter, code: string, style: 'long' | 'short' = 'long'): string {
  // 2023-01-01 was a Sunday.
  const d = new Date(2023, 0, 1 + (DAY_INDEX[code] ?? 0));
  return fmt.date(d, { weekday: style });
}

export function describeRule(rule: RecurrenceRule, t: TFunction, fmt: Formatter): string {
  const unit = t(`repeat.unit.${rule.freq}`);
  let s: string;
  if (rule.interval > 1) s = t('repeat.summary.everyN', { n: rule.interval, unit });
  else if (rule.freq === 'DAILY') s = t('repeat.summary.daily');
  else if (rule.freq === 'WEEKLY') s = t('repeat.summary.weekly');
  else if (rule.freq === 'MONTHLY') s = t('repeat.summary.monthly');
  else s = t('repeat.summary.yearly');

  if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
    const days = rule.byDay.map((d) => weekdayName(fmt, d.slice(-2), 'short')).join(', ');
    s = rule.interval > 1 ? `${s} (${days})` : t('repeat.summary.weeklyOn', { days });
  }
  if (rule.freq === 'MONTHLY' && rule.byDay?.length) {
    const m = /^(-?\d)?([A-Z]{2})$/.exec(rule.byDay[0]);
    const pos = m && ordinal(Number(m[1] ?? 1), m[2], fmt.lang, t);
    if (m && pos) s += ` (${t('repeat.monthlyOnWeekday', { pos, day: weekdayName(fmt, m[2]) })})`;
  } else if (rule.freq === 'MONTHLY' && rule.byMonthDay?.length) {
    s += ` (${t('repeat.monthlyOnDay', { n: rule.byMonthDay.join(', ') })})`;
  }
  if (rule.count) s += t('repeat.summary.count', { n: rule.count });
  else if (rule.until) s += t('repeat.summary.until', { date: fmt.date(rule.until, { dateStyle: 'medium' }) });
  return s;
}

const WORK_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];
const WEEKEND = ['SA', 'SU'];
const PLAIN_DAY = /^(SU|MO|TU|WE|TH|FR|SA)$/;
const NTH_DAY = /^([+-]?\d{1,2})(SU|MO|TU|WE|TH|FR|SA)$/;
/** Parts put into words below; a rule with any other is left undescribed. */
const DESCRIBED = new Set(['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'BYHOUR', 'BYMINUTE']);
/** Times of day listed at most. */
const MAX_TIMES = 8;
/** Values of one part listed at most: the days of a month. */
const MAX_VALUES = 31;

/**
 * The weekdays whose name is feminine, in the languages whose ordinals agree
 * with it. The others have one form (English, Dutch, Czech "1.") or only
 * masculine weekdays (German, Spanish, French).
 */
const FEMININE_DAYS: Partial<Record<Lang, readonly string[]>> = {
  pl: ['WE', 'SA', 'SU'], // środa, sobota, niedziela
  cs: ['WE', 'SA', 'SU'], // středa, sobota, neděle
  uk: ['WE', 'FR', 'SA', 'SU'], // середа, п'ятниця, субота, неділя
  pt: ['MO', 'TU', 'WE', 'TH', 'FR'], // segunda-feira ... sexta-feira
  it: ['SU'], // domenica
};

/**
 * "first" ... "fourth", "last" before the weekday `day` (a code such as
 * "WE"), undefined for other positions. The feminine forms (`pos.f.*`, the
 * same words as `pos.*` where there is one form) go with a feminine weekday
 * of `lang`; without a day the ordinal is masculine.
 */
export function ordinal(n: number, day: string | undefined, lang: Lang, t: TFunction): string | undefined {
  if (![1, 2, 3, 4, -1].includes(n)) return undefined;
  return day && FEMININE_DAYS[lang]?.includes(day) ? t(`pos.f.${n}` as 'pos.f.1') : t(`pos.${n}` as 'pos.1');
}

function sameDays(days: string[], set: string[]) {
  return days.length === set.length && set.every((d) => days.includes(d));
}

function dayList(days: string[], fmt: Formatter) {
  return days.map((d) => weekdayName(fmt, d, 'short')).join(', ');
}

/** "first Monday, third Wednesday" for BYDAY with positions, undefined when one has none or one not named. */
function nthDays(days: string[], t: TFunction, fmt: Formatter): string | undefined {
  const items: string[] = [];
  for (const d of days) {
    const m = NTH_DAY.exec(d);
    const pos = m && ordinal(Number(m[1]), m[2], fmt.lang, t);
    if (!m || !pos) return undefined;
    items.push(t('repeat.desc.nthDay', { pos, day: weekdayName(fmt, m[2]) }));
  }
  return items.join(', ');
}

function describeWrittenRule(rule: WrittenRule, start: Date, t: TFunction, fmt: Formatter): string | undefined {
  const by = rule.by;
  if (Object.entries(by).some(([part, values]) => !DESCRIBED.has(part) || (values?.length ?? 0) > MAX_VALUES)) return undefined;
  const days = (by.BYDAY ?? []).map(String);
  const monthDays = (by.BYMONTHDAY ?? []).map(Number);
  const months = (by.BYMONTH ?? []).map(Number);
  // Days of the week and of the month together mean the days that are both
  // (Friday the 13th), and a yearly rule with days of the month but no month
  // repeats in every month: the words below would say otherwise.
  if (days.length && monthDays.length) return undefined;
  if (rule.freq === 'YEARLY' && monthDays.length && !months.length) return undefined;
  const setPos = (by.BYSETPOS ?? []).map(Number);
  const hours = by.BYHOUR?.map(Number);
  const minutes = by.BYMINUTE?.map(Number);
  const fine = rule.freq === 'HOURLY' || rule.freq === 'MINUTELY' || rule.freq === 'SECONDLY';
  const plain = days.every((d) => PLAIN_DAY.test(d));

  let s: string;
  if (rule.interval > 1) s = t('repeat.summary.everyN', { n: rule.interval, unit: t(`repeat.unit.${rule.freq}`) });
  else if (rule.freq === 'WEEKLY' && days.length && plain && !setPos.length) s = t('repeat.summary.weeklyOn', { days: dayList(days, fmt) });
  else s = t(`repeat.summary.${rule.freq.toLowerCase() as Lowercase<WrittenRule['freq']>}`);

  const details: string[] = [];
  if (months.length) details.push(t('repeat.desc.months', { months: months.map((m) => fmt.monthLong(new Date(2023, m - 1, 1))).join(', ') }));
  if (setPos.length) {
    // The n-th of a set of days in each week, month or year: the last weekday of the month.
    if (setPos.length > 1 || monthDays.length || hours || minutes || fine || rule.freq === 'DAILY' || !days.length || !plain) return undefined;
    const pos = ordinal(setPos[0], days.length === 1 ? days[0] : undefined, fmt.lang, t);
    if (!pos) return undefined;
    if (days.length === 1) details.push(t('repeat.desc.nthDays', { days: t('repeat.desc.nthDay', { pos, day: weekdayName(fmt, days[0]) }) }));
    else if (sameDays(days, WORK_DAYS)) details.push(t('repeat.desc.nthWorkDay', { pos }));
    else if (sameDays(days, WEEKEND)) details.push(t('repeat.desc.nthWeekendDay', { pos }));
    else if (sameDays(days, [...WORK_DAYS, ...WEEKEND])) details.push(t('repeat.desc.nthAnyDay', { pos }));
    else return undefined;
  } else if (days.length && plain) {
    if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') details.push(t('repeat.desc.everyDays', { days: dayList(days, fmt) }));
    else if (rule.freq === 'WEEKLY' && rule.interval === 1) {
      // Named in "Weekly on ..." already.
    } else if (sameDays(days, WORK_DAYS)) details.push(t('repeat.desc.workDays'));
    else details.push(t('repeat.desc.days', { days: dayList(days, fmt) }));
  } else if (days.length) {
    const nth = (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && nthDays(days, t, fmt);
    if (!nth) return undefined;
    details.push(t('repeat.desc.nthDays', { days: nth }));
  }
  if (monthDays.length) {
    if (monthDays.length === 1 && monthDays[0] === -1) details.push(t('repeat.desc.lastDay'));
    else if (monthDays.every((d) => d > 0)) details.push(t('repeat.desc.monthDays', { days: monthDays.join(', ') }));
    else return undefined;
  }
  if (hours || minutes) {
    // Hours and minutes as listed, the rest from the start. Finer rules
    // with them (every minute of one hour) are not put into words.
    if (rule.freq === 'MINUTELY' || rule.freq === 'SECONDLY' || (rule.freq === 'HOURLY' && minutes)) return undefined;
    const hs = hours ?? [start.getHours()];
    const ms = minutes ?? [start.getMinutes()];
    if (hs.length * ms.length > MAX_TIMES) return undefined;
    const times = hs
      .flatMap((h) => ms.map((m) => h * 60 + m))
      .sort((a, b) => a - b)
      .map((x) => fmt.time(new Date(2000, 0, 1, Math.floor(x / 60), x % 60)));
    details.push(t('repeat.desc.times', { times: times.join(', ') }));
  }
  if (details.length) s += ` (${details.join('; ')})`;
  if (rule.count) s += t('repeat.summary.count', { n: rule.count });
  else if (rule.until) s += t('repeat.summary.until', { date: fmt.date(rule.until, { dateStyle: 'medium' }) });
  return s;
}

/**
 * Plain-language description of a recurrence the editors show read-only, or
 * undefined when it has parts not put into words here (BYWEEKNO, BYYEARDAY,
 * BYSECOND, several RRULEs, an EXRULE, ...). `start` gives the time of day a
 * rule with BYHOUR or BYMINUTE takes the rest from.
 */
export function describeAsWritten(w: RuleAsWritten, start: Date, t: TFunction, fmt: Formatter): string | undefined {
  if (w.rules.length > 1 || w.excludeRules) return undefined;
  if (!w.rules.length) return w.extraDates ? t('repeat.desc.onDates') : undefined;
  const s = describeWrittenRule(w.rules[0], start, t, fmt);
  return s && w.extraDates ? t('repeat.desc.plusDates', { rule: s }) : s;
}

export function describeAlarm(minutes: number, allDay: boolean, t: TFunction, fmt: Formatter): string {
  if (allDay) {
    // For all-day events triggers are relative to midnight at the start.
    if (minutes <= 0) {
      const time = new Date(2000, 0, 1, 0, -minutes);
      return t('alarm.dayOf', { time: fmt.time(time) });
    }
    if (minutes < 1440) {
      const time = new Date(2000, 0, 1, 0, 1440 - minutes);
      return t('alarm.dayBefore', { time: fmt.time(time) });
    }
    // "1 week before at 09:00" (-P6DT15H), as other calendar apps write it: days back to the
    // day of the reminder, then the time on that day.
    if (minutes % 1440 !== 0) {
      const days = Math.ceil(minutes / 1440);
      const time = fmt.time(new Date(2000, 0, 1, 0, days * 1440 - minutes));
      if (days % 7 === 0) return days === 7 ? t('alarm.weekBefore', { time }) : t('alarm.weeksBefore', { n: days / 7, time });
      return t('alarm.daysBefore', { n: days, time });
    }
  }
  if (minutes === 0) return t('alarm.atStart');
  if (minutes % 10080 === 0) return minutes === 10080 ? t('alarm.week1') : t('alarm.weeks', { n: minutes / 10080 });
  if (minutes % 1440 === 0) return minutes === 1440 ? t('alarm.day1') : t('alarm.days', { n: minutes / 1440 });
  if (minutes % 60 === 0) return minutes === 60 ? t('alarm.hour1') : t('alarm.hours', { n: minutes / 60 });
  return minutes === 1 ? t('alarm.minute1') : t('alarm.minutes', { n: minutes });
}

/**
 * Linkifies URLs in plain text for safe React rendering. Only what
 * `externalLink` lets through gets an `href`; any other address stays text.
 */
export function splitLinks(text: string, context?: LinkContext): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const href = externalLink(m[0], context);
    if (!href) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], href });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
