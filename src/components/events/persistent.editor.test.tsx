// @vitest-environment jsdom
// The editors' choice of a notification that stays (lib/persistent.ts):
// offered below the notifications once there is one, and dropped with the last.
import { act, createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { newEventDraft } from '@/lib/actions';
import { emptyTask } from '@/lib/ical/tasks';
import { LOCAL_ACCOUNT_ID, useData, type Calendar } from '@/store/data';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { TaskEditor } from '@/components/tasks/TaskEditor';
import { EventEditor } from './EventEditor';

const PERSONAL = 'local|personal';
const TASKS = 'local|tasks';

function calendar(id: string, components: Calendar['components']): Calendar {
  return { id, accountId: LOCAL_ACCOUNT_ID, remoteId: id.split('|')[1], name: id, color: '#2d772a', components, readOnly: false, visible: true, order: 0 };
}

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  useSettings.setState({ ...DEFAULT_SETTINGS, language: 'en', defaultCalendarId: PERSONAL, defaultAlarms: [15], calendarAlarms: {} });
  useData.setState({
    accounts: [{ id: LOCAL_ACCOUNT_ID, kind: 'local', name: 'On this device', useProxy: false }],
    calendars: [calendar(PERSONAL, ['VEVENT']), calendar(TASKS, ['VTODO'])],
  });
  useUi.setState({ eventEditor: null, taskEditor: null, toasts: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useUi.setState({ eventEditor: null, taskEditor: null });
  document.body.innerHTML = '';
});

function draw(element: Parameters<Root['render']>[0]) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(element));
}

const persistentBox = () => [...document.querySelectorAll('label')].find((l) => l.textContent === en['editor.persistent'])?.querySelector('input');
const removeLast = () => act(() => [...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${en['alarm.remove']}"]`)].pop()!.click());
const addNotification = () => act(() => [...document.querySelectorAll('button')].find((b) => b.textContent === en['editor.addNotification'])!.click());

describe('a notification that stays, in the event editor', () => {
  it('is offered with a notification, says what it does, and is turned on', () => {
    useUi.setState({ eventEditor: newEventDraft(new Date(2026, 9, 14, 9))! });
    draw(h(EventEditor));
    const box = persistentBox()!;
    expect(box.checked).toBe(false);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe(en['editor.persistentHint.event']);
    act(() => box.click());
    expect(persistentBox()!.checked).toBe(true);
    expect(useUi.getState().eventEditor).not.toBeNull();
  });

  it('goes with the last notification, and is off when one is added again', () => {
    const draft = newEventDraft(new Date(2026, 9, 14, 9))!;
    useUi.setState({ eventEditor: { ...draft, data: { ...draft.data, persistent: true } } });
    draw(h(EventEditor));
    expect(persistentBox()!.checked).toBe(true);
    removeLast();
    expect(persistentBox()).toBeUndefined();
    addNotification();
    expect(persistentBox()!.checked).toBe(false);
  });
});

describe('a notification that stays, in the task editor', () => {
  it('is offered once the task has a due date and a notification, and says Done ends it', () => {
    useUi.setState({ taskEditor: { mode: 'create', calendarId: TASKS, data: emptyTask({ title: 'Pay rent', due: new Date(2026, 9, 14), dueAllDay: true, alarms: [0], persistent: true }) } });
    draw(h(TaskEditor));
    const box = persistentBox()!;
    expect(box.checked).toBe(true);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe(en['editor.persistentHint.task']);
    removeLast();
    expect(persistentBox()).toBeUndefined();
  });

  it('is not offered without notifications', () => {
    useUi.setState({ taskEditor: { mode: 'create', calendarId: TASKS, data: emptyTask({ title: 'Someday', due: new Date(2026, 9, 14), dueAllDay: true, alarms: [] }) } });
    draw(h(TaskEditor));
    expect(persistentBox()).toBeUndefined();
  });
});
