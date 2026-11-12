// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysInRange, viewRange } from '@/lib/date';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { PHONE_VIEWS, ViewBar, barViews } from './ViewBar';

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
  useSettings.setState({ language: 'en', customDays: 3, weekStartsOn: 1, viewBarAgenda: true, viewBarDays: true });
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
const daysTab = () => host.querySelector<HTMLButtonElement>('[role="tab"][data-view="days"]')!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const choices = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const key = (el: Element, k: string) => flushSync(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

/** Shows the "N days" view and taps its tab again, which opens the choice of days. */
async function openChooser() {
  useUi.setState({ view: 'days' });
  await bar();
  daysTab().focus();
  flushSync(() => daysTab().click());
  await vi.waitFor(() => expect(menu()).not.toBeNull());
}

/** How many days the view on screen spans. */
function shownDays(): number {
  const { view, date } = useUi.getState();
  const s = useSettings.getState();
  return daysInRange(viewRange(view, date, s.weekStartsOn, s.customDays)).length;
}

describe('ViewBar', () => {
  it('names the six views of a phone in full, "N days" with its length, the one on screen selected', async () => {
    const list = await bar();
    expect(list.getAttribute('aria-label')).toBe('View');
    expect(tabs().map((t) => t.textContent)).toEqual(['Agenda', 'Day', '3 days', 'Week', 'Month', 'Year']);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false', 'true', 'false']);
    // One stop for Tab: the view on screen.
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, -1, -1, 0, -1]);
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
    expect(tabs().map((t) => t.textContent)).toEqual(['Agenda', 'Dzień', '3 dni', 'Tydzień', 'Miesiąc', 'Rok']);
    flushSync(() => tabs()[3].click());
    expect(useUi.getState().view).toBe('week');
    expect(shownDays()).toBe(7);
  });

  it('moves between the six views with the arrow keys, Home and End', async () => {
    await bar();
    key(tabs()[4], 'ArrowRight');
    expect(useUi.getState().view).toBe('year');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[5]));
    key(tabs()[5], 'ArrowRight');
    expect(useUi.getState().view).toBe('agenda');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[0]));
    key(tabs()[0], 'ArrowLeft');
    expect(useUi.getState().view).toBe('year');
    key(tabs()[5], 'Home');
    expect(useUi.getState().view).toBe('agenda');
    key(tabs()[0], 'End');
    expect(useUi.getState().view).toBe('year');
    // Through "N days" between Day and Week, which the arrows only select.
    flushSync(() => useUi.setState({ view: 'week' }));
    key(tabs()[3], 'ArrowLeft');
    expect(useUi.getState().view).toBe('days');
    await vi.waitFor(() => expect(document.activeElement).toBe(daysTab()));
    expect(menu()).toBeNull();
    key(daysTab(), 'ArrowLeft');
    expect(useUi.getState().view).toBe('day');
  });

  it('shows the "N days" view with one tap, without opening anything', async () => {
    await bar();
    // Not selected: a plain tab, no menu behind it.
    expect(daysTab().hasAttribute('aria-haspopup')).toBe(false);
    expect(daysTab().querySelector('svg')!.classList.contains('invisible')).toBe(true);
    flushSync(() => daysTab().click());
    expect(useUi.getState().view).toBe('days');
    expect(shownDays()).toBe(3);
    await vi.waitFor(() => expect(daysTab().getAttribute('aria-selected')).toBe('true'));
    expect(menu()).toBeNull();
    // Selected: its caret shows, and it says that it opens a menu.
    expect(daysTab().tabIndex).toBe(0);
    expect(daysTab().querySelector('svg')!.classList.contains('invisible')).toBe(false);
    expect(daysTab().getAttribute('aria-haspopup')).toBe('menu');
    expect(daysTab().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the choice of days with another tap, the current one checked and focused', async () => {
    await openChooser();
    expect(daysTab().getAttribute('aria-expanded')).toBe('true');
    expect(daysTab().getAttribute('aria-controls')).toBe(menu()!.id);
    expect(menu()!.getAttribute('aria-label')).toBe('Number of days');
    expect(menu()!.hasAttribute('aria-labelledby')).toBe(false);
    // The same lengths as Settings offers, 2 to 7 days.
    expect(choices().map((c) => c.textContent)).toEqual(['2 days', '3 days', '4 days', '5 days', '6 days', '7 days']);
    expect(choices().map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[1]));
    // The arrows move between the lengths, round the ends.
    key(choices()[1], 'ArrowDown');
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[2]));
    key(choices()[2], 'ArrowUp');
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[1]));
    key(choices()[1], 'ArrowUp');
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[0]));
    key(choices()[0], 'ArrowUp');
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[5]));
  });

  it('changes the setting and the days shown with a choice, then closes and gives the focus back to the tab', async () => {
    await openChooser();
    flushSync(() => choices()[3].click());
    expect(useSettings.getState().customDays).toBe(5);
    expect(useUi.getState().view).toBe('days');
    expect(shownDays()).toBe(5);
    await vi.waitFor(() => expect(menu()).toBeNull());
    expect(daysTab().textContent).toBe('5 days');
    expect(daysTab().getAttribute('aria-expanded')).toBe('false');
    await vi.waitFor(() => expect(document.activeElement).toBe(daysTab()));
  });

  it('closes with Escape, giving the focus back to the tab, and with another tap on it', async () => {
    await openChooser();
    await vi.waitFor(() => expect(document.activeElement).toBe(choices()[1]));
    key(choices()[1], 'Escape');
    await vi.waitFor(() => expect(menu()).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(daysTab()));
    expect(useSettings.getState().customDays).toBe(3);

    flushSync(() => daysTab().click());
    await vi.waitFor(() => expect(menu()).not.toBeNull());
    flushSync(() => daysTab().click());
    await vi.waitFor(() => expect(menu()).toBeNull());
    expect(useUi.getState().view).toBe('days');
  });

  it('closes with a tap outside, changing nothing', async () => {
    await openChooser();
    flushSync(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(menu()).toBeNull());
    expect(useSettings.getState().customDays).toBe(3);
  });

  it('closes for good when another view comes, and does not open again on the way back', async () => {
    await openChooser();
    flushSync(() => useUi.getState().setView('week'));
    await vi.waitFor(() => expect(menu()).toBeNull());
    flushSync(() => daysTab().click());
    expect(useUi.getState().view).toBe('days');
    await vi.waitFor(() => expect(daysTab().getAttribute('aria-selected')).toBe('true'));
    expect(menu()).toBeNull();
  });

  it('is not there on a wider screen, where the header has the views', async () => {
    width = 1024;
    root = createRoot(host);
    flushSync(() => root!.render(h(ViewBar)));
    expect(host.childNodes).toHaveLength(0);
  });
});

