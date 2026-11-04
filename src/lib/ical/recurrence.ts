// RRULE <-> RecurrenceRule conversion, and a bound on the work of expanding one.
import ICAL from 'ical.js';
import type { RecurrenceFreq, RecurrenceRule, RuleAsWritten, WrittenFreq, WrittenRule } from './types';

// ical.js looks for the next instance of a rule in a loop without a limit. A
// rule whose parts never meet (FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30, or
// FREQ=DAILY;INTERVAL=7;BYDAY=MO from a Tuesday) never comes back from it, and
// a valid one such as FREQ=SECONDLY started years ago takes hours; either one
// in a shared calendar or a feed would freeze the app at every start. Every
// candidate the loop tries passes through check_contracting_rules once, so
// counting those calls bounds the work: one call of next() may try
// STEPS_PER_NEXT of them, and the iterators of one walk through a series can
// be given a common budget (`budgetRecurrence`). Past either, the iterator
// ends as if the series did: callers see a shorter series, not an error.
// Setting up a yearly rule has a loop of its own, which looks for a year with
// a day in it up to the year 20000 and costs a tenth of a second for a rule
// that has none, on every expansion; it is cut short the same way.

/** Candidates one call of next() may try: 27 years of days, more than a year of hours. */
const STEPS_PER_NEXT = 10_000;
/** Years the setup of a yearly rule may look through. One that has any days finds them within 28. */
const YEARS_PER_INIT = 1_000;

export interface RecurBudget {
  /** Candidates the iterators may still try. */
  left: number;
  /** An iterator on this budget was ended before its series was. */
  cut: boolean;
}

const STEPS = Symbol('steps');
const YEARS = Symbol('years');
const BUDGET = Symbol('budget');
const INSTALLED = Symbol.for('calendar.recurGuard');

interface Guarded {
  init(): void;
  next(again?: boolean): ICAL.Time | null;
  check_contracting_rules(): boolean;
  expand_year_days(year: number): unknown;
  completed: boolean;
  [STEPS]?: number;
  [YEARS]?: number;
  [BUDGET]?: RecurBudget;
}

function installGuard(proto: Guarded) {
  const init = proto.init;
  const next = proto.next;
  const check = proto.check_contracting_rules;
  const expandYear = proto.expand_year_days;
  const cut = new Error('The recurrence rule takes too long to expand');
  proto.init = function (this: Guarded) {
    this[YEARS] = 0;
    try {
      init.call(this);
    } catch (err) {
      if (err !== cut) throw err;
      // What ical.js makes of a rule without any year: an iterator without instances.
      this.completed = true;
    } finally {
      this[YEARS] = undefined;
    }
  };
  proto.expand_year_days = function (this: Guarded, year: number) {
    if (this[YEARS] !== undefined && ++this[YEARS] > YEARS_PER_INIT) throw cut;
    return expandYear.call(this, year);
  };
  proto.next = function (this: Guarded, again?: boolean) {
    // ical.js calls itself once more on a repeated instance; that call belongs to this one.
    if (again) return next.call(this, again);
    this[STEPS] = 0;
    try {
      return next.call(this, again);
    } catch (err) {
      if (err !== cut) throw err;
      this.completed = true;
      const budget = this[BUDGET];
      if (budget) budget.cut = true;
      return null;
    }
  };
  proto.check_contracting_rules = function (this: Guarded) {
    const budget = this[BUDGET];
    this[STEPS] = (this[STEPS] ?? 0) + 1;
    if (this[STEPS] > STEPS_PER_NEXT || (budget && --budget.left < 0)) throw cut;
    return check.call(this);
  };
}

// Once per ical.js, also when this module is evaluated again (tests reset modules, ical.js stays).
const iteratorProto = ICAL.RecurIterator.prototype as unknown as Guarded & { [INSTALLED]?: true };
if (!iteratorProto[INSTALLED]) {
  installGuard(iteratorProto);
  iteratorProto[INSTALLED] = true;
}

/** Budget for walking one series: what a few decades of a daily rule need, a fraction of a second. */
export const EXPANSION_STEPS = 50_000;

/**
 * Puts iterators on one budget of `steps` candidates over all their calls of
 * next(). Other iterators, those of time zones in particular, are not charged.
 */
export function budgetRecurrence(iterators: readonly unknown[], steps = EXPANSION_STEPS): RecurBudget {
  const budget: RecurBudget = { left: steps, cut: false };
  for (const it of iterators) (it as Guarded)[BUDGET] = budget;
  return budget;
}

