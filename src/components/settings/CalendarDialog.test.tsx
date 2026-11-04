// @vitest-environment jsdom
// "Default notifications" in the calendar's dialog (CalendarAlarmsFields.tsx).
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { pl } from '@/i18n/pl';
import { LOCAL_ACCOUNT_ID, useData, type Account, type Calendar } from '@/store/data';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { CalendarDialog } from './CalendarDialog';

const accounts: Account[] = [
  { id: LOCAL_ACCOUNT_ID, kind: 'local', name: 'On this device', useProxy: false },
  { id: 'dav1', kind: 'caldav', name: 'Work', serverUrl: 'https://dav.example.org/', username: 'ada', useProxy: true },
];

function calendar(id: string, accountId: string, patch: Partial<Calendar> = {}): Calendar {
  return { id, accountId, remoteId: id.split('|')[1], name: id, color: '#2d772a', components: ['VEVENT'], readOnly: false, visible: true, order: 0, ...patch };
}

const PERSONAL = 'local|personal';
const TASKS = 'local|tasks';
const DAV_CAL = 'dav1|https://dav.example.org/cal/ada/work/';
const SHARED = 'dav1|https://dav.example.org/cal/bob/shared/';

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  useSettings.setState({ ...DEFAULT_SETTINGS, language: 'en', defaultAlarms: [15], defaultAllDayAlarms: [], calendarAlarms: undefined });
  useData.setState({
    accounts,
    calendars: [
      calendar(PERSONAL, LOCAL_ACCOUNT_ID),
      calendar(TASKS, LOCAL_ACCOUNT_ID, { components: ['VTODO'] }),
      calendar(DAV_CAL, 'dav1'),
      calendar(SHARED, 'dav1', { readOnly: true }),
    ],
  });
  useUi.setState({ toasts: [], calendarDialog: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useUi.setState({ calendarDialog: null });
  document.body.innerHTML = '';
});

function open(calendarId: string | undefined, kind: 'events' | 'tasks' = 'events') {
  useUi.setState({ calendarDialog: { calendarId, kind } });
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(CalendarDialog)));
}

