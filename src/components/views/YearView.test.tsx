// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { YearView } from './YearView';
import { AgendaView } from './AgendaView';

const data = vi.hoisted(() => ({ tasks: [] as Task[] }));
vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => new Map(),
  useOccurrences: () => [],
  useTasks: () => data.tasks,
}));
const actions = vi.hoisted(() => ({ openEditTask: vi.fn(), toggleTask: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/actions', () => actions);

let width = 360;
let root: Root | null = null;

beforeAll(() => {
  // Each month's section sits 300 px below the one two before it (two to a row).
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const month = this.dataset.month;
      return month === undefined ? 0 : 12 + Math.floor(Number(month) / 2) * 300;
    },
  });
});

beforeEach(() => {
  width = 360;
  data.tasks = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
  useSettings.setState({ language: 'en', weekStartsOn: 1, showTasksInCalendar: true, showCompletedTasks: false });
});

afterEach(() => {
  root?.unmount();
  root = null;
});

function draw(view: typeof YearView | typeof AgendaView) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(view)));
  return host;
}

describe('the year on a phone', () => {
  it('shows two months side by side and opens at this month', () => {
    const now = new Date();
    useUi.setState({ view: 'year', date: now });
    const host = draw(YearView);
    expect(host.querySelector('[data-year-grid]')!.classList).toContain('grid-cols-2');
    const scroller = host.firstElementChild as HTMLElement;
    expect(scroller.scrollTop).toBe(Math.max(0, 12 + Math.floor(now.getMonth() / 2) * 300 - 8));
  });

  it('opens another year at January', () => {
    useUi.setState({ view: 'year', date: new Date(new Date().getFullYear() + 1, 5, 1) });
    const host = draw(YearView);
    expect((host.firstElementChild as HTMLElement).scrollTop).toBe(0);
  });

  it('keeps its columns on a computer', () => {
    width = 1280;
    useUi.setState({ view: 'year', date: new Date() });
    const host = draw(YearView);
    expect(host.querySelector('[data-year-grid]')!.classList).toContain('xl:grid-cols-4');
    expect((host.firstElementChild as HTMLElement).scrollTop).toBe(0);
  });
});

describe('the agenda', () => {
  it('lists a task like an event, with a ring that ticks it off', () => {
    const due = new Date(2026, 9, 16, 15);
    data.tasks = [{ title: 'Pay rent', calendarId: 'list', objectUrl: 'task1', completed: false, due, dueAllDay: false } as Task];
    useUi.setState({ view: 'agenda', date: new Date(2026, 9, 16) });
    const host = draw(AgendaView);
    const row = host.querySelector('[data-agenda-task]')!;
    expect(row.className).not.toMatch(/\bborder\b/);
    expect(row.textContent).toContain('Pay rent');
    flushSync(() => row.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    expect(actions.toggleTask).toHaveBeenCalledWith(data.tasks[0]);
    flushSync(() => [...row.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes('Pay rent'))!.click());
    expect(actions.openEditTask).toHaveBeenCalledWith(data.tasks[0]);
  });

  it('leaves room under its last day for the new-event button', () => {
    data.tasks = [{ title: 'Pay rent', calendarId: 'list', objectUrl: 'task1', completed: false, due: new Date(2026, 9, 16, 15), dueAllDay: false } as Task];
    useUi.setState({ view: 'agenda', date: new Date(2026, 9, 16) });
    const host = draw(AgendaView);
    expect(host.querySelector('[data-pager]')!.classList).toContain('pb-20');
  });
});
