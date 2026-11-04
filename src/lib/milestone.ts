// Birthdays and anniversaries: an event whose title names one can carry the
// date it counts from (a birth date, a wedding day), and the calendar then
// shows how old someone turns or which anniversary it is.
//
// The date lives in X-PATRYKPRO-SINCE;VALUE=DATE on the series' master. No
// iCalendar standard has a property for it, and the year of DTSTART cannot
// stand in for it: events made before this property existed start on the
// year they were made. Earlier versions of the app keep the property as
// written when they save (applyEventData keeps what it does not model), other
// clients ignore it.
import ICAL from 'ical.js';
import type { TFunction } from '@/i18n';
import type { Formatter } from '@/hooks/useFormat';
import { setTimeProp } from './ical/time';

export const SINCE_PROPERTY = 'x-patrykpro-since';

export type MilestoneKind = 'birthday' | 'anniversary';

// A word starts the title or follows anything but a letter or digit; lookbehind
// is left out for older WebViews. Stems end in \p{L}* (urodziny, urodzin,
// urodzinki); short words must stand alone.
const START = '(?:^|[^\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';
const words = (parts: string[]) => new RegExp(`${START}(?:${parts.join('|')})${END}`, 'iu');

/**
 * Anniversaries first: "rocznica urodzin" (of someone's birth) is one, and the
 * French and Portuguese words for a birthday name an anniversary when a
 * wedding follows. Unaccented "aniversario" is the Spanish anniversary.
 */
const ANNIVERSARY = words([
  'anniversary', 'anniversaries',
  'rocznic\\p{L}*',
  '\\p{L}*jahrestag\\p{L}*', 'hochzeitstag\\p{L}*', 'jubil[äa]um\\p{L}*',
  'aniversario\\p{L}*',
  'anniversaire\\s+(?:de\\s+)?(?:mariage|rencontre|couple|décès|deces|mort)', 'noces',
  'anniversari[oi]',
  'aniversário\\s+de\\s+(?:casamento|namoro|morte|falecimento)', 'bodas',
  'річниц\\p{L}*',
  'výročí', 'vyroci',
  'jubileum\\p{L}*', 'trouwdag\\p{L}*',
]);

const BIRTHDAY = words([
  'birthday\\p{L}*', 'birth\\s+day', 'b-?days?', "b'days?",
  'urodzin\\p{L}*',
  '\\p{L}*geburtstag\\p{L}*',
  'cumpleaños', 'cumpleanos', 'cumple',
  'anniversaire',
  'compleann[oi]',
  'aniversário', 'niver',
  '(?:день|дня|днем|дню)\\s+народження', 'днюх\\p{L}*',
  'narozenin\\p{L}*',
  'verjaardag\\p{L}*', 'jarig',
]);

/** Which kind of yearly day the title names, by its words alone. */
export function milestoneKind(title: string): MilestoneKind | undefined {
  if (!title) return undefined;
  if (ANNIVERSARY.test(title)) return 'anniversary';
  if (BIRTHDAY.test(title)) return 'birthday';
  return undefined;
}

/** The years from `since` to `on`: the age someone turns or the anniversary's number; none before the first. */
export function milestoneYears(since: Date, on: Date): number | undefined {
  const years = on.getFullYear() - since.getFullYear();
  return years >= 1 ? years : undefined;
}

export interface Milestone {
  kind: MilestoneKind;
  years: number;
}

/** What an event on `on` marks, given its title and the date it counts from. */
export function milestoneOf(item: { title: string; since?: Date }, on: Date): Milestone | undefined {
  if (!item.since) return undefined;
  const kind = milestoneKind(item.title);
  const years = kind && milestoneYears(item.since, on);
  return kind && years ? { kind, years } : undefined;
}

/** The title as the calendar's grids, search and reminders show it: "Anna's birthday (36)". */
export function titleWithYears(item: { title: string; since?: Date; start: Date }, noTitle = ''): string {
  const title = item.title || noTitle;
  const m = milestoneOf(item, item.start);
  return m ? `${title} (${m.years})` : title;
}

/** The date a VEVENT counts from, as a local midnight; none when it has none or one that cannot be read. */
export function readSince(comp: ICAL.Component): Date | undefined {
  const prop = comp.getFirstProperty(SINCE_PROPERTY);
  if (!prop) return undefined;
  let value: unknown;
  try {
    value = prop.getFirstValue();
  } catch {
    return undefined;
  }
  let y: number, m: number, d: number;
  if (value instanceof ICAL.Time) ({ year: y, month: m, day: d } = value);
  else {
    const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(value ?? '').trim());
    if (!match) return undefined;
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return validDate(y, m, d);
}

/** Writes (or with none, removes) the date a VEVENT counts from. */
export function writeSince(comp: ICAL.Component, since: Date | undefined) {
  if (!since) {
    comp.removeAllProperties(SINCE_PROPERTY);
    return;
  }
  setTimeProp(comp, SINCE_PROPERTY, ICAL.Time.fromData({ year: since.getFullYear(), month: since.getMonth() + 1, day: since.getDate(), isDate: true }));
}

/** The dictionaries' forms of a number for its birthday or anniversary (1st, 2nd, 3rd, 4th; 1er in French). */
function ordinalForm(n: number, locale: string): 'one' | 'two' | 'few' | 'other' {
  let form: string = 'other';
  try {
    form = new Intl.PluralRules(locale, { type: 'ordinal' }).select(n);
  } catch {
    // An engine without the rules: the dictionaries' plain form.
  }
  return form === 'one' || form === 'two' || form === 'few' ? form : 'other';
}

/** "Turns 36", "10th anniversary". */
export function describeMilestone(m: Milestone, t: TFunction, fmt: Formatter): string {
  return t(`milestone.${m.kind}.${ordinalForm(m.years, fmt.locale)}`, { n: m.years });
}

/** "Born 12 May 1990", "Since 12 May 1990". */
export function describeSince(kind: MilestoneKind, since: Date, t: TFunction, fmt: Formatter): string {
  return t(kind === 'birthday' ? 'milestone.born' : 'milestone.since', { date: fmt.date(since, { day: 'numeric', month: 'long', year: 'numeric' }) });
}

/** A date as a date input holds it ("1990-05-12"); empty for none. */
export function sinceToInput(date: Date | undefined): string {
  if (!date) return '';
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A date input's value as a local midnight; none for an empty or partly typed one. */
export function sinceFromInput(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * The earliest year taken. ical.js writes a DATE's year unpadded, so one below
 * 1000 would make a value other clients cannot read (and a date input hands
 * over "0199" while the year is still being typed).
 */
export const MIN_SINCE_YEAR = 1000;

/** A local midnight on that day; none for a day that does not exist (2023-02-30) or a year before MIN_SINCE_YEAR. */
function validDate(y: number, m: number, d: number): Date | undefined {
  if (y < MIN_SINCE_YEAR || y > 9999) return undefined;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

/**
 * The day in `year` that an event counting from `since` falls on: the same
 * day and month, and 28 February for 29 February, so that a yearly rule
 * comes every year (one starting on the 29th only comes in leap years).
 */
export function dayInYear(since: Date, year: number): Date {
  const leapDay = since.getMonth() === 1 && since.getDate() === 29;
  return new Date(year, since.getMonth(), leapDay ? 28 : since.getDate());
}
