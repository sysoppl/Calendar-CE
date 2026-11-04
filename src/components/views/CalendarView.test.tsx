// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { handleBackButton } from '@/components/onboarding/back';
import { CalendarView } from './CalendarView';

vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => new Map(),
  useOccurrences: () => [],
  useTasks: () => [],
}));
vi.mock('@/lib/actions', () => ({ moveOccurrence: vi.fn(), openEditTask: vi.fn(), toggleTask: vi.fn() }));

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {} }),
  });
  useSettings.setState({ language: 'en', weekStartsOn: 1, showWeekends: true });
  useUi.setState({ view: 'month', date: new Date(2026, 9, 16), popover: null, quickCreate: null });
  useUi.getState().clearNavHistory();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(CalendarView)));
});

afterEach(() => {
  root?.unmount();
  root = null;
  vi.useRealTimers();
});

const place = () => [useUi.getState().view, useUi.getState().date];

describe('the Android back button in the calendar', () => {
  it('returns from a day opened in the month to that month, and only then lets the app go', () => {
    flushSync(() => host.querySelector<HTMLElement>(`[data-day="${new Date(2026, 9, 22).getTime()}"]`)!.click());
    expect(place()).toEqual(['day', new Date(2026, 9, 22)]);
    expect(handleBackButton()).toBe(true);
    expect(place()).toEqual(['month', new Date(2026, 9, 16)]);
    // At the start of the history nothing is left: the app goes to the background.
    expect(handleBackButton()).toBe(false);
  });

  it('forgets the way back once the calendar closes', () => {
    flushSync(() => useUi.getState().goTo(new Date(2026, 9, 22), 'day'));
    root!.unmount();
    root = null;
    expect(useUi.getState().navHistory).toEqual([]);
    expect(handleBackButton()).toBe(false);
  });
});

describe('swiping the calendar', () => {
  it('pages to the next month with a finger swiped to the left', () => {
    vi.useFakeTimers();
    const pager = host.firstElementChild as HTMLElement;
    Object.defineProperty(pager, 'clientWidth', { configurable: true, value: 360 });
    const target = host.querySelector(`[data-day="${new Date(2026, 9, 14).getTime()}"]`)!;
    const fire = (type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerId: 41, pointerType: 'touch', isPrimary: true }));
    fire('pointerdown', 300);
    for (const x of [285, 240, 180, 120]) {
      vi.advanceTimersByTime(16);
      fire('pointermove', x);
    }
    fire('pointerup', 120);
    flushSync(() => vi.advanceTimersByTime(50));
    expect(place()).toEqual(['month', new Date(2026, 10, 16)]);
    expect(useUi.getState().navDir).toBe(1);
  });

  it('draws the months beside the current one while the finger swipes, and lets them go after', () => {
    vi.useFakeTimers();
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const pager = host.firstElementChild as HTMLElement;
      Object.defineProperty(pager, 'clientWidth', { configurable: true, value: 360 });
      const target = host.querySelector(`[data-day="${new Date(2026, 9, 14).getTime()}"]`)!;
      const fire = (type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerId: 42, pointerType: 'touch', isPrimary: true }));
      act(() => {
        fire('pointerdown', 300);
        for (const x of [285, 240]) {
          vi.advanceTimersByTime(16);
          fire('pointermove', x);
        }
      });
      expect(host.querySelector('[data-pager-peer="-1"]')).not.toBeNull();
      expect(host.querySelector('[data-pager-peer="1"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(16);
        fire('pointermove', 120);
        fire('pointerup', 120);
        vi.advanceTimersByTime(50);
      });
      expect(place()).toEqual(['month', new Date(2026, 10, 16)]);
      expect(host.querySelector('[data-pager-peer]')).toBeNull();
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it('lets every part of the calendar leave sideways moves to it', () => {
    expect((host.firstElementChild as HTMLElement).className).toContain('[&_*]:[touch-action:pan-y_pinch-zoom]');
  });
});
