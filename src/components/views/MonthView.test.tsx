// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calendar } from '@/store/data';
import type { Occurrence } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { lanesThatFit, monthMetrics, MonthView } from './MonthView';

const data = vi.hoisted(() => ({ occurrences: [] as Occurrence[] }));
vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => new Map([['work', { id: 'work', color: '#0a7268', readOnly: false } as Calendar]]),
  useOccurrences: () => data.occurrences,
  useTasks: () => [],
}));
vi.mock('@/lib/actions', () => ({ moveOccurrence: vi.fn(), openEditTask: vi.fn(), toggleTask: vi.fn() }));

/** One row of a 6-week month on a typical phone (360x780, bar of views below); here every month gets rows this tall. */
const ROW = 107;
/** October 2026 spans five weeks, from Monday 28 September to Sunday 1 November. */
const WEEKS = 5;
let width = 360;
let root: Root | null = null;

beforeAll(() => {
  // A row's height comes from the grid's.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => WEEKS * ROW });
  globalThis.ResizeObserver = class {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe() {
      this.cb([], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  width = 360;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
  useSettings.setState({ language: 'en', weekStartsOn: 1, showWeekNumbers: false, textSize: 'system', showTasksInCalendar: false, dimPastEvents: false, eventStyle: 'filled' });
  useUi.setState({ view: 'month', date: new Date(2026, 9, 16), popover: null, quickCreate: null });
  data.occurrences = Array.from({ length: 6 }, (_, i) => ({
    key: `e${i}`,
    objectUrl: `e${i}`,
    calendarId: 'work',
    uid: `e${i}`,
    title: `Przegląd auta ${i}`,
    location: '',
    description: '',
    start: new Date(2026, 9, 14, 8 + i),
    end: new Date(2026, 9, 14, 9 + i),
    allDay: false,
    busy: true,
    isRecurring: false,
    isException: false,
    alarms: [],
    floating: false,
  }));
});

afterEach(() => {
  root?.unmount();
  root = null;
});

function month(peek = false) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(MonthView, { peek })));
  return host;
}

const cellOf = (host: HTMLElement, d: Date) => host.querySelector<HTMLElement>(`[data-day="${d.getTime()}"]`)!;

describe('a hidden event in the month', () => {
  it('shows "Hidden event", and its title nowhere', () => {
    width = 1280;
    data.occurrences = [{ ...data.occurrences[0], title: 'Surprise party for Ola', location: "Ola's flat", hidden: true }];
    const host = month();
    expect(host.textContent).toContain('Hidden event');
    expect(host.innerHTML).not.toContain('Surprise');
    expect(host.innerHTML).not.toContain('Ola');
  });
});

describe('the month on a phone', () => {
  it('fits four lanes of chips in a row of a 6-week month, the last giving way to "+N"', () => {
    expect(monthMetrics(true, 1)).toEqual({ lane: 19, header: 24 });
    expect(lanesThatFit(ROW, 19, 24)).toBe(4);
    const host = month();
    const day = host.querySelector(`[data-day="${new Date(2026, 9, 14).getTime()}"]`)!.parentElement!;
    expect(day.querySelectorAll('[data-item]')).toHaveLength(3);
    const more = day.querySelector('[data-more]')!;
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('aria-label')).toBe('+3 more');
  });

  it("draws the phone's chips: 11 px text cut with a fade, 17 px tall on a 19 px lane", () => {
    const host = month();
    const chip = host.querySelector('[data-item] > div')!;
    expect(chip.className).toContain('text-[0.6875rem]');
    expect(chip.querySelector('span')!.className).not.toContain('truncate');
    const lane = host.querySelector<HTMLElement>('[data-item]')!.parentElement!;
    expect([lane.style.height, lane.classList.contains('px-px')]).toEqual(['17px', true]);
  });

  it('grows the lanes with the text size', () => {
    expect(monthMetrics(true, 1.3)).toEqual({ lane: 25, header: 31 });
    expect(monthMetrics(false, 1.3)).toEqual({ lane: 29, header: 36 });
  });

  it('keeps the week numbers to a narrow column', () => {
    useSettings.setState({ showWeekNumbers: true });
    const host = month();
    expect(host.querySelector('.grid-cols-\\[22px_repeat\\(7\\,minmax\\(0\\,1fr\\)\\)\\]')).not.toBeNull();
  });

  it('opens the day on a tap, to which Back returns from it', () => {
    useUi.getState().clearNavHistory();
    const host = month();
    flushSync(() => host.querySelector<HTMLElement>(`[data-day="${new Date(2026, 9, 22).getTime()}"]`)!.click());
    expect([useUi.getState().view, useUi.getState().date]).toEqual(['day', new Date(2026, 9, 22)]);
    expect(useUi.getState().navBack()).toBe(true);
    expect([useUi.getState().view, useUi.getState().date]).toEqual(['month', new Date(2026, 9, 16)]);
  });
});