/** The same for the rule iterators behind an event's expansion. */
export function budgetExpansion(expansion: ICAL.RecurExpansion, steps = EXPANSION_STEPS): RecurBudget {
  return budgetRecurrence((expansion as unknown as { ruleIterators?: unknown[] }).ruleIterators ?? [], steps);
}

const FREQS: RecurrenceFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

export function recurFromIcal(recur: ICAL.Recur): RecurrenceRule | undefined {
  const freq = recur.freq as RecurrenceFreq;
  if (!FREQS.includes(freq)) return undefined;
  const parts = recur.parts as Record<string, (string | number)[] | undefined>;
  return {
    freq,
    interval: recur.interval || 1,
    byDay: parts.BYDAY?.map(String),
    byMonthDay: parts.BYMONTHDAY?.map(Number),
    byMonth: parts.BYMONTH?.map(Number),
    count: recur.count ?? undefined,
    until: recur.until ? recur.until.toJSDate() : undefined,
  };
}

/**
 * Builds an ICAL.Recur. `untilAllDay` must match the event's DTSTART value
 * type (RFC 5545 requires UNTIL to be a DATE for all-day events). The editor
 * picks the last day, so a timed series ends at the end of that day (local
 * time): UNTIL at its midnight would leave out the instance on it.
 */
export function recurToIcal(rule: RecurrenceRule, untilAllDay: boolean): ICAL.Recur {
  const data: Record<string, unknown> = { freq: rule.freq, interval: rule.interval > 1 ? rule.interval : undefined };
  if (rule.byDay?.length) data.byday = rule.byDay;
  if (rule.byMonthDay?.length) data.bymonthday = rule.byMonthDay;
  if (rule.byMonth?.length) data.bymonth = rule.byMonth;
  if (rule.count) data.count = rule.count;
  else if (rule.until) {
    const u = rule.until;
    data.until = untilAllDay
      ? ICAL.Time.fromData({ year: u.getFullYear(), month: u.getMonth() + 1, day: u.getDate(), isDate: true })
      : ICAL.Time.fromJSDate(endOfDayLocal(u), true);
  }
  return ICAL.Recur.fromData(data as never);
}

export function recurToString(rule: RecurrenceRule, allDay: boolean): string {
  return recurToIcal(rule, allDay).toString();
}

export function sameRule(a?: RecurrenceRule, b?: RecurrenceRule): boolean {
  if (!a || !b) return !a && !b;
  return recurToString(a, false) === recurToString(b, false);
}

const EDITOR_PARTS = new Set(['BYDAY', 'BYMONTHDAY']);
const PLAIN_DAY = /^(SU|MO|TU|WE|TH|FR|SA)$/;
/** One weekday of the month, at a position the editor names (first to fourth, last). */
const NTH_DAY = /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/;
/** The days of the week in the order the editor writes them. */
const WEEK_ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The editor's model of a rule when it says all the rule says, undefined when
 * the editor cannot show it as it is. The editor has controls for the
 * frequency from daily to yearly, the interval, the days of a week, one day or
 * one weekday of a month, and the end; WKST changes the dates only for a
 * weekly rule with an interval and days.
 */
function editorModel(recur: ICAL.Recur): RecurrenceRule | undefined {
  const rule = recurFromIcal(recur);
  if (!rule) return undefined;
  const parts = recur.parts as Record<string, unknown[] | undefined>;
  if (Object.entries(parts).some(([name, values]) => values?.length && !EDITOR_PARTS.has(name))) return undefined;
  const days = rule.byDay ?? [];
  const monthDays = rule.byMonthDay ?? [];
  switch (rule.freq) {
    case 'DAILY':
    case 'YEARLY':
      return days.length || monthDays.length ? undefined : rule;
    case 'WEEKLY':
      if (monthDays.length || !days.every((d) => PLAIN_DAY.test(d))) return undefined;
      return recur.wkst !== ICAL.Time.MONDAY && rule.interval > 1 && days.length ? undefined : rule;
    case 'MONTHLY':
      if (days.length && monthDays.length) return undefined;
      if (monthDays.length && (monthDays.length > 1 || monthDays[0] < 1)) return undefined;
      if (days.length && (days.length > 1 || !NTH_DAY.test(days[0]))) return undefined;
      return rule;
  }
}

/** The parts of `recur` that are set, by name. */
function partsOf(recur: ICAL.Recur): Record<string, (string | number)[]> {
  const out: Record<string, (string | number)[]> = {};
  for (const [name, values] of Object.entries(recur.parts as Record<string, (string | number)[] | undefined>)) {
    if (values?.length) out[name] = values;
  }
  return out;
}

