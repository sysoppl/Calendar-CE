// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { ViewBar } from './ViewBar';

let root: Root | null = null;
let host: HTMLElement;
let width = 360;

beforeEach(() => {
  width = 360;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
  useSettings.setState({ language: 'en' });
  useUi.setState({ view: 'month', date: new Date(2026, 9, 16) });
  useUi.getState().clearNavHistory();
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
});

afterEach(() => {
  root?.unmount();
  root = null;
});

async function bar() {
  root = createRoot(host);
  root.render(h(ViewBar));
  await vi.waitFor(() => expect(host.querySelector('[role="tablist"]')).not.toBeNull());
  return host.querySelector('[role="tablist"]')!;
}

const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

describe('ViewBar', () => {
  it('names the five views of a phone in full, the one on screen selected', async () => {
    const list = await bar();
    expect(list.getAttribute('aria-label')).toBe('View');
    expect(tabs().map((t) => t.textContent)).toEqual(['Agenda', 'Day', 'Week', 'Month', 'Year']);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true', 'false']);
    // One stop for Tab: the view on screen.
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it('switches the view with one tap, and remembers the way back', async () => {
    await bar();
    flushSync(() => tabs()[1].click());
    expect(useUi.getState().view).toBe('day');
    await vi.waitFor(() => expect(tabs()[1].getAttribute('aria-selected')).toBe('true'));
    expect(useUi.getState().navBack()).toBe(true);
    expect(useUi.getState().view).toBe('month');
  });

  it('goes to a real week, also in Polish', async () => {
    useSettings.setState({ language: 'pl' });
    await bar();
    expect(tabs().map((t) => t.textContent)).toEqual(['Agenda', 'Dzień', 'Tydzień', 'Miesiąc', 'Rok']);
    flushSync(() => tabs()[2].click());
    expect(useUi.getState().view).toBe('week');
  });

  it('moves between the views with the arrow keys', async () => {
    await bar();
    flushSync(() => tabs()[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(useUi.getState().view).toBe('year');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[4]));
    flushSync(() => tabs()[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(useUi.getState().view).toBe('agenda');
  });

  it('selects none for the "N days" view, chosen in Settings, and lets Tab reach the first', async () => {
    useUi.setState({ view: 'days' });
    await bar();
    expect(tabs().some((t) => t.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(tabs()[0].tabIndex).toBe(0);
  });

  it('is not there on a wider screen, where the header has the views', async () => {
    width = 1024;
    root = createRoot(host);
    flushSync(() => root!.render(h(ViewBar)));
    expect(host.childNodes).toHaveLength(0);
  });
});