describe('the month on a computer', () => {
  it('keeps its chips and lanes', () => {
    width = 1280;
    expect(monthMetrics(false, 1)).toEqual({ lane: 22, header: 28 });
    const host = month();
    const day = host.querySelector(`[data-day="${new Date(2026, 9, 14).getTime()}"]`)!.parentElement!;
    // Three lanes fit (107 - 28 - 4) / 22: two events and "+4 more".
    expect(day.querySelectorAll('[data-item]')).toHaveLength(2);
    expect(day.querySelector('[data-more]')!.textContent).toBe('+4 more');
  });
});

describe('the day number', () => {
  it('opens the day from anywhere in the strip of its number, its circle drawn as before', () => {
    width = 1280;
    useUi.getState().clearNavHistory();
    const host = month();
    const cell = cellOf(host, new Date(2026, 9, 21));
    const strip = cell.querySelectorAll<HTMLElement>('button[data-daynum]');
    // One button, as wide as the day, named by the number.
    expect(strip).toHaveLength(1);
    expect(strip[0].className).toContain('w-full');
    expect(strip[0].className).not.toContain('rounded-full');
    expect(strip[0].textContent).toBe('21');
    const circle = strip[0].firstElementChild!;
    expect(circle.className).toContain('rounded-full');
    expect(circle.className).toContain('h-6 min-w-6');
    expect(circle.className).toContain('group-hover:bg-bg-strong');
    flushSync(() => strip[0].click());
    expect([useUi.getState().view, useUi.getState().date]).toEqual(['day', new Date(2026, 9, 21)]);
  });

  it('leaves the rest of the day to creating an event and the chips to their event', () => {
    width = 1280;
    const host = month();
    const cell = cellOf(host, new Date(2026, 9, 21));
    flushSync(() => cell.click());
    expect(useUi.getState().view).toBe('month');
    expect(useUi.getState().quickCreate?.start).toEqual(new Date(2026, 9, 21));
    flushSync(() => cellOf(host, new Date(2026, 9, 14)).parentElement!.querySelector<HTMLElement>('[data-item]')!.click());
    expect(useUi.getState().view).toBe('month');
    expect(useUi.getState().popover?.occurrence.key).toBe('e0');
  });
});

describe('dragging an event to another day', () => {
  const pointer = (type: string, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    return e;
  };

  it('opens no popover with the click that ends it', async () => {
    width = 1280;
    document.elementsFromPoint = () => [];
    const host = month();
    const chip = cellOf(host, new Date(2026, 9, 14)).parentElement!.querySelector<HTMLElement>('[data-item]')!;
    flushSync(() => chip.dispatchEvent(pointer('pointerdown', 10, 10)));
    flushSync(() => window.dispatchEvent(pointer('pointermove', 40, 10)));
    flushSync(() => window.dispatchEvent(pointer('pointerup', 40, 10)));
    // The browser's click follows the pointer's release, after the drag is over in the state.
    flushSync(() => chip.click());
    expect(useUi.getState().popover).toBeNull();
    // A click of its own, later, opens it.
    await new Promise((resolve) => setTimeout(resolve));
    flushSync(() => chip.click());
    expect(useUi.getState().popover?.occurrence.key).toBe('e0');
  });
});

describe('the months beside it during a swipe', () => {
  it('are drawn only while a finger swipes', () => {
    expect(month().querySelector('[data-pager-peer]')).toBeNull();
  });

  it('show the previous month to the left and the next one to the right, with their own weeks and events', () => {
    data.occurrences.push({ ...data.occurrences[0], key: 'nov', objectUrl: 'nov', uid: 'nov', title: 'Przegląd roczny', start: new Date(2026, 10, 18, 10), end: new Date(2026, 10, 18, 11) });
    const host = month(true);
    const pager = host.querySelector('[data-pager]')!;
    const before = pager.querySelector<HTMLElement>(':scope > [data-pager-peer="-1"]')!;
    const after = pager.querySelector<HTMLElement>(':scope > [data-pager-peer="1"]')!;
    expect(before.className).toContain('right-full');
    expect(after.className).toContain('left-full');
    // September 2026 has five weeks from Monday 31 August, November six from Monday 26 October.
    expect(before.children).toHaveLength(5);
    expect(after.children).toHaveLength(6);
    expect(after.textContent).toContain('Przegląd roczny');
    expect(pager.firstElementChild!.textContent).not.toContain('Przegląd roczny');
  });

  it('cannot be touched, focused or found as days', () => {
    const host = month(true);
    for (const peer of host.querySelectorAll('[data-pager-peer]')) {
      expect(peer.hasAttribute('inert')).toBe(true);
      expect(peer.getAttribute('aria-hidden')).toBe('true');
      expect(peer.querySelector('[data-day]')).toBeNull();
    }
    expect(host.querySelectorAll('[data-day]')).toHaveLength(35);
  });
});
