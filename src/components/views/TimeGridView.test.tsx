// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calendar } from '@/store/data';
import type { Occurrence } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { LONG_PRESS_MS, TimeGridView } from './TimeGridView';

const data = vi.hoisted(() => ({ occurrences: [] as Occurrence[], calendars: new Map<string, Calendar>() }));
vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => data.calendars,
  useOccurrences: () => data.occurrences,
  useTasks: () => [],
}));
const actions = vi.hoisted(() => ({ moveOccurrence: vi.fn(() => Promise.resolve()), openEditTask: vi.fn(), toggleTask: vi.fn() }));
vi.mock('@/lib/actions', () => actions);

// Seven days of 100 px; the grid is 56 px an hour, so 28 px are 30 minutes.
const WIDTH = 700;
const HOUR = 56;
const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 12 + i));
const calendar = (id: string, readOnly = false): Calendar => ({ id, accountId: 'local', remoteId: id, name: id, color: '#0a7268', components: ['VEVENT'], readOnly, visible: true, order: 0 }) as Calendar;
const occurrence = (key: string, calendarId: string, start: Date, end: Date): Occurrence =>
  ({ key, objectUrl: key, calendarId, uid: key, title: key, location: '', description: '', start, end, allDay: false, busy: true, isRecurring: false, isException: false, alarms: [], floating: false }) as Occurrence;

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom lays nothing out: every element is the grid's size.
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: 24 * HOUR, right: WIDTH, bottom: 24 * HOUR, toJSON: () => ({}) });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {} }),
  });
  useSettings.setState({ language: 'en', density: 'comfortable', defaultEventDuration: 30, showTasksInCalendar: false, dimPastEvents: false });
  useUi.setState({ popover: null, quickCreate: null });
  data.calendars = new Map([
    ['work', calendar('work')],
    ['feed', calendar('feed', true)],
  ]);
  data.occurrences = [
    occurrence('standup', 'work', new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 10)),
    occurrence('holiday', 'feed', new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10)),
  ];
  actions.moveOccurrence.mockClear();
});

afterEach(() => {
  root?.unmount();
  root = null;
  vi.useRealTimers();
});

function grid() {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(TimeGridView, { days })));
  return host;
}

let ids = 1;
/** Dispatches a pointer event and lets React draw what it changed (moves are drawn later than presses otherwise). */
function pointer(type: string, target: Element, x: number, y: number, pointerType: 'touch' | 'mouse', pointerId: number) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType, pointerId, isPrimary: true, button: 0 });
  act(() => void target.dispatchEvent(event));
  return event;
}
function click(target: Element, x: number, y: number) {
  flushSync(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })));
}

const chip = (host: HTMLElement, key: string) => host.querySelector(`[data-occ="${key}"]`)!;
// Wednesday 14 Oct, 9:15: on the stand-up.
const ON_STANDUP = { x: 250, y: 9.25 * HOUR };

describe('a hidden event in the time grid', () => {
  it('shows "Hidden event" and neither its title nor its place, also to a screen reader', () => {
    data.occurrences = [{ ...occurrence('party', 'work', new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 11)), title: 'Surprise party for Ola', location: 'Ola flat', hidden: true }];
    const host = grid();
    expect(host.textContent).toContain('Hidden event');
    expect(host.innerHTML).not.toContain('Surprise');
    expect(host.innerHTML).not.toContain('Ola');
  });
});