/**
 * True when each of `days` falls into the week of `start` with weeks that
 * begin on `wkst` exactly as with weeks that begin on Monday. That is all a
 * WKST changes in a weekly rule (RFC 5545 3.3.10): which week a day belongs
 * to, and with it which days a rule that skips weeks leaves out.
 */
function weeksAsOnMonday(days: string[], wkst: number, start: ICAL.Time): boolean {
  // ical.js numbers the days from Sunday = 1, as WKST does.
  const sinceWeekStart = (day: number, weekStart: number) => (day - weekStart + 7) % 7;
  const first = start.dayOfWeek();
  return days.every((d) => {
    const day = WEEK_ORDER.indexOf(d) + 1;
    const off = (weekStart: number) => sinceWeekStart(day, weekStart) - sinceWeekStart(first, weekStart);
    return off(wkst) === off(ICAL.Time.MONDAY);
  });
}

/**
 * `recur` as the editor would write the same rule, for one written in another
 * form that has the same dates from `start`, its DTSTART; `recur` itself when
 * there is none. Other apps often write a rule the editor offers as a preset
 * that way (FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=5;BYMONTH=1;WKST=SU). Each
 * change below keeps every date by RFC 5545 3.3.10, so a rule changed by
 * several of them keeps them too:
 * - The days of a weekly rule are a set: written in the week's order, once each.
 * - A daily rule with an interval of 1 on some days of the week has the dates
 *   of the weekly rule on them: every such day from DTSTART on. Only from a
 *   DTSTART on one of them: RFC 5545 leaves the other case open, and ical.js
 *   counts such a DTSTART for the daily rule and not for the weekly one.
 * - A yearly rule takes the month and the day from DTSTART, so one that names
 *   the month of DTSTART, and its day or none, is the plain yearly rule. Not
 *   one that names a day without the month (that day of every month), and not
 *   from 29 February, which some years lack and which ical.js then moves to
 *   1 March for the plain rule only.
 * - WKST only says which week a day belongs to. With an interval of 1 that
 *   changes nothing; a weekly rule that skips weeks drops it where it puts
 *   every day of the rule in the same week as Monday does (`weeksAsOnMonday`).
 * The tests sweep these over every start in a leap year and in two weeks; a
 * fold still checks that ical.js, which the app expands rules with, gives
 * both forms the same dates (`sameDates`, editableRule).
 */
function editorSpelling(recur: ICAL.Recur, start: ICAL.Time): ICAL.Recur {
  const out = recur.clone();
  const parts = partsOf(out);
  const names = Object.keys(parts);
  const only = (...allowed: string[]) => names.every((n) => allowed.includes(n));
  const days = (parts.BYDAY ?? []).map(String);
  const plainDays = days.length > 0 && days.every((d) => PLAIN_DAY.test(d));
  const onStartDay = days.includes(WEEK_ORDER[start.dayOfWeek() - 1]);
  if (out.freq === 'DAILY' && (out.interval || 1) === 1 && plainDays && onStartDay && only('BYDAY')) out.freq = 'WEEKLY';
  if (out.freq === 'WEEKLY' && plainDays) {
    out.parts.BYDAY = WEEK_ORDER.filter((d) => days.includes(d));
    // With an interval of 1 the model leaves WKST aside anyway (editorModel).
    if (out.wkst !== ICAL.Time.MONDAY && (out.interval || 1) > 1 && weeksAsOnMonday(days, out.wkst, start)) out.wkst = ICAL.Time.MONDAY;
  }
  if (out.freq === 'YEARLY' && only('BYMONTH', 'BYMONTHDAY')) {
    const months = (parts.BYMONTH ?? []).map(Number);
    const monthDays = (parts.BYMONTHDAY ?? []).map(Number);
    const inMonth = months.length === 1 && months[0] === start.month && !(start.month === 2 && start.day === 29);
    if (inMonth && (!monthDays.length || (monthDays.length === 1 && monthDays[0] === start.day))) {
      delete out.parts.BYMONTH;
      delete out.parts.BYMONTHDAY;
    }
  }
  return out;
}

/**
 * Dates compared to tell two forms of a rule apart. Those editorSpelling
 * relates repeat a pattern of one week (of `interval` weeks) or one date a
 * year, so 30 dates take in several of their cycles, and for a yearly rule
 * every kind of year (leap or not, from each weekday) that 28 years hold; the
 * tests compare far longer. At about 12 µs a date this stays under a
 * millisecond for each rule a list reads.
 */
