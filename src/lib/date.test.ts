import { describe, expect, it } from 'vitest';
import { setMinutesOfDay, stepDate, viewRange, wallMinutes } from './date';

// Tests run with TZ=Europe/Warsaw: clocks go back on 2026-10-25 (25 h day)
// and forward on 2027-03-28 (23 h day).
describe('wall-clock grid positions', () => {
  it('keeps events on their hour line when the day has 25 hours', () => {
    const day = new Date(2026, 9, 25);
    expect(wallMinutes(new Date(2026, 9, 25, 10, 0), day)).toBe(600);
    expect(wallMinutes(new Date(2026, 9, 25, 23, 15), day)).toBe(23 * 60 + 15);
    expect(wallMinutes(new Date(2026, 9, 26, 0, 30), day)).toBe(1470);
    expect(wallMinutes(new Date(2026, 9, 24, 23, 0), day)).toBe(-60);
  });

  it('keeps events on their hour line when the day has 23 hours', () => {
    const day = new Date(2027, 2, 28);
    expect(wallMinutes(new Date(2027, 2, 28, 10, 0), day)).toBe(600);
    expect(wallMinutes(new Date(2027, 2, 29, 0, 0), day)).toBe(1440);
  });

  it('turns a grid position back into the same wall-clock time', () => {
    for (const day of [new Date(2026, 9, 25), new Date(2027, 2, 28), new Date(2026, 5, 1)]) {
      const at = setMinutesOfDay(day, 600);
      expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([day.getDate(), 10, 0]);
      expect(wallMinutes(at, day)).toBe(600);
    }
    const next = setMinutesOfDay(new Date(2026, 9, 25), 1440);
    expect([next.getDate(), next.getHours()]).toEqual([26, 0]);
  });
});

describe('periods of the views', () => {
  it('shows a whole week in the week view, on every screen', () => {
    const range = viewRange('week', new Date(2026, 9, 16), 1);
    expect([range.start, range.end]).toEqual([new Date(2026, 9, 12), new Date(2026, 9, 19)]);
    expect(stepDate('week', new Date(2026, 9, 16), 1)).toEqual(new Date(2026, 9, 23));
  });

  it('shows the number of days chosen in the "N days" view', () => {
    const range = viewRange('days', new Date(2026, 9, 16), 1, 3);
    expect([range.start, range.end]).toEqual([new Date(2026, 9, 16), new Date(2026, 9, 19)]);
    expect(stepDate('days', new Date(2026, 9, 16), -1, 3)).toEqual(new Date(2026, 9, 13));
  });
});