const block = () => document.querySelector<HTMLFieldSetElement>('fieldset[data-calendar-alarms]');
const kind = (k: 'timed' | 'allDay') => block()!.querySelector<HTMLFieldSetElement>(`fieldset[data-kind="${k}"]`)!;
const radio = (k: 'timed' | 'allDay', value: 'general' | 'custom') => kind(k).querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
const labelOf = (input: HTMLInputElement) => input.closest('label')!.textContent;
const save = () => [...document.querySelectorAll('button')].find((b) => b.textContent === en['settings.save'])!;

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('default notifications in the calendar dialog', () => {
  it('start as the general settings, which they name, for events with a time and for all-day events', () => {
    open(PERSONAL);
    expect(block()!.querySelector('legend')!.textContent).toBe('Default notifications');
    expect(kind('timed').querySelector('legend')!.textContent).toBe('Events with a time');
    expect(kind('allDay').querySelector('legend')!.textContent).toBe('All-day events');
    expect(radio('timed', 'general').checked).toBe(true);
    expect(labelOf(radio('timed', 'general'))).toBe('Same as general settings (15 minutes before)');
    expect(labelOf(radio('allDay', 'general'))).toBe('Same as general settings (no notification)');
    expect(block()!.disabled).toBe(false);
    // No list to edit until one is asked for.
    expect(block()!.querySelectorAll('select')).toHaveLength(0);
  });

  it('become a list of their own, edited like the event editor, saved with the dialog with the settings toast', async () => {
    open(PERSONAL);
    act(() => radio('timed', 'custom').click());
    // A list of its own starts from what applied.
    const select = kind('timed').querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('15');
    expect(select.getAttribute('aria-label')).toBe('Events with a time: Notifications');
    choose(select, '60');
    const add = [...kind('timed').querySelectorAll('button')].find((b) => b.textContent === en['editor.addNotification'])!;
    act(() => add.click());
    expect([...kind('timed').querySelectorAll('select')].map((s) => s.value)).toEqual(['0', '60']);
    // All-day: none of its own, not the general one.
    act(() => radio('allDay', 'custom').click());
    const remove = kind('allDay').querySelectorAll<HTMLButtonElement>(`button[aria-label="${en['alarm.remove']}"]`);
    expect(remove).toHaveLength(0);
    expect(kind('allDay').textContent).toContain(en['calendarAlarms.customNone']);
    // Nothing is kept before Save.
    expect(useSettings.getState().calendarAlarms).toBeUndefined();
    await act(async () => save().click());
    await act(async () => {});
    expect(useSettings.getState().calendarAlarms).toEqual({ [PERSONAL]: { timed: [0, 60], allDay: [] } });
    expect(useUi.getState().calendarDialog).toBeNull();
    // The settings' own toast says what became of it (here: kept on this device), not "Calendar saved".
    await new Promise((resolve) => setTimeout(resolve, 700));
    const toasts = useUi.getState().toasts.map((t) => t.message);
    expect(toasts).toContain(en['save.saved']);
    expect(toasts).not.toContain(en['toast.calendarSaved']);
  });

  it('show what the calendar has, and go back to the general settings', async () => {
    useSettings.setState({ calendarAlarms: { [PERSONAL]: { timed: [30], allDay: [-540] }, [DAV_CAL]: { timed: [5] } } });
    open(PERSONAL);
    expect(radio('timed', 'custom').checked).toBe(true);
    expect(kind('timed').querySelector('select')!.value).toBe('30');
    expect(kind('allDay').querySelector('select')!.value).toBe('-540');
    act(() => radio('timed', 'general').click());
    act(() => radio('allDay', 'general').click());
    await act(async () => save().click());
    expect(useSettings.getState().calendarAlarms).toEqual({ [DAV_CAL]: { timed: [5] } });
  });

  it('can be worked with the keyboard: named controls in the tab order, and Enter saves', async () => {
    open(PERSONAL);
    const radios = block()!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(4);
    for (const r of radios) {
      expect(r.tabIndex).not.toBe(-1);
      expect(r.closest('label')).not.toBeNull();
    }
    // Arrows and Space work a native radio group; Space is a click.
    radio('allDay', 'custom').focus();
    act(() => radio('allDay', 'custom').click());
    expect(document.activeElement).toBe(radio('allDay', 'custom'));
    const add = [...kind('allDay').querySelectorAll('button')].find((b) => b.textContent === en['editor.addNotification'])!;
    act(() => add.click());
    // Enter in a field submits the form.
    await act(async () => document.querySelector('form')!.requestSubmit());
    expect(useSettings.getState().calendarAlarms).toEqual({ [PERSONAL]: { allDay: [-720] } });
  });

  it('say nothing when only the name changed: "Calendar saved" as before', async () => {
    open(PERSONAL);
    await act(async () => save().click());
    expect(useSettings.getState().calendarAlarms).toBeUndefined();
    expect(useUi.getState().toasts.map((t) => t.message)).toContain(en['toast.calendarSaved']);
  });

  it('can be set for a new calendar as it is made', async () => {
    open(undefined, 'events');
    expect(block()).not.toBeNull();
    const name = document.querySelector<HTMLInputElement>('#cal-name')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Trips');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => radio('timed', 'custom').click());
    choose(kind('timed').querySelector('select')!, '1440');
    await act(async () => save().click());
    await act(async () => {});
    const made = useData.getState().calendars.find((c) => c.name === 'Trips')!;
    expect(useSettings.getState().calendarAlarms).toEqual({ [made.id]: { timed: [1440] } });
  });

  it('are not offered for task lists, read-only calendars and new task lists', () => {
    open(TASKS);
    expect(block()).toBeNull();
    act(() => root!.unmount());
    open(SHARED);
    expect(block()).toBeNull();
    act(() => root!.unmount());
    open(undefined, 'tasks');
    expect(block()).toBeNull();
  });

  it('read in Polish, impersonally', () => {
    useSettings.setState({ language: 'pl', defaultAllDayAlarms: [-540] });
    open(PERSONAL);
    expect(block()!.querySelector('legend')!.textContent).toBe('Domyślne powiadomienia');
    expect(labelOf(radio('timed', 'general'))).toBe('Jak w ustawieniach ogólnych (15 min przed)');
    expect(labelOf(radio('allDay', 'general'))).toMatch(/^Jak w ustawieniach ogólnych \(w dniu wydarzenia o 0?9:00\)$/);
    expect(labelOf(radio('timed', 'custom'))).toBe('Własne');
    expect(block()!.textContent).toContain(pl['calendarAlarms.hint']);
  });
});

describe('the strings of default notifications', () => {
  it('exist in English and Polish alike, translated, with the same placeholders', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('calendarAlarms.')) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(8);
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const key of keys) {
      expect(pl[key], key).toBeTruthy();
      expect(pl[key], key).not.toBe(en[key]);
      expect(vars(pl[key]), key).toBe(vars(en[key]));
    }
    // Polish without addressing the reader.
    for (const key of keys) expect(pl[key], key).not.toMatch(/\b(Twoj|Twoje|Twój|Ty|możesz|wybierz|ustaw)\b/i);
  });
});
