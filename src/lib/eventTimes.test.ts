import { describe, expect, it } from 'vitest';
import { isRangeInvalid, parseTime, shownEnd, withAllDay, withEndDate, withEndTime, withStartDate, withStartTime } from './eventTimes';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const stamp = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

describe('event form times', () => {
  const timed = { start: at(2026, 10, 13, 10), end: at(2026, 10, 13, 10, 30), allDay: false, timezone: 'Europe/Warsaw' };
  const allDay = { start: at(2026, 10, 13), end: at(2026, 10, 15), allDay: true, timezone: 'floating' };

  it('keeps the duration when the start moves', () => {
    const moved = withStartDate(timed, at(2026, 11, 2));
    expect(stamp(moved.start!)).toEqual([2026, 11, 2, 10, 0]);
    expect(stamp(moved.end!)).toEqual([2026, 11, 2, 10, 30]);
    const later = withStartTime(timed, 14 * 60 + 15);
    expect(stamp(later.start!)).toEqual([2026, 10, 13, 14, 15]);
    expect(stamp(later.end!)).toEqual([2026, 10, 13, 14, 45]);
  });

  it('keeps the number of days of an all-day event, also across a clock change', () => {
    // Clocks go back on 25 October 2026 (tests run in Europe/Warsaw).
    const moved = withStartDate(allDay, at(2026, 10, 24));
    expect(stamp(moved.start!)).toEqual([2026, 10, 24, 0, 0]);
    expect(stamp(moved.end!)).toEqual([2026, 10, 26, 0, 0]);
  });

  it('shows all-day ends inclusively and stores them exclusively', () => {
    expect(stamp(shownEnd(allDay))).toEqual([2026, 10, 14, 0, 0]);
    expect(stamp(withEndDate(allDay, at(2026, 10, 20)).end!)).toEqual([2026, 10, 21, 0, 0]);
    expect(shownEnd(timed)).toBe(timed.end);
  });

  it('changes the end without touching the start', () => {
    expect(stamp(withEndDate(timed, at(2026, 10, 14)).end!)).toEqual([2026, 10, 14, 10, 30]);
    expect(stamp(withEndTime(timed, 12 * 60).end!)).toEqual([2026, 10, 13, 12, 0]);
    expect(withEndTime(timed, 720).start).toBeUndefined();
  });

  it('flags an end before the start', () => {
    expect(isRangeInvalid(timed)).toBe(false);
    expect(isRangeInvalid({ ...timed, ...withEndTime(timed, 9 * 60) })).toBe(true);
    expect(isRangeInvalid({ ...timed, end: timed.start })).toBe(false); // a zero-length event is fine
    expect(isRangeInvalid({ ...allDay, end: allDay.start })).toBe(true);
  });

  it('switches between all-day and timed', () => {
    const whole = withAllDay(timed, true, 45);
    expect(stamp(whole.start!)).toEqual([2026, 10, 13, 0, 0]);
    expect(stamp(whole.end!)).toEqual([2026, 10, 14, 0, 0]);
    expect(whole.busy).toBe(false);

    const back = withAllDay(allDay, false, 45, at(2026, 10, 13, 9, 20));
    expect(stamp(back.start!)).toEqual([2026, 10, 13, 10, 0]);
    expect(stamp(back.end!)).toEqual([2026, 10, 13, 10, 45]);
    expect(back.busy).toBe(true);
    expect(back.timezone).not.toBe('floating');

    // Late in the evening the event still starts on the same day.
    expect(stamp(withAllDay(allDay, false, 30, at(2026, 10, 13, 23, 50)).start!)).toEqual([2026, 10, 13, 23, 0]);
    // Early in the morning it starts with the working day.
    expect(stamp(withAllDay(allDay, false, 30, at(2026, 10, 13, 5)).start!)).toEqual([2026, 10, 13, 8, 0]);
  });
});

describe('parseTime', () => {
  it('reads common ways of typing a time', () => {
    expect(parseTime('9')).toBe(540);
    expect(parseTime('9:30')).toBe(570);
    expect(parseTime('09.05')).toBe(545);
    expect(parseTime('930')).toBe(570);
    expect(parseTime('1230')).toBe(750);
    expect(parseTime('21:15')).toBe(1275);
    expect(parseTime(' 9 pm ')).toBe(1260);
    expect(parseTime('9:30 PM')).toBe(1290);
    expect(parseTime('12am')).toBe(0);
    expect(parseTime('12:05 a.m.')).toBe(5);
    expect(parseTime('12 pm')).toBe(720);
    expect(parseTime('0:00')).toBe(0);
  });

  it('rejects what is not a time', () => {
    for (const text of ['', 'noon', '24:00', '9:60', '13pm', '0am', '1:2', '12345', '-3']) expect(parseTime(text), text).toBeUndefined();
  });
});