const DATES_COMPARED = 30;
/**
 * Answers kept. The task list reads every task again on each change of the
 * store, in the same order, so a cache smaller than the rules it reads misses
 * every one of them every time (600 folded tasks: about 250 ms a change
 * instead of 5). Each answer is a key of about 150 characters.
 */
const SAME_DATES_KEPT = 5000;
const sameDatesSeen = new Map<string, boolean>();

/**
 * True when ical.js expands `a` and `b` from `start` to the same dates, all
 * of them or the first DATES_COMPARED. A pair whose expansion runs out of
 * budget counts as different. Remembered, as the lists ask again on every
 * change of the store.
 */
function sameDates(a: ICAL.Recur, b: ICAL.Recur, start: ICAL.Time): boolean {
  const key = [a.toString(), b.toString(), start.toString(), start.zone?.tzid ?? ''].join('|');
  const seen = sameDatesSeen.get(key);
  if (seen !== undefined) return seen;
  const ia = a.iterator(start);
  const ib = b.iterator(start);
  const budget = budgetRecurrence([ia, ib]);
  let same = true;
  for (let n = 0; same && n < DATES_COMPARED; n++) {
    const x = ia.next();
    const y = ib.next();
    if (!x || !y) {
      same = !x && !y;
      break;
    }
    same = x.compare(y) === 0;
  }
  same &&= !budget.cut;
  if (sameDatesSeen.size >= SAME_DATES_KEPT) sameDatesSeen.clear();
  sameDatesSeen.set(key, same);
  return same;
}

/**
 * The editor's model of a rule from `start`, its DTSTART: that of the rule as
 * written, or of the editor's own form of it (`editorSpelling`) when the two
 * give the same dates. The model then shows as the preset it is ("Every year
 * on 5 January" for FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=5 from 5 January). The
 * fold depends on DTSTART: once DTSTART moves, a rule written in the other
 * form keeps its spelling only while that still gives the model's dates (see
 * keepsRule), so a preset follows the new start as presets do.
 */
function editableRule(recur: ICAL.Recur, start: ICAL.Time | undefined): RecurrenceRule | undefined {
  const own = editorModel(recur);
  if (!start) return own;
  const spelled = editorSpelling(recur, start);
  if (spelled.toString() === recur.toString()) return own;
  const model = editorModel(spelled);
  return model && sameDates(recur, spelled, start) ? model : own;
}

/** What a component's recurrence starts from: DTSTART, or the DUE of a task without one. */
function recurrenceStart(comp: ICAL.Component): ICAL.Time | undefined {
  try {
    const start = comp.getFirstPropertyValue('dtstart') ?? (comp.name === 'vtodo' ? comp.getFirstPropertyValue('due') : null);
    return start instanceof ICAL.Time ? start : undefined;
  } catch {
    return undefined; // a malformed date: no fold
  }
}

function writtenRule(recur: ICAL.Recur): WrittenRule {
  const by: WrittenRule['by'] = {};
  for (const [name, values] of Object.entries(recur.parts as Record<string, (string | number)[] | undefined>)) {
    if (values?.length) by[name] = [...values];
  }
  return {
    freq: recur.freq as WrittenFreq,
    interval: recur.interval || 1,
    count: recur.count ?? undefined,
    until: recur.until ? recur.until.toJSDate() : undefined,
    by,
  };
}

/**
 * The recurrence of an event or task as the editors see it: a rule they can
 * show (`rrule`), also one written in another form of theirs with the same
 * dates from the component's DTSTART (editableRule), one they show read-only
 * (`ruleAsWritten`), or none. Throws, like ical.js, on an RRULE it cannot read.
 */
export function readRecurrence(comp: ICAL.Component): { rrule?: RecurrenceRule; ruleAsWritten?: RuleAsWritten } {
  const rules = comp
    .getAllProperties('rrule')
    .map((p) => p.getFirstValue())
    .filter((v): v is ICAL.Recur => v instanceof ICAL.Recur);
  const extraDates = comp.hasProperty('rdate');
  if (!rules.length && !extraDates) return {};
  const excludeRules = comp.hasProperty('exrule');
  const rrule = rules.length === 1 && !extraDates && !excludeRules ? editableRule(rules[0], recurrenceStart(comp)) : undefined;
  return rrule ? { rrule } : { ruleAsWritten: { rules: rules.map(writtenRule), extraDates, excludeRules } };
}

