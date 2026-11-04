// @vitest-environment jsdom
// A new event's notifications in the editor and in Quick Create: its
// calendar's defaults (lib/calendarAlarms.ts), following the calendar and the
// kind of event while they are untouched, and never changed once they were.
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { newEventDraft } from '@/lib/actions';
import { LOCAL_ACCOUNT_ID, useData, type Calendar } from '@/store/data';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import type { EventData, Occurrence } from '@/lib/ical/types';
import { EventEditor } from './EventEditor';
import { QuickCreate } from './QuickCreate';

const PERSONAL = 'local|personal';
const WORK = 'local|work';
const TRIPS = 'local|trips';

function calendar(id: string, name: string): Calendar {
  return { id, accountId: LOCAL_ACCOUNT_ID, remoteId: id.split('|')[1], name, color: '#2d772a', components: ['VEVENT'], readOnly: false, visible: true, order: 0 };
}

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  useSettings.setState({
    ...DEFAULT_SETTINGS,
    language: 'en',
    defaultCalendarId: PERSONAL,
    defaultAlarms: [15],
    defaultAllDayAlarms: [],
    // Work has its own for both kinds; Trips only for all-day events.
    calendarAlarms: { [WORK]: { timed: [60], allDay: [-540] }, [TRIPS]: { allDay: [1440] } },
  });
  useData.setState({
    accounts: [{ id: LOCAL_ACCOUNT_ID, kind: 'local', name: 'On this device', useProxy: false }],
    calendars: [calendar(PERSONAL, 'Personal'), calendar(WORK, 'Work'), calendar(TRIPS, 'Trips')],
  });
  useUi.setState({ eventEditor: null, quickCreate: null, toasts: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useUi.setState({ eventEditor: null, quickCreate: null });
  document.body.innerHTML = '';
});

function draw(element: Parameters<Root['render']>[0]) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(element));
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const calendarSelect = () => document.querySelector<HTMLSelectElement>(`select[aria-label="${en['editor.calendar']}"]`)!;
/** The notifications the editor shows. */
const shown = () => [...document.querySelectorAll<HTMLSelectElement>(`select[aria-label="${en['editor.notifications']}"]`)].map((s) => Number(s.value));
const allDayBox = () => [...document.querySelectorAll('label')].find((l) => l.textContent === en['editor.allDay'])!.querySelector('input')!;

describe('a new event in the editor', () => {
  it("starts with its calendar's notifications and follows the calendar chosen while they are untouched", () => {
    useUi.setState({ eventEditor: newEventDraft(new Date(2026, 9, 14, 9))! });
    draw(h(EventEditor));
    expect(shown()).toEqual([15]);
    choose(calendarSelect(), WORK);
    expect(shown()).toEqual([60]);
    // Trips has none of its own for timed events: the general one.
    choose(calendarSelect(), TRIPS);
    expect(shown()).toEqual([15]);
  });

  it('follows the kind of event too: all-day ones get the all-day defaults', () => {
    useSettings.setState({ defaultCalendarId: WORK });
    useUi.setState({ eventEditor: newEventDraft(new Date(2026, 9, 14, 9))! });
    draw(h(EventEditor));
    expect(shown()).toEqual([60]);
    act(() => allDayBox().click());
    expect(shown()).toEqual([-540]);
    choose(calendarSelect(), TRIPS);
    expect(shown()).toEqual([1440]);
    act(() => allDayBox().click());
    expect(shown()).toEqual([15]);
  });

  it('keeps notifications that were changed, whatever calendar is chosen after', () => {
    useUi.setState({ eventEditor: newEventDraft(new Date(2026, 9, 14, 9))! });
    draw(h(EventEditor));
    choose(document.querySelector<HTMLSelectElement>(`select[aria-label="${en['editor.notifications']}"]`)!, '30');
    expect(shown()).toEqual([30]);
    choose(calendarSelect(), WORK);
    expect(shown()).toEqual([30]);
    act(() => allDayBox().click());
    expect(shown()).toEqual([30]);
  });

  it('keeps notifications removed altogether as none', () => {
    useUi.setState({ eventEditor: newEventDraft(new Date(2026, 9, 14, 9))! });
    draw(h(EventEditor));
    act(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${en['alarm.remove']}"]`)!.click());
    expect(shown()).toEqual([]);
    choose(calendarSelect(), WORK);
    expect(shown()).toEqual([]);
  });

  it('that comes with notifications other than the defaults keeps them', () => {
    const draft = newEventDraft(new Date(2026, 9, 14, 9))!;
    useUi.setState({ eventEditor: { ...draft, data: { ...draft.data, alarms: [5] } } });
    draw(h(EventEditor));
    choose(calendarSelect(), WORK);
    expect(shown()).toEqual([5]);
  });
});

describe('an existing event in the editor', () => {
  it('keeps its notifications when moved to another calendar or made all-day', () => {
    const data: EventData = { ...newEventDraft(new Date(2026, 9, 14, 9))!.data, alarms: [15] };
    const occurrence = { key: 'occ1', calendarId: PERSONAL, objectUrl: 'local://x' } as unknown as Occurrence;
    useUi.setState({ eventEditor: { mode: 'edit', calendarId: PERSONAL, occurrence, data } });
    draw(h(EventEditor));
    choose(calendarSelect(), WORK);
    expect(shown()).toEqual([15]);
    act(() => allDayBox().click());
    expect(shown()).toEqual([15]);
  });
});

describe('Quick Create', () => {
  function quickCreate(allDay = false) {
    const start = allDay ? new Date(2026, 9, 14) : new Date(2026, 9, 14, 9);
    const end = allDay ? new Date(2026, 9, 15) : new Date(2026, 9, 14, 10);
    useUi.setState({ quickCreate: { id: 1, start, end, allDay, title: '' } });
    draw(h(QuickCreate));
  }
  /** What "More options" hands to the editor. */
  function handedOver(): number[] {
    const more = [...document.querySelectorAll('button')].find((b) => b.textContent === en['editor.moreOptions'])!;
    act(() => more.click());
    return useUi.getState().eventEditor!.data.alarms;
  }

  it("gives the event its calendar's notifications, following the calendar chosen", () => {
    quickCreate();
    choose(calendarSelect(), WORK);
    expect(handedOver()).toEqual([60]);
    expect(useUi.getState().eventEditor!.calendarId).toBe(WORK);
  });

  it('takes the general ones for a calendar without its own', () => {
    quickCreate();
    choose(calendarSelect(), WORK);
    choose(calendarSelect(), PERSONAL);
    expect(handedOver()).toEqual([15]);
  });

  it("takes the calendar's all-day ones for an all-day event, also when switched to all-day", () => {
    quickCreate(true);
    choose(calendarSelect(), TRIPS);
    expect(handedOver()).toEqual([1440]);
    act(() => root!.unmount());
    useUi.setState({ eventEditor: null });
    quickCreate();
    choose(calendarSelect(), WORK);
    act(() => allDayBox().click());
    expect(handedOver()).toEqual([-540]);
  });

  it('hands the editor notifications that still follow the calendar', () => {
    quickCreate();
    choose(calendarSelect(), WORK);
    handedOver();
    act(() => root!.unmount());
    draw(h(EventEditor));
    expect(shown()).toEqual([60]);
    choose(calendarSelect(), PERSONAL);
    expect(shown()).toEqual([15]);
  });
});
