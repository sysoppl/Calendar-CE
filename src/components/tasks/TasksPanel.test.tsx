// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { TasksPanel } from './TasksPanel';

const list: Calendar = { id: 'local|tasks', accountId: 'local', remoteId: 'tasks', name: 'Tasks', color: '#2d772a', components: ['VTODO'], readOnly: false, visible: true, order: 0 };

const todo = (url: string, uid: string, title: string, parent?: string) => ({
  url,
  etag: '1',
  calendarId: list.id,
  data: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', `UID:${uid}`, `SUMMARY:${title}`, ...(parent ? [`RELATED-TO:${parent}`] : []), 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n'),
});

let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useData.setState({ calendars: [], objects: {} });
});

function show(objects: ReturnType<typeof todo>[]): string {
  useSettings.setState({ language: 'en', tasksPanelOpen: true, showCompletedTasks: false });
  useData.setState({ calendars: [list], objects: { [list.id]: Object.fromEntries(objects.map((o) => [o.url, o])) } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(h(TasksPanel)));
  return document.body.textContent ?? '';
}

describe('TasksPanel with tasks from elsewhere', () => {
  it('shows two tasks sharing a UID, one naming it as its parent, instead of recursing for ever', () => {
    const text = show([todo('x1.ics', 'X', 'First'), todo('x2.ics', 'X', 'Second', 'X')]);
    expect(text).toContain('First');
    expect(text).toContain('Second');
  });

  it('shows the tasks of a cycle', () => {
    const text = show([todo('a.ics', 'A', 'Alpha', 'B'), todo('b.ics', 'B', 'Beta', 'A')]);
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
  });

  it('still shows a subtask under its parent', () => {
    show([todo('p.ics', 'P', 'Parent'), todo('c.ics', 'C', 'Child', 'P')]);
    const indent = (title: string) => [...document.querySelectorAll<HTMLElement>('[style*="padding-left"]')].find((e) => e.textContent?.includes(title))?.style.paddingLeft;
    expect(indent('Parent')).toBe('12px');
    expect(indent('Child')).toBe('36px');
  });
});
