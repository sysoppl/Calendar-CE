import { describe, expect, it } from 'vitest';
import { easterSunday, HOLIDAY_COUNTRIES, holidaysIn } from './holidays';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dates = (code: string, year: number) => Object.fromEntries(holidaysIn(code, year).map((h) => [h.name.en, ymd(h.date)]));

describe('easterSunday', () => {
  it('matches known dates', () => {
    expect(ymd(easterSunday(2024))).toBe('2024-03-31');
    expect(ymd(easterSunday(2025))).toBe('2025-04-20');
    expect(ymd(easterSunday(2026))).toBe('2026-04-05');
    expect(ymd(easterSunday(2027))).toBe('2027-03-28');
    expect(ymd(easterSunday(2038))).toBe('2038-04-25');
  });
});

describe('holidaysIn', () => {
  it('computes fixed and Easter-based holidays for Poland', () => {
    const pl = dates('PL', 2026);
    expect(pl['Easter Monday']).toBe('2026-04-06');
    expect(pl['Whit Sunday']).toBe('2026-05-24');
    expect(pl['Corpus Christi']).toBe('2026-06-04');
    expect(pl['Independence Day']).toBe('2026-11-11');
    expect(holidaysIn('PL', 2026).find((h) => h.name.en === 'Corpus Christi')?.name.pl).toBe('Boże Ciało');
  });

  it('honours the year a holiday was introduced', () => {
    expect(dates('PL', 2024)['Christmas Eve']).toBeUndefined();
    expect(dates('PL', 2025)['Christmas Eve']).toBe('2025-12-24');
  });

  it('finds the n-th and the last weekday of a month', () => {
    const us = dates('US', 2026);
    expect(us['Martin Luther King Jr. Day']).toBe('2026-01-19');
    expect(us['Memorial Day']).toBe('2026-05-25');
    expect(us['Labor Day']).toBe('2026-09-07');
    expect(us['Thanksgiving Day']).toBe('2026-11-26');
  });

  it('adds the observed day for US holidays on a weekend', () => {
    // 4 July 2026 is a Saturday, so the Friday before is the day off.
    expect(dates('US', 2026)['Independence Day (observed)']).toBe('2026-07-03');
    // 1 January 2028 is a Saturday: observed on the last day of 2027.
    expect(dates('US', 2028)["New Year's Day (observed)"]).toBe('2027-12-31');
    expect(dates('US', 2025)['Independence Day (observed)']).toBeUndefined();
  });

  it('gives UK holidays on a weekend the next free weekday', () => {
    // 2026: Christmas on Friday, Boxing Day on Saturday.
    expect(dates('GB', 2026)['Boxing Day (substitute day)']).toBe('2026-12-28');
    expect(dates('GB', 2026)['Christmas Day (substitute day)']).toBeUndefined();
    // 2027: Saturday and Sunday, so Monday and Tuesday are substitutes.
    const gb = dates('GB', 2027);
    expect(gb['Christmas Day (substitute day)']).toBe('2027-12-27');
    expect(gb['Boxing Day (substitute day)']).toBe('2027-12-28');
    // 2022: Christmas on Sunday; Monday is Boxing Day itself.
    expect(dates('GB', 2022)['Christmas Day (substitute day)']).toBe('2022-12-27');
  });

  it('handles movable national days', () => {
    expect(dates('NL', 2025)["King's Day"]).toBe('2025-04-26'); // the 27th is a Sunday
    expect(dates('NL', 2026)["King's Day"]).toBe('2026-04-27');
    expect(dates('CA', 2026)['Victoria Day']).toBe('2026-05-18');
    expect(dates('SE', 2026)['Midsummer Day']).toBe('2026-06-20');
    expect(dates('FI', 2026)["All Saints' Day"]).toBe('2026-10-31');
    expect(dates('IE', 2026)["St. Brigid's Day"]).toBe('2026-02-02');
    expect(dates('IE', 2030)["St. Brigid's Day"]).toBe('2030-02-01'); // a Friday
  });

  it('returns sorted holidays for every country and nothing for unknown ones', () => {
    for (const country of HOLIDAY_COUNTRIES) {
      const list = holidaysIn(country.code, 2026);
      expect(list.length).toBeGreaterThan(5);
      expect(list.every((h, i) => i === 0 || list[i - 1].date <= h.date)).toBe(true);
      expect(list.every((h) => h.name.en && h.name.pl)).toBe(true);
    }
    expect(holidaysIn('XX', 2026)).toEqual([]);
  });
});
