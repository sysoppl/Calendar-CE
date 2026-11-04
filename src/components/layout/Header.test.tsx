// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useData, type Account } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useKeyboardUiState } from '@/hooks/useKeyboardUi';
import { makeFormatter } from '@/hooks/useFormat';
import { viewRange } from '@/lib/date';
import type { Task } from '@/lib/ical/types';
import { TOUCH_AREA, TOUCH_HIT } from '@/components/ui/touch';
import { dueTasks, Header, phoneTitle, showsToday } from './Header';

const data = vi.hoisted(() => ({ tasks: [] as Task[] }));
vi.mock('@/hooks/useCalendarData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCalendarData')>()),
  useTasks: () => data.tasks,
}));

let root: Root | null = null;
let width = 1440;

beforeEach(() => {
  width = 1440;
  data.tasks = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
    },
  });
  useSettings.setState({ language: 'en', sidebarCollapsed: false, weekStartsOn: 1, tasksPanelOpen: false });
  useKeyboardUiState.setState({ finePointer: false, hardware: false, typed: false });
  useUi.setState({ view: 'month', date: new Date(), navDir: 0 });
  useUi.getState().clearNavHistory();
  document.body.innerHTML = '';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useData.setState({ accounts: [] });
});

async function header() {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  root.render(h(Header));
  await vi.waitFor(() => expect(host.querySelector('header')).not.toBeNull());
  return host.querySelector('header')!;
}

const has = (el: Element, classes: string) => classes.split(' ').every((c) => el.classList.contains(c));
const labels = (el: Element) => [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);

