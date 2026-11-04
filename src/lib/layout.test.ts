import { describe, expect, it } from 'vitest';
import { layoutSpans, layoutTimed } from './layout';

describe('layoutTimed', () => {
  it('places non-overlapping events in a single column', () => {
    const boxes = layoutTimed([
      { item: 'a', start: 60, end: 120 },
      { item: 'b', start: 120, end: 180 },
    ]);
    expect(boxes.map((b) => [b.item, b.col, b.cols])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('splits overlapping events and lets boxes expand into free columns', () => {
    const boxes = layoutTimed([
      { item: 'a', start: 60, end: 240 },
      { item: 'b', start: 90, end: 120 },
      { item: 'c', start: 150, end: 200 },
      { item: 'd', start: 90, end: 110 },
    ]);
    const byItem = Object.fromEntries(boxes.map((b) => [b.item, b]));
    expect(byItem.a).toMatchObject({ col: 0, cols: 3 });
    expect(byItem.b.col).not.toBe(byItem.d.col);
    // c reuses a column and can span the remaining free one.
    expect(byItem.c.col).toBe(1);
    expect(byItem.c.span).toBe(2);
  });

  it('enforces a minimum height and clips to the day', () => {
    const [box] = layoutTimed([{ item: 'x', start: 1430, end: 1430 }]);
    expect(box.bottom).toBe(1440);
    const [neg] = layoutTimed([{ item: 'y', start: -60, end: 30 }]);
    expect(neg.top).toBe(0);
  });
});

describe('layoutSpans', () => {
  const row = new Date(2026, 9, 12); // Monday
  it('computes columns, spans and lanes', () => {
    const boxes = layoutSpans(
      [
        { item: 'trip', start: new Date(2026, 9, 10), end: new Date(2026, 9, 14) },
        { item: 'conf', start: new Date(2026, 9, 13), end: new Date(2026, 9, 16) },
        { item: 'day', start: new Date(2026, 9, 16), end: new Date(2026, 9, 17) },
        { item: 'next', start: new Date(2026, 9, 18), end: new Date(2026, 9, 21) },
      ],
      row,
      7,
    );
    const by = Object.fromEntries(boxes.map((b) => [b.item, b]));
    expect(by.trip).toMatchObject({ startCol: 0, span: 2, lane: 0, continuesBefore: true, continuesAfter: false });
    expect(by.conf).toMatchObject({ startCol: 1, span: 3, lane: 1 });
    expect(by.day).toMatchObject({ startCol: 4, span: 1, lane: 0 });
    expect(by.next).toMatchObject({ startCol: 6, span: 1, continuesAfter: true });
  });

  it('treats timed events ending at midnight as single-day', () => {
    const [b] = layoutSpans([{ item: 'late', start: new Date(2026, 9, 12, 22), end: new Date(2026, 9, 13, 0) }], row, 7);
    expect(b).toMatchObject({ startCol: 0, span: 1 });
  });
});
