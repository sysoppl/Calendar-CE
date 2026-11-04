// Layout algorithms for the time grid and month rows.
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

export interface TimedInput<T> {
  item: T;
  /** Minutes from the start of the column's day (may be negative / > 1440). */
  start: number;
  end: number;
}

export interface TimedBox<T> {
  item: T;
  top: number;
  bottom: number;
  /** Column index within the overlap cluster. */
  col: number;
  /** Number of columns in the cluster. */
  cols: number;
  /** How many columns this box may extend over (free space to its right). */
  span: number;
}

const MIN_DURATION = 20;

/**
 * Classic overlap layout: events that overlap form a cluster; each event is
 * placed in the first free column; boxes expand right into free columns.
 */
export function layoutTimed<T>(inputs: TimedInput<T>[]): TimedBox<T>[] {
  const items = inputs
    .map((i) => ({ ...i, start: Math.max(0, i.start), end: Math.min(1440, Math.max(i.end, i.start + MIN_DURATION)) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: TimedBox<T>[] = [];
  let cluster: (TimedBox<T> & { end: number })[] = [];
  let columnsEnd: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = columnsEnd.length;
    for (const box of cluster) {
      let span = 1;
      // Extend into following columns while they are free for our range.
      for (let c = box.col + 1; c < cols; c++) {
        const blocked = cluster.some((o) => o.col === c && o.top < box.bottom && o.bottom > box.top);
        if (blocked) break;
        span++;
      }
      out.push({ item: box.item, top: box.top, bottom: box.bottom, col: box.col, cols, span });
    }
    cluster = [];
    columnsEnd = [];
  };

  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) flush();
    let col = columnsEnd.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(it.end);
    } else columnsEnd[col] = it.end;
    cluster.push({ item: it.item, top: it.start, bottom: it.end, col, cols: 0, span: 1, end: it.end });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

export interface SpanInput<T> {
  item: T;
  start: Date;
  /** Exclusive end. */
  end: Date;
}

export interface SpanBox<T> {
  item: T;
  /** Column (day index) where the bar starts within the row. */
  startCol: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Places items that cover whole days into lanes for a row of `days` days
 * starting at `rowStart` (month rows, the week view all-day strip).
 */
export function layoutSpans<T>(inputs: SpanInput<T>[], rowStart: Date, days: number): SpanBox<T>[] {
  const rowStartDay = startOfDay(rowStart);
  const rowEnd = addDays(rowStartDay, days);
  const items = inputs
    .filter((i) => i.start < rowEnd && (i.end > rowStartDay || (i.end.getTime() === i.start.getTime() && i.start >= rowStartDay)))
    .map((i) => {
      const s = i.start < rowStartDay ? rowStartDay : startOfDay(i.start);
      // Exclusive end: an event ending at 00:00 does not occupy that day.
      const endDay = i.end > i.start ? startOfDay(new Date(i.end.getTime() - 1)) : startOfDay(i.start);
      const e = endDay >= rowEnd ? addDays(rowEnd, -1) : endDay;
      const startCol = differenceInCalendarDays(s, rowStartDay);
      const span = Math.max(1, differenceInCalendarDays(e, s) + 1);
      return { i, startCol, span, before: i.start < rowStartDay, after: endDay >= rowEnd };
    })
    .sort((a, b) => a.startCol - b.startCol || b.span - a.span);

  const lanes: number[][] = []; // lanes[lane] = occupied column flags
  return items.map(({ i, startCol, span, before, after }) => {
    let lane = 0;
    for (; ; lane++) {
      lanes[lane] ??= [];
      let free = true;
      for (let c = startCol; c < startCol + span; c++) if (lanes[lane][c]) free = false;
      if (free) break;
    }
    for (let c = startCol; c < startCol + span; c++) lanes[lane][c] = 1;
    return { item: i.item, startCol, span, lane, continuesBefore: before, continuesAfter: after };
  });
}