async function openMore(bar: Element) {
  flushSync(() => bar.querySelector<HTMLElement>('[data-settings-return]')!.click());
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
  return [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
}

describe('Header on a wide screen', () => {
  it('marks its Settings button as the way back into Settings', async () => {
    const bar = await header();
    const marked = [...bar.querySelectorAll('[data-settings-return]')];
    expect(marked.map((b) => b.getAttribute('aria-label'))).toEqual(['Settings']);
  });

  it('has no control to sync: syncing happens by itself', async () => {
    useData.setState({ accounts: [{ id: 'dav', kind: 'caldav', name: 'Work', useProxy: false } as Account] });
    const bar = await header();
    expect(labels(bar)).not.toContain('Sync now');
    expect(bar.textContent).not.toMatch(/sync/i);
  });

  it('lists the keyboard shortcuts in its Settings menu only with a keyboard', async () => {
    let bar = await header();
    expect(await openMore(bar)).not.toContain('Keyboard shortcuts');
    root!.unmount();
    useKeyboardUiState.setState({ finePointer: true });
    bar = await header();
    expect((await openMore(bar)).join()).toContain('Keyboard shortcuts');
  });

  it('keeps the views in a menu and Tasks in the bar on a tablet', async () => {
    width = 900;
    const bar = await header();
    expect(labels(bar)).toEqual(expect.arrayContaining(['Menu', 'Today', 'View', 'Search', 'Tasks', 'Settings']));
  });
});

describe('Header on a phone', () => {
  beforeEach(() => {
    width = 360;
  });

  it('is calm: menu, month, search and one more menu, with no views and no tasks', async () => {
    const bar = await header();
    expect(labels(bar).filter(Boolean)).toEqual(['Menu', expect.stringContaining('Go to date'), 'Search', 'More']);
    expect(bar.querySelector('button[aria-label="View"]')).toBeNull();
    expect(bar.querySelector('button[aria-label="Tasks"]')).toBeNull();
  });

  it('gives its controls 44 px on a touch screen', async () => {
    const bar = await header();
    expect(has(bar, TOUCH_AREA)).toBe(true);
  });

  it('marks its More button as the way back into Settings', async () => {
    const bar = await header();
    const marked = [...bar.querySelectorAll('[data-settings-return]')];
    expect(marked.map((b) => b.getAttribute('aria-label'))).toEqual(['More']);
  });

  it('holds Tasks and Settings in More, and the shortcuts only with a keyboard', async () => {
    let bar = await header();
    expect(await openMore(bar)).toEqual(['Tasks', 'Settings']);
    flushSync(() => document.querySelectorAll<HTMLElement>('[role="menuitem"]')[1].click());
    expect(useUi.getState().settings).toBe('general');
    expect(useUi.getState().settingsList).toBe(true);
    useUi.getState().closeSettings();
    root!.unmount();
    useKeyboardUiState.setState({ hardware: true });
    bar = await header();
    expect(await openMore(bar)).toEqual(['Tasks', 'SettingsS', 'Keyboard shortcuts?']);
  });

  it('opens the tasks from More, with their count and a dot on More when one is overdue', async () => {
    const now = new Date();
    data.tasks = [
      { title: 'Pay rent', completed: false, due: new Date(now.getTime() - 3600_000), dueAllDay: false } as Task,
      { title: 'Later', completed: false, due: new Date(now.getTime() + 7 * 86400_000), dueAllDay: false } as Task,
    ];
    const bar = await header();
    expect(bar.querySelector('[data-overdue]')).not.toBeNull();
    expect(bar.querySelector('[data-settings-return]')!.getAttribute('aria-label')).toBe('More, overdue tasks');
    const items = await openMore(bar);
    expect(items[0]).toBe('Tasks11 due');
    flushSync(() => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    expect(useSettings.getState().tasksPanelOpen).toBe(true);
  });

  it('shows Today only while today is off screen, and it brings today back', async () => {
    const bar = await header();
    expect(labels(bar)).not.toContain('Today');
    flushSync(() => useUi.getState().step(1));
    await vi.waitFor(() => expect(labels(bar)).toContain('Today'));
    flushSync(() => [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Today')!.click());
    expect(useUi.getState().navDir).toBe(-1);
    await vi.waitFor(() => expect(labels(bar)).not.toContain('Today'));
  });

  it("takes the month's short name when the long one does not fit", async () => {
    useSettings.setState({ language: 'pl' });
    useUi.setState({ date: new Date(new Date().getFullYear() + 1, 9, 16) });
    // Too narrow for any title longer than ten letters.
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return (this.textContent?.length ?? 0) > 10 ? 200 : 0; } });
    try {
      const bar = await header();
      await vi.waitFor(() => expect(bar.querySelector('h1')!.textContent).toBe(`Paź ${new Date().getFullYear() + 1}`));
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', width);
      else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });

  it('names the month on screen, without this year', async () => {
    useSettings.setState({ language: 'pl' });
    useUi.setState({ date: new Date(new Date().getFullYear(), 9, 16) });
    const bar = await header();
    expect(bar.querySelector('h1')!.textContent).toBe('Październik');
  });
});

describe('the phone title', () => {
  const fmt = makeFormatter('pl', '24h');
  const now = new Date(2026, 9, 16);
  const title = (view: Parameters<typeof phoneTitle>[1], date: Date) => phoneTitle(fmt, view, viewRange(view, date, 1, 4), date, now);

  it('is the month, with the year when it is not this one, in short when asked', () => {
    expect(phoneTitle(fmt, 'month', viewRange('month', new Date(2027, 9, 1), 1, 4), new Date(2027, 9, 1), now, true)).toBe('Paź 2027');
    expect(title('month', new Date(2026, 9, 1))).toBe('Październik');
    expect(title('month', new Date(2027, 9, 1))).toBe('Październik 2027');
    expect(title('day', new Date(2026, 9, 20))).toBe('Październik');
    expect(title('year', new Date(2027, 0, 1))).toBe('2027');
  });

  it('names both months of a week across two', () => {
    expect(title('week', new Date(2026, 9, 29))).toBe('Paź – Lis');
    expect(title('week', new Date(2026, 11, 30))).toBe('Gru – Sty 2027');
  });
});

describe('what the phone header is told', () => {
  const now = new Date(2026, 9, 16, 12);

  it('knows whether today is on screen in each view', () => {
    expect(showsToday('month', new Date(2026, 9, 2), now, 1, 4)).toBe(true);
    expect(showsToday('month', new Date(2026, 10, 2), now, 1, 4)).toBe(false);
    expect(showsToday('week', new Date(2026, 9, 12), now, 1, 4)).toBe(true);
    expect(showsToday('week', new Date(2026, 9, 19), now, 1, 4)).toBe(false);
    expect(showsToday('day', new Date(2026, 9, 16, 8), now, 1, 4)).toBe(true);
    expect(showsToday('agenda', new Date(2026, 9, 15), now, 1, 4)).toBe(false);
    expect(showsToday('year', new Date(2026, 0, 1), now, 1, 4)).toBe(true);
  });

  it('counts the open tasks due by today, and sees one overdue', () => {
    const task = (due: Date | undefined, extra: Partial<Task> = {}) => ({ title: 't', completed: false, due, dueAllDay: false, ...extra }) as Task;
    expect(dueTasks([task(new Date(2026, 9, 16, 18))], now)).toEqual({ due: 1, overdue: false });
    expect(dueTasks([task(new Date(2026, 9, 16, 9))], now)).toEqual({ due: 1, overdue: true });
    expect(dueTasks([task(new Date(2026, 9, 16), { dueAllDay: true })], now)).toEqual({ due: 1, overdue: false });
    expect(dueTasks([task(new Date(2026, 9, 15), { dueAllDay: true })], now)).toEqual({ due: 1, overdue: true });
    expect(dueTasks([task(new Date(2026, 9, 17)), task(undefined), task(new Date(2026, 9, 1), { completed: true })], now)).toEqual({ due: 0, overdue: false });
  });
});

it('keeps the View button drawn at 36 px with a 44 px hit area on a tablet', async () => {
  width = 900;
  const bar = await header();
  const view = bar.querySelector('button[aria-label="View"]')!;
  expect(has(view, `h-9 ${TOUCH_HIT}`)).toBe(true);
  expect(view.className).not.toContain('min-h-');
});