/**
 * True when the component's recurrence can stay as it is for `rule`, the
 * editor's version of it: the editor shows that recurrence in full and the
 * user left it as it was, so it keeps its own spelling. A recurrence the
 * editor cannot show is never "the same" as one of its rules; it is kept
 * through `ruleAsWritten` instead (see applyRecurrence). The rule is read
 * from the DTSTART the component has now: one in another form of the
 * editor's rule stays only while it still has that rule's dates from there
 * (a yearly rule naming 5 January is replaced when the start moves to May).
 */
export function keepsRule(comp: ICAL.Component, rule: RecurrenceRule | undefined, allDay: boolean): boolean {
  let model: RecurrenceRule | undefined;
  try {
    model = readRecurrence(comp).rrule;
  } catch {
    return false; // unreadable: replaced
  }
  if (!model || !sameRule(model, rule)) return false;
  // UNTIL has to be a DATE exactly when DTSTART is one.
  const until = (comp.getFirstPropertyValue('rrule') as ICAL.Recur).until;
  return !until || until.isDate === allDay;
}

/** `until` as a DATE for an all-day series, otherwise as a UTC DATE-TIME at the end of that day. */
function untilAs(until: ICAL.Time, allDay: boolean): ICAL.Time {
  const d = until.toJSDate();
  return allDay
    ? ICAL.Time.fromData({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true })
    : ICAL.Time.fromJSDate(endOfDayLocal(d), true);
}

/** The last second of the local day of `d`: the end of a series that ends on that day. */
export function endOfDayLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

/**
 * Writes the editor's recurrence onto a component. A recurrence the editor
 * showed read-only (`ruleAsWritten` without `rrule`) stays as written, and so
 * does an unchanged rule it shows in full, with the EXDATEs of either. Any
 * other choice replaces RRULE, RDATE and EXRULE; "does not repeat" also drops
 * the EXDATEs, which then exclude nothing.
 */
export function applyRecurrence(comp: ICAL.Component, data: { rrule?: RecurrenceRule; ruleAsWritten?: RuleAsWritten }, allDay: boolean) {
  if (!data.rrule && data.ruleAsWritten) {
    // As written, except for the form of UNTIL, which has to follow DTSTART
    // when the event moves between all-day and timed.
    for (const prop of comp.getAllProperties('rrule')) {
      const recur = prop.getFirstValue();
      if (!(recur instanceof ICAL.Recur) || !recur.until || recur.until.isDate === allDay) continue;
      const fixed = recur.clone();
      fixed.until = untilAs(recur.until, allDay);
      prop.setValue(fixed);
    }
    return;
  }
  if (keepsRule(comp, data.rrule, allDay)) return;
  comp.removeAllProperties('rrule');
  comp.removeAllProperties('rdate');
  comp.removeAllProperties('exrule');
  if (data.rrule) comp.addPropertyWithValue('rrule', recurToIcal(data.rrule, allDay));
  else comp.removeAllProperties('exdate');
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function weekdayCode(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

/** n-th weekday of month for a date, -1 when it is the last one. */
export function weekdayPosition(d: Date): number {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (d.getDate() + 7 > daysInMonth) return -1;
  return Math.ceil(d.getDate() / 7);
}

export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly' | 'custom';

export function presetRule(preset: RepeatPreset, start: Date): RecurrenceRule | undefined {
  switch (preset) {
    case 'daily':
      return { freq: 'DAILY', interval: 1 };
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1, byDay: [weekdayCode(start)] };
    case 'weekdays':
      return { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] };
    case 'monthly':
      return { freq: 'MONTHLY', interval: 1, byMonthDay: [start.getDate()] };
    case 'yearly':
      return { freq: 'YEARLY', interval: 1 };
    default:
      return undefined;
  }
}

export function detectPreset(rule: RecurrenceRule | undefined, start: Date): RepeatPreset {
  if (!rule) return 'none';
  if (rule.count || rule.until || rule.interval > 1 || rule.byMonth?.length) return 'custom';
  for (const p of ['daily', 'weekly', 'weekdays', 'monthly', 'yearly'] as const) {
    const candidate = presetRule(p, start)!;
    if (sameRule(candidate, rule)) return p;
  }
  if (rule.freq === 'MONTHLY' && !rule.byDay && !rule.byMonthDay) return 'monthly';
  if (rule.freq === 'WEEKLY' && !rule.byDay) return 'weekly';
  return 'custom';
}