describe('ViewBar with tabs hidden in Settings', () => {
  const names = () => tabs().map((t) => t.textContent);
  const views = () => tabs().map((t) => t.dataset.view);

  it('shows Agenda and "N days" only while their settings are on: six, five or four tabs', async () => {
    const cases: [boolean, boolean, string[]][] = [
      [true, true, ['Agenda', 'Day', '3 days', 'Week', 'Month', 'Year']],
      [false, true, ['Day', '3 days', 'Week', 'Month', 'Year']],
      [true, false, ['Agenda', 'Day', 'Week', 'Month', 'Year']],
      [false, false, ['Day', 'Week', 'Month', 'Year']],
    ];
    for (const [viewBarAgenda, viewBarDays, expected] of cases) {
      useSettings.setState({ viewBarAgenda, viewBarDays });
      await bar();
      expect(names(), `${viewBarAgenda} ${viewBarDays}`).toEqual(expected);
      expect(barViews(viewBarAgenda, viewBarDays)).toEqual(views());
      // The view on screen (month) is still the one selected, and the Tab key's one stop.
      expect(tabs().filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.view)).toEqual(['month']);
      expect(tabs().filter((t) => t.tabIndex === 0).map((t) => t.dataset.view)).toEqual(['month']);
      root!.unmount();
      root = null;
    }
  });

  it('follows the settings while it is shown', async () => {
    await bar();
    expect(tabs()).toHaveLength(6);
    flushSync(() => useSettings.setState({ viewBarAgenda: false }));
    expect(views()).toEqual(['day', 'days', 'week', 'month', 'year']);
    flushSync(() => useSettings.setState({ viewBarDays: false }));
    expect(views()).toEqual(['day', 'week', 'month', 'year']);
    flushSync(() => useSettings.setState({ viewBarAgenda: true, viewBarDays: true }));
    expect(views()).toEqual(PHONE_VIEWS);
  });

  it('selects no tab while a hidden view is on screen, gives the Tab key to the first tab, and still switches views', async () => {
    useSettings.setState({ viewBarAgenda: false, viewBarDays: false });
    for (const hidden of ['agenda', 'days'] as const) {
      useUi.setState({ view: hidden });
      await bar();
      expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false']);
      expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
      expect(menu()).toBeNull();
      flushSync(() => tabs()[2].click());
      expect(useUi.getState().view).toBe('month');
      await vi.waitFor(() => expect(tabs()[2].getAttribute('aria-selected')).toBe('true'));
      root!.unmount();
      root = null;
    }
    // The hidden "N days" view still shows its days.
    useUi.setState({ view: 'days' });
    expect(shownDays()).toBe(3);
  });

  it('moves with the arrow keys, Home and End over the tabs shown only', async () => {
    useSettings.setState({ viewBarAgenda: false });
    await bar();
    // Five tabs: Day, 3 days, Week, Month, Year.
    key(tabs()[3], 'ArrowRight');
    expect(useUi.getState().view).toBe('year');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[4]));
    key(tabs()[4], 'ArrowRight');
    expect(useUi.getState().view).toBe('day');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[0]));
    key(tabs()[0], 'ArrowLeft');
    expect(useUi.getState().view).toBe('year');
    key(tabs()[4], 'Home');
    expect(useUi.getState().view).toBe('day');
    key(tabs()[0], 'ArrowRight');
    expect(useUi.getState().view).toBe('days');
    root!.unmount();

    // Four tabs: Day, Week, Month, Year; never to a hidden view.
    useSettings.setState({ viewBarDays: false });
    useUi.setState({ view: 'day' });
    await bar();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const at = tabs().findIndex((t) => t.dataset.view === useUi.getState().view);
      key(tabs()[at], 'ArrowRight');
      seen.push(useUi.getState().view);
    }
    expect(seen).toEqual(['week', 'month', 'year', 'day']);
    key(tabs()[0], 'End');
    expect(useUi.getState().view).toBe('year');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs()[3]));

    // From a hidden view on screen, the first tab (the Tab key's stop) moves on as usual.
    flushSync(() => useUi.setState({ view: 'agenda' }));
    expect(tabs()[0].tabIndex).toBe(0);
    key(tabs()[0], 'ArrowRight');
    expect(useUi.getState().view).toBe('week');
  });

  it('closes the choice of days for good when its tab is hidden, the view staying', async () => {
    await openChooser();
    flushSync(() => useSettings.setState({ viewBarDays: false }));
    await vi.waitFor(() => expect(menu()).toBeNull());
    expect(host.querySelector('[data-view="days"]')).toBeNull();
    expect(useUi.getState().view).toBe('days');
    // Back again: the tab is selected, its menu not open.
    flushSync(() => useSettings.setState({ viewBarDays: true }));
    await vi.waitFor(() => expect(daysTab().getAttribute('aria-selected')).toBe('true'));
    expect(menu()).toBeNull();
    expect(daysTab().getAttribute('aria-expanded')).toBe('false');
  });
});
