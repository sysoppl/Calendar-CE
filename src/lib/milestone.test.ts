import ICAL from 'ical.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFormatter } from '@/hooks/useFormat';
import { loadLanguage, translate, type Lang, type TFunction } from '@/i18n';
import { createEventIcs, eventDataFor, expandEvent, updateEvent } from './ical/events';
import { parseObject, type RawObject } from './ical/parse';
import type { EventData } from './ical/types';
import {
  dayInYear,
  describeMilestone,
  describeSince,
  milestoneKind,
  milestoneOf,
  milestoneYears,
  readSince,
  sinceFromInput,
  sinceToInput,
  titleWithYears,
  writeSince,
} from './milestone';

const raw = (data: string, url = 'https://x.test/cal/m.ics'): RawObject => ({ url, etag: '"1"', calendarId: 'cal', data: data.replace(/\r?\n/g, '\r\n') });
const parse = (data: string, url?: string) => parseObject(raw(data, url))!;
const vevent = (...lines: string[]) => new ICAL.Component(ICAL.parse(['BEGIN:VEVENT', 'UID:m', ...lines, 'END:VEVENT'].join('\r\n')) as unknown as unknown[]);

const BIRTHDAY = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:bday-1
DTSTART;VALUE=DATE:20240512
DTEND;VALUE=DATE:20240513
RRULE:FREQ=YEARLY
SUMMARY:Anna's birthday
X-PATRYKPRO-SINCE;VALUE=DATE:19900512
X-OTHER-CLIENT:kept
END:VEVENT
END:VCALENDAR`;

const data = (over: Partial<EventData> = {}): EventData => ({
  uid: 'u1',
  title: 'Mum’s birthday',
  description: '',
  location: '',
  start: new Date(2026, 4, 12),
  end: new Date(2026, 4, 13),
  allDay: true,
  timezone: 'floating',
  alarms: [],
  busy: false,
  attendees: [],
  categories: [],
  ...over,
});

describe('milestoneKind', () => {
  it.each([
    ['Anna’s birthday', 'birthday'],
    ['BIRTHDAY Tom', 'birthday'],
    ['bday party', 'birthday'],
    ['Kate b-day', 'birthday'],
    ['Urodziny mamy', 'birthday'],
    ['18. urodzin Kasi', 'birthday'],
    ['urodzinki Zosi', 'birthday'],
    ['Omas Geburtstag', 'birthday'],
    ['Kindergeburtstag', 'birthday'],
    ['Cumpleaños de Ana', 'birthday'],
    ['Anniversaire de Paul', 'birthday'],
    ['Compleanno di Luca', 'birthday'],
    ['Aniversário da Maria', 'birthday'],
    ['День народження Олі', 'birthday'],
    ['Narozeniny Petra', 'birthday'],
    ['Verjaardag oma', 'birthday'],
    ['Wedding anniversary', 'anniversary'],
    ['Rocznica ślubu', 'anniversary'],
    ['100. rocznica urodzin Chopina', 'anniversary'],
    ['Hochzeitstag', 'anniversary'],
    ['Aniversario de boda', 'anniversary'],
    ['Anniversaire de mariage', 'anniversary'],
    ['Anniversaire décès papa', 'anniversary'],
    ['Aniversário de falecimento do avô', 'anniversary'],
    ['Anniversario di nozze', 'anniversary'],
    ['Aniversário de casamento', 'anniversary'],
    ['Річниця весілля', 'anniversary'],
    ['Výročí svatby', 'anniversary'],
    ['Trouwdag', 'anniversary'],
  ])('%s is a %s', (title, kind) => {
    expect(milestoneKind(title)).toBe(kind);
  });

  it.each(['Dentist', 'Birth of a project', 'Rebirthday', 'Narodowe Święto', 'Bdays2', 'imieniny', ''])('%s is neither', (title) => {
    expect(milestoneKind(title)).toBeUndefined();
  });
});

describe('years', () => {
  it('counts calendar years and none before the first', () => {
    expect(milestoneYears(new Date(1990, 4, 12), new Date(2026, 4, 12))).toBe(36);
    expect(milestoneYears(new Date(2026, 4, 12), new Date(2026, 4, 12))).toBeUndefined();
    expect(milestoneYears(new Date(2030, 0, 1), new Date(2026, 4, 12))).toBeUndefined();
  });

  it('needs both the words and the date', () => {
    const since = new Date(1990, 4, 12);
    expect(milestoneOf({ title: 'Anna’s birthday', since }, new Date(2026, 4, 12))).toEqual({ kind: 'birthday', years: 36 });
    expect(milestoneOf({ title: 'Lunch', since }, new Date(2026, 4, 12))).toBeUndefined();
    expect(milestoneOf({ title: 'Anna’s birthday' }, new Date(2026, 4, 12))).toBeUndefined();
    expect(titleWithYears({ title: 'Anna’s birthday', since, start: new Date(2026, 4, 12) })).toBe('Anna’s birthday (36)');
    expect(titleWithYears({ title: 'Lunch', since, start: new Date(2026, 4, 12) })).toBe('Lunch');
    expect(titleWithYears({ title: '', start: new Date(2026, 4, 12) }, '(No title)')).toBe('(No title)');
  });
});

describe('describeMilestone', () => {
  beforeAll(() => Promise.all((['fr', 'uk', 'de'] as const).map(loadLanguage)));
  const say = (lang: Lang, kind: 'birthday' | 'anniversary', years: number) => {
    const t: TFunction = (key, vars) => translate(lang, key, vars);
    return describeMilestone({ kind, years }, t, makeFormatter(lang, '24h'));
  };

  it('uses the ordinal forms of the language', () => {
    expect(say('en', 'birthday', 36)).toBe('Turns 36');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((n) => say('en', 'anniversary', n))).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st'].map((o) => `${o} anniversary`),
    );
    expect(say('pl', 'birthday', 36)).toBe('36. urodziny');
    expect(say('pl', 'anniversary', 10)).toBe('10. rocznica');
    expect(say('fr', 'anniversary', 1)).toBe('1er anniversaire');
    expect(say('fr', 'anniversary', 2)).toBe('2e anniversaire');
    expect(say('de', 'anniversary', 25)).toBe('25. Jahrestag');
    expect(say('uk', 'anniversary', 3)).toBe('Річниця: 3');
  });

  it('names the date counted from', () => {
    const t: TFunction = (key, vars) => translate('en', key, vars);
    expect(describeSince('birthday', new Date(1990, 4, 12), t, makeFormatter('en', '24h'))).toMatch(/^born 12 May 1990$|^born May 12, 1990$/);
    expect(describeSince('anniversary', new Date(2016, 5, 4), t, makeFormatter('en', '24h'))).toMatch(/^since /);
  });
});

describe('dayInYear', () => {
  it('keeps the day and month, and puts 29 February on the 28th every year', () => {
    expect(dayInYear(new Date(1990, 4, 12), 2026)).toEqual(new Date(2026, 4, 12));
    expect(dayInYear(new Date(2000, 1, 29), 2026)).toEqual(new Date(2026, 1, 28));
    expect(dayInYear(new Date(2000, 1, 29), 2028)).toEqual(new Date(2028, 1, 28));
  });
});

describe('the date input', () => {
  it('reads and writes yyyy-mm-dd', () => {
    expect(sinceToInput(new Date(1990, 4, 12))).toBe('1990-05-12');
    expect(sinceToInput(undefined)).toBe('');
    expect(sinceFromInput('1990-05-12')).toEqual(new Date(1990, 4, 12));
    // ical.js writes a DATE's year unpadded: none before 1000, as a date input hands over while the year is typed.
    expect(sinceFromInput('0199-05-12')).toBeUndefined();
    expect(sinceFromInput('1000-01-01')).toEqual(new Date(1000, 0, 1));
    expect(sinceFromInput('')).toBeUndefined();
    expect(sinceFromInput('2023-02-30')).toBeUndefined();
  });
});

describe('X-PATRYKPRO-SINCE', () => {
  it('reads a date, a date written without VALUE=DATE, and ignores nonsense', () => {
    expect(readSince(vevent('X-PATRYKPRO-SINCE;VALUE=DATE:19900512'))).toEqual(new Date(1990, 4, 12));
    expect(readSince(vevent('X-PATRYKPRO-SINCE:19900512'))).toEqual(new Date(1990, 4, 12));
    expect(readSince(vevent('X-PATRYKPRO-SINCE:1990-05-12'))).toEqual(new Date(1990, 4, 12));
    expect(readSince(vevent('X-PATRYKPRO-SINCE:soon'))).toBeUndefined();
    expect(readSince(vevent('X-PATRYKPRO-SINCE:20230230'))).toBeUndefined();
    expect(readSince(vevent('X-PATRYKPRO-SINCE:09990512'))).toBeUndefined();
    expect(readSince(vevent('SUMMARY:x'))).toBeUndefined();
  });

  it('writes a date value and removes it', () => {
    const comp = vevent('SUMMARY:x');
    writeSince(comp, new Date(1990, 4, 12));
    expect(comp.toString()).toContain('X-PATRYKPRO-SINCE;VALUE=DATE:19900512');
    writeSince(comp, undefined);
    expect(comp.toString()).not.toContain('X-PATRYKPRO-SINCE');
  });
});

describe('events with a date counted from', () => {
  it('gives every instance of the series its years', () => {
    const obj = parse(BIRTHDAY);
    const occs = expandEvent(obj, new Date(2026, 0, 1), new Date(2028, 0, 1));
    expect(occs.map((o) => [o.start.getFullYear(), titleWithYears(o)])).toEqual([
      [2026, "Anna's birthday (36)"],
      [2027, "Anna's birthday (37)"],
    ]);
    expect(eventDataFor(obj, occs[0]).since).toEqual(new Date(1990, 4, 12));
  });

  it('keeps an event without one exactly as before', () => {
    const obj = parse(BIRTHDAY.replace('X-PATRYKPRO-SINCE;VALUE=DATE:19900512\n', ''));
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    expect(occ.since).toBeUndefined();
    expect(titleWithYears(occ)).toBe("Anna's birthday");
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), location: 'Home' }, 'all');
    expect((op as { data: string }).data).not.toContain('X-PATRYKPRO-SINCE');
  });

  it('is created, kept by a move, changed and removed', () => {
    const ics = createEventIcs(data({ since: new Date(1965, 4, 12), rrule: { freq: 'YEARLY', interval: 1 } }));
    expect(ics).toContain('X-PATRYKPRO-SINCE;VALUE=DATE:19650512');
    const obj = parse(ics);
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    expect(titleWithYears(occ)).toBe('Mum’s birthday (61)');

    // A drag and drop builds its data from the event, as moveOccurrence does.
    const moved = updateEvent(obj, occ, { ...eventDataFor(obj, occ), start: new Date(2026, 4, 13), end: new Date(2026, 4, 14) }, 'all');
    expect((moved[0] as { data: string }).data).toContain('X-PATRYKPRO-SINCE;VALUE=DATE:19650512');

    const cleared = updateEvent(obj, occ, { ...eventDataFor(obj, occ), since: undefined }, 'all');
    expect((cleared[0] as { data: string }).data).not.toContain('X-PATRYKPRO-SINCE');
  });

  it('keeps the other properties a save does not model', () => {
    const obj = parse(BIRTHDAY);
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), since: new Date(1991, 4, 12) }, 'all');
    expect((op as { data: string }).data).toContain('X-OTHER-CLIENT:kept');
    expect((op as { data: string }).data).toContain('X-PATRYKPRO-SINCE;VALUE=DATE:19910512');
  });

  it('belongs to the series: one instance changed carries the master’s, and a change made there goes to the master', () => {
    const obj = parse(BIRTHDAY);
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    const [kept] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), location: 'Park' }, 'single');
    const keptObj = parse((kept as { data: string }).data);
    expect((kept as { data: string }).data.match(/X-PATRYKPRO-SINCE/g)).toHaveLength(1);
    const moved = expandEvent(keptObj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    expect(moved.isException).toBe(true);
    expect(titleWithYears(moved)).toBe("Anna's birthday (36)");

    const [changed] = updateEvent(keptObj, moved, { ...eventDataFor(keptObj, moved), since: new Date(1992, 4, 12) }, 'single');
    const changedObj = parse((changed as { data: string }).data);
    expect(expandEvent(changedObj, new Date(2027, 0, 1), new Date(2028, 0, 1)).map((o) => titleWithYears(o))).toEqual(["Anna's birthday (35)"]);
  });

  it('stays on an override that has no series (an invitation to one instance)', () => {
    const obj = parse(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:orphan-1
RECURRENCE-ID;VALUE=DATE:20260512
DTSTART;VALUE=DATE:20260512
DTEND;VALUE=DATE:20260513
SUMMARY:Ola's birthday
END:VEVENT
END:VCALENDAR`);
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    const [op] = updateEvent(obj, occ, { ...eventDataFor(obj, occ), since: new Date(1996, 4, 12) }, 'single');
    const saved = parse((op as { data: string }).data);
    expect(titleWithYears(expandEvent(saved, new Date(2026, 0, 1), new Date(2027, 0, 1))[0])).toBe("Ola's birthday (30)");
  });

  it('goes on with the later part of a series that is split', () => {
    const obj = parse(BIRTHDAY);
    const occ = expandEvent(obj, new Date(2026, 0, 1), new Date(2027, 0, 1))[0];
    const ops = updateEvent(obj, occ, { ...eventDataFor(obj, occ), title: 'Anna’s birthday!' }, 'future');
    const created = ops.find((o) => o.type === 'create') as { data: string };
    expect(created.data).toContain('X-PATRYKPRO-SINCE;VALUE=DATE:19900512');
  });
});