describe('a tap in the time grid', () => {
  it('opens the event only with the click that follows it, so the sheet is not closed by that click', () => {
    const host = grid();
    const id = ids++;
    pointer('pointerdown', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
    pointer('pointerup', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
    expect(useUi.getState().popover).toBeNull();
    click(chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y);
    expect(useUi.getState().popover?.occurrence.key).toBe('standup');
  });

  it('on an empty slot starts a new event there, at the half hour', () => {
    const host = grid();
    const columns = host.querySelector('.time-grid-bg')!;
    const id = ids++;
    pointer('pointerdown', columns, 450, 14.6 * HOUR, 'touch', id);
    pointer('pointerup', columns, 451, 14.6 * HOUR, 'touch', id);
    expect(useUi.getState().quickCreate).toBeNull();
    click(columns, 451, 14.6 * HOUR);
    const qc = useUi.getState().quickCreate!;
    expect([qc.start, qc.end, qc.allDay]).toEqual([new Date(2026, 9, 16, 14, 30), new Date(2026, 9, 16, 15), false]);
  });

  it('opens nothing after a mouse moved the event', () => {
    const host = grid();
    const id = ids++;
    pointer('pointerdown', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'mouse', id);
    pointer('pointermove', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 10, 'mouse', id);
    pointer('pointermove', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + HOUR, 'mouse', id);
    pointer('pointerup', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + HOUR, 'mouse', id);
    click(chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + HOUR);
    expect(useUi.getState().popover).toBeNull();
    expect(actions.moveOccurrence).toHaveBeenCalledWith(data.occurrences[0], new Date(2026, 9, 14, 10), new Date(2026, 9, 14, 11), false);
  });
});

describe('a long press in the time grid', () => {
  it('picks the event up, and the finger moves it in steps of 15 minutes', () => {
    vi.useFakeTimers();
    const host = grid();
    const id = ids++;
    const down = pointer('pointerdown', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
    expect(down.defaultPrevented).toBe(false);
    // Held: no menu of the system's.
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    chip(host, 'standup').dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    act(() => void vi.advanceTimersByTime(50));
    pointer('pointermove', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 28, 'touch', id);
    pointer('pointerup', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 28, 'touch', id);
    expect(actions.moveOccurrence).toHaveBeenCalledWith(data.occurrences[0], new Date(2026, 9, 14, 9, 30), new Date(2026, 9, 14, 10, 30), false);
    // A long press opens nothing.
    expect(useUi.getState().popover).toBeNull();
  });

  it('stops the grid scrolling while the event is held', () => {
    vi.useFakeTimers();
    const host = grid();
    const id = ids++;
    pointer('pointerdown', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
    const before = new Event('touchmove', { bubbles: true, cancelable: true });
    chip(host, 'standup').dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    const during = new Event('touchmove', { bubbles: true, cancelable: true });
    chip(host, 'standup').dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    pointer('pointerup', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
  });

  it('is no long press when the finger moved first: that is a scroll or a swipe', () => {
    vi.useFakeTimers();
    const host = grid();
    const id = ids++;
    pointer('pointerdown', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y, 'touch', id);
    pointer('pointermove', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 12, 'touch', id);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    pointer('pointermove', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 56, 'touch', id);
    pointer('pointerup', chip(host, 'standup'), ON_STANDUP.x, ON_STANDUP.y + 56, 'touch', id);
    expect(actions.moveOccurrence).not.toHaveBeenCalled();
  });

  it('cannot move an event of a calendar that is read-only', () => {
    vi.useFakeTimers();
    const host = grid();
    const id = ids++;
    pointer('pointerdown', chip(host, 'holiday'), 350, 9.25 * HOUR, 'touch', id);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    pointer('pointermove', chip(host, 'holiday'), 350, 10.25 * HOUR, 'touch', id);
    pointer('pointerup', chip(host, 'holiday'), 350, 10.25 * HOUR, 'touch', id);
    expect(actions.moveOccurrence).not.toHaveBeenCalled();
  });
});

describe('the all-day strip', () => {
  const strip = (host: HTMLElement) => host.querySelector('[data-all-day]')!;

  it('takes a finger swiping across the days as no new event', () => {
    const host = grid();
    const id = ids++;
    pointer('pointerdown', strip(host), 650, 10, 'touch', id);
    pointer('pointermove', strip(host), 400, 12, 'touch', id);
    pointer('pointermove', strip(host), 80, 12, 'touch', id);
    pointer('pointerup', strip(host), 80, 12, 'touch', id);
    // Were a click to come after all, it is far from where the finger came down.
    click(strip(host), 80, 12);
    expect(useUi.getState().quickCreate).toBeNull();
  });

  it('starts a one-day all-day event on a tap', () => {
    const host = grid();
    const id = ids++;
    pointer('pointerdown', strip(host), 250, 10, 'touch', id);
    pointer('pointerup', strip(host), 251, 10, 'touch', id);
    click(strip(host), 251, 10);
    const qc = useUi.getState().quickCreate!;
    expect([qc.start, qc.end, qc.allDay]).toEqual([new Date(2026, 9, 14), new Date(2026, 9, 15), true]);
  });

  it('lets a mouse drag across three days for a three-day event', () => {
    const host = grid();
    const id = ids++;
    pointer('pointerdown', strip(host), 150, 10, 'mouse', id);
    pointer('pointermove', strip(host), 250, 10, 'mouse', id);
    pointer('pointermove', strip(host), 350, 10, 'mouse', id);
    pointer('pointerup', strip(host), 350, 10, 'mouse', id);
    const qc = useUi.getState().quickCreate!;
    expect([qc.start, qc.end, qc.allDay]).toEqual([new Date(2026, 9, 13), new Date(2026, 9, 16), true]);
  });
});

describe('the days beside these during a swipe', () => {
  const shifted = (n: number) => days.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

  it('are drawn in the headers, the all-day strip and the hours, only while a finger swipes', () => {
    expect(grid().querySelector('[data-pager-peer]')).toBeNull();
    root!.unmount();
    data.occurrences.push(occurrence('review', 'work', new Date(2026, 9, 21, 11), new Date(2026, 9, 21, 12)));
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    act(() => root!.render(h(TimeGridView, { days, peers: { before: shifted(-7), after: shifted(7) } })));
    const after = host.querySelectorAll<HTMLElement>('[data-pager-peer="1"]');
    expect(after).toHaveLength(3);
    expect(host.querySelectorAll('[data-pager-peer="-1"]')).toHaveLength(3);
    for (const peer of after) {
      expect(peer.parentElement!.hasAttribute('data-pager')).toBe(true);
      expect(peer.hasAttribute('inert')).toBe(true);
      expect(peer.className).toContain('left-full');
    }
    const [heads, , hours] = after;
    expect([...heads.children].map((d) => d.lastElementChild!.textContent)).toEqual(['19', '20', '21', '22', '23', '24', '25']);
    expect(hours.textContent).toContain('review');
    // Nothing in them is an event to touch.
    expect(hours.querySelector('[data-occ]')).toBeNull();
  });
});
