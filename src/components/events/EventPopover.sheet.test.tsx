// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occurrence } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { EventPopover, sheetCloses, SHEET_CLOSE_PX } from './EventPopover';

vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => new Map([['work', { id: 'work', name: 'Work', color: '#0a7268', readOnly: false }]]),
  getParsedObject: () => ({}),
  currentOccurrence: () => undefined,
  selfEmailsFor: () => new Set<string>(),
}));
vi.mock('@/lib/ical/events', () => ({
  eventDataFor: () => ({ title: 'Standup', location: '', description: '', url: undefined, attendees: [], organizer: undefined, alarms: [], allDay: false, busy: true, timezone: 'floating', rrule: undefined }),
}));

const occurrence = { key: 'standup', objectUrl: 'standup', calendarId: 'work', title: 'Standup', start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false } as Occurrence;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.setPointerCapture = () => {};
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {} }),
  });
  useSettings.setState({ language: 'en' });
  useUi.setState({ popover: { occurrence, anchor: { x: 0, y: 0, width: 10, height: 10 } } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(h(EventPopover)));
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ popover: null });
});

/** Pulls the handle from `fromY` to `toY` over `ms` (the clock moves with it: speeds come from event times). */
function drag(fromY: number, toY: number, ms: number) {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  try {
    const handle = document.querySelector('[data-sheet-handle]')!;
    const fire = (type: string, y: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 100, clientY: y, pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true }));
    act(() => {
      fire('pointerdown', fromY);
      vi.advanceTimersByTime(ms / 2);
      fire('pointermove', (fromY + toY) / 2);
      vi.advanceTimersByTime(ms / 2);
      fire('pointermove', toY);
      fire('pointerup', toY);
    });
  } finally {
    vi.useRealTimers();
  }
}

describe('the event sheet on a phone', () => {
  it('is a dialog named after the event', () => {
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Standup');
  });

  it('closes when pulled down by its handle far enough or with a flick', () => {
    expect(sheetCloses(SHEET_CLOSE_PX + 1, 0)).toBe(true);
    expect(sheetCloses(40, 0.8)).toBe(true);
    expect(sheetCloses(40, 0.1)).toBe(false);
    drag(500, 640, 600);
    expect(useUi.getState().popover).toBeNull();
  });

  it('springs back from a short, slow pull', () => {
    drag(500, 540, 800);
    expect(useUi.getState().popover).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[role="dialog"]')!.style.transform).toBe('');
  });

  it('stays open for the click of the tap that opened it', () => {
    const backdrop = document.querySelector('[role="dialog"]')!.parentElement!;
    act(() => void backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useUi.getState().popover).not.toBeNull();
    act(() => {
      backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useUi.getState().popover).toBeNull();
  });
});
