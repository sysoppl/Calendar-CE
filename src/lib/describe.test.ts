import ICAL from 'ical.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFormatter } from '@/hooks/useFormat';
import { loadLanguage, translate, type Lang, type TFunction } from '@/i18n';
import { describeAlarm, describeAsWritten, describeRule, ordinal } from './describe';
import { readRecurrence } from './ical/recurrence';

/** How the editors and the event popover describe the recurrence of a VEVENT with `lines`. */
function described(lang: Lang, ...lines: string[]): string | undefined {
  const comp = new ICAL.Component(
    ICAL.parse(['BEGIN:VEVENT', 'UID:d', 'DTSTART:20260105T093000', ...lines, 'END:VEVENT'].join('\r\n')) as unknown as unknown[],
  );
  const { ruleAsWritten } = readRecurrence(comp);
  if (!ruleAsWritten) throw new Error('The editors show this rule');
  const t: TFunction = (key, vars) => translate(lang, key, vars);
  return describeAsWritten(ruleAsWritten, new Date(2026, 0, 5, 9, 30), t, makeFormatter(lang, '24h'));
}

describe('describeAsWritten', () => {
  it.each([
    ['RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'Monthly (on the last weekday)', 'Co miesiąc (ostatni dzień roboczy)'],
    ['RRULE:FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1;COUNT=3', 'Monthly (on the first weekend day), 3 times', 'Co miesiąc (pierwszy dzień weekendu), 3 razy'],
    ['RRULE:FREQ=MONTHLY;BYDAY=1MO,3WE', 'Monthly (on the first Monday, third Wednesday)', 'Co miesiąc (pierwszy poniedziałek, trzecia środa)'],
    ['RRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=-1', 'Monthly (on the last Sunday)', 'Co miesiąc (ostatnia niedziela)'],
    ['RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'Yearly (in March; on the last Sunday)', 'Co roku (w miesiącach: marzec; ostatnia niedziela)'],
    ['RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', 'Monthly (on the last day of the month)', 'Co miesiąc (ostatniego dnia miesiąca)'],
    ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15', 'Monthly (on day 1, 15)', 'Co miesiąc (dnia 1, 15)'],
    ['RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=8', 'Every 6 hour(s), 8 times', 'Co 6 godz., 8 razy'],
    ['RRULE:FREQ=MINUTELY', 'Every minute', 'Co minutę'],
    ['RRULE:FREQ=DAILY;BYHOUR=9,17', 'Daily (at 09:30, 17:30)', 'Codziennie (o 9:30, 17:30)'],
    // Every day of them from a Monday is the "Every weekday" preset (readRecurrence).
    ['RRULE:FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR', 'Every 2 day(s) (on weekdays)', 'Co 2 dni (w dni robocze)'],
    ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU', 'Every 2 week(s) (on Mon, Sun)', 'Co 2 tyg. (w dni: pon., niedz.)'],
    ['RDATE:20260302T093000,20260316T093000', 'On selected dates', 'W wybrane dni'],
    ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\r\nRDATE:20260302T093000', 'Weekly on Mon, 4 times, plus other dates', 'Co tydzień: pon., 4 razy, a także w inne dni'],
  ])('%s', (rule, en, pl) => {
    expect(described('en', ...rule.split('\r\n'))).toBe(en);
    expect(described('pl', ...rule.split('\r\n'))).toBe(pl);
  });

  it.each([
    ['BYWEEKNO', 'RRULE:FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO'],
    ['BYYEARDAY', 'RRULE:FREQ=YEARLY;BYYEARDAY=100'],
    ['BYSETPOS over other days', 'RRULE:FREQ=MONTHLY;BYDAY=MO,WE;BYSETPOS=2'],
    ['a fifth weekday', 'RRULE:FREQ=MONTHLY;BYDAY=5FR'],
    ['every minute of one hour', 'RRULE:FREQ=MINUTELY;BYHOUR=9'],
    ['two rules', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=5', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=20'],
    ['an EXRULE', 'RRULE:FREQ=DAILY;BYHOUR=9', 'EXRULE:FREQ=WEEKLY;BYDAY=SA,SU'],
    // Friday the 13th: a list of both would read as either.
    ['a weekday that has to be a given day of the month too', 'RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13'],
    ['the n-th weekday on a given day of the month', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;BYMONTHDAY=1,2,3'],
    // The 5th of every month, not once a year.
    ['a yearly rule on a day of every month', 'RRULE:FREQ=YEARLY;BYMONTHDAY=5'],
    ['more days than a month has', `RRULE:FREQ=MONTHLY;BYMONTHDAY=${[...Array.from({ length: 31 }, (_, i) => i + 1), -2].join(',')}`],
  ])('leaves a rule with %s to "Custom repeat rule"', (_, ...lines) => {
    expect(described('en', ...lines)).toBeUndefined();
  });
});

describe('describeRule', () => {
  it('names a weekly rule without days as weekly', () => {
    const t: TFunction = (key, vars) => translate('en', key, vars);
    expect(describeRule({ freq: 'WEEKLY', interval: 1 }, t, makeFormatter('en', '24h'))).toBe('Weekly');
  });
});

describe('describeAlarm', () => {
  const t: TFunction = (key, vars) => translate('en', key, vars);
  const fmt = makeFormatter('en', '24h');

  it('names an all-day event\'s reminder by the day and the time on it', () => {
    expect(describeAlarm(10080, true, t, fmt)).toBe('1 week before');
    expect(describeAlarm(9540, true, t, fmt)).toBe('1 week before at 09:00');
    expect(describeAlarm(19620, true, t, fmt)).toBe('2 weeks before at 09:00');
    expect(describeAlarm(2340, true, t, fmt)).toBe('2 days before at 09:00');
    expect(describeAlarm(900, true, t, fmt)).toBe('The day before at 09:00');
    expect(describeAlarm(-540, true, t, fmt)).toBe('On the day at 09:00');
    expect(describeAlarm(2880, true, t, fmt)).toBe('2 days before');
  });

  it('names a timed event\'s reminder by the largest whole unit', () => {
    expect(describeAlarm(10080, false, t, fmt)).toBe('1 week before');
    expect(describeAlarm(9540, false, t, fmt)).toBe('159 hours before');
    expect(describeAlarm(90, false, t, fmt)).toBe('90 minutes before');
  });
});

describe('the ordinal before a weekday', () => {
  beforeAll(() => Promise.all((['pt', 'it', 'uk', 'es'] as const).map(loadLanguage)));
  const ordinalOf = (lang: Lang, n: number, day?: string) => ordinal(n, day, lang, (key, vars) => translate(lang, key, vars));

  it.each([
    ['pl', 'WE', 'pierwsza'],
    ['pl', 'MO', 'pierwszy'],
    ['pt', 'MO', 'primeira'],
    ['pt', 'SA', 'primeiro'],
    ['it', 'SA', 'primo'],
    ['it', 'SU', 'prima'],
    ['uk', 'FR', 'перша'],
    ['uk', 'TH', 'перший'],
    ['es', 'WE', 'primer'],
    ['en', 'WE', 'first'],
  ] as const)('agrees with the weekday in %s (%s: %s)', (lang, day, word) => {
    expect(ordinalOf(lang, 1, day)).toBe(word);
  });

  it('is masculine without a weekday, and none for a position not named', () => {
    expect(ordinalOf('pt', -1)).toBe('último');
    expect(ordinalOf('pl', 5, 'WE')).toBeUndefined();
  });

  it('agrees in the description of a monthly rule', () => {
    const t: TFunction = (key, vars) => translate('pt', key, vars);
    expect(describeRule({ freq: 'MONTHLY', interval: 1, byDay: ['1MO'] }, t, makeFormatter('pt', '24h'))).toContain('primeira segunda-feira');
    const pl: TFunction = (key, vars) => translate('pl', key, vars);
    expect(describeRule({ freq: 'MONTHLY', interval: 1, byDay: ['-1SU'] }, pl, makeFormatter('pl', '24h'))).toContain('ostatnia niedziela');
  });
});
