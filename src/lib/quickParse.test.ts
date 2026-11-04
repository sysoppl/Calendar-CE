import { describe, expect, it } from 'vitest';
import { quickParse } from './quickParse';

const now = new Date(2026, 9, 12, 10); // Monday 12 Oct 2026

describe('quickParse', () => {
  it('parses relative days in English and Polish', () => {
    expect(quickParse('Call Anna tomorrow', now)).toEqual({ title: 'Call Anna', due: new Date(2026, 9, 13), priority: undefined });
    expect(quickParse('Raport jutro', now).due).toEqual(new Date(2026, 9, 13));
    expect(quickParse('Zakupy dziś', now).due).toEqual(new Date(2026, 9, 12));
    expect(quickParse('Dentist in 3 days', now).due).toEqual(new Date(2026, 9, 15));
    expect(quickParse('Opłaty za 10 dni', now).due).toEqual(new Date(2026, 9, 22));
  });

  it('parses weekdays as the next occurrence', () => {
    expect(quickParse('Pay rent fri', now).due).toEqual(new Date(2026, 9, 16));
    expect(quickParse('Spotkanie w piątek', now).due).toEqual(new Date(2026, 9, 16));
    expect(quickParse('Gym monday', now).due).toEqual(new Date(2026, 9, 19));
    expect(quickParse('Plan next week', now).due).toEqual(new Date(2026, 9, 19));
  });

  it('parses numeric dates and rolls past dates into next year', () => {
    expect(quickParse('Dentist 24.10', now).due).toEqual(new Date(2026, 9, 24));
    expect(quickParse('Taxes 2026-12-01', now).due).toEqual(new Date(2026, 11, 1));
    expect(quickParse('Birthday 3.02', now).due).toEqual(new Date(2027, 1, 3));
  });

  it('parses leading dates and priorities', () => {
    expect(quickParse('tomorrow buy milk !!', now)).toEqual({ title: 'buy milk', due: new Date(2026, 9, 13), priority: 1 });
    expect(quickParse('Read book !', now)).toEqual({ title: 'Read book', priority: 5 });
  });

  it('leaves plain titles alone', () => {
    expect(quickParse('Monday report', now).title).toBe('report');
    expect(quickParse('Water plants', now)).toEqual({ title: 'Water plants', priority: undefined });
    expect(quickParse('tomorrow', now)).toEqual({ title: 'tomorrow', priority: undefined });
  });
});
