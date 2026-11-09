// @vitest-environment jsdom
// The Settings page as a phone and a computer show it: which sections, which
// rows, and how changes are saved.
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useKeyboardUiState } from '@/hooks/useKeyboardUi';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';

// Nothing here may reach a server (see AccountSummary.test.tsx).
const network = vi.hoisted(() => ({ fetch: vi.fn(() => Promise.reject(new Error('No network in this test'))) }));
vi.stubGlobal('fetch', network.fetch);
vi.mock('@/theme/fonts', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/theme/fonts')>()), loadAllFonts: () => {} }));

const { SettingsPage } = await import('./SettingsPage');
const { GeneralSection } = await import('./GeneralSection');
const { CalendarsSection } = await import('./CalendarsSection');
const { TasksSection } = await import('./TasksSection');

let root: Root | null = null;
let phone = false;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: phone && query.includes('max-width'), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  phone = false;
  useSettings.setState({ ...DEFAULT_SETTINGS, language: 'en' });
  useKeyboardUiState.setState({ finePointer: false, hardware: false, typed: false });
  useUi.setState({ toasts: [], settings: null, settingsList: false });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.getState().closeSettings();
  expect(network.fetch).not.toHaveBeenCalled();
});

async function render(node: Parameters<Root['render']>[0]) {
  root = createRoot(document.getElementById('root')!);
  root.render(node);
  await new Promise((r) => setTimeout(r, 20));
}

const text = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll('button')];
const navLabels = () => [...document.querySelectorAll('nav li button')].map((b) => b.textContent);

describe('The list of sections', () => {
  it('has no Shortcuts on a phone without a keyboard', async () => {
    phone = true;
    useUi.getState().openSettings('general', { list: true });
    await render(h(SettingsPage));
    expect(navLabels()).toContain(en['settings.section.general']);
    expect(navLabels()).not.toContain(en['settings.section.shortcuts']);
  });

  it('has them once a keyboard is there', async () => {
    phone = true;
    useKeyboardUiState.setState({ typed: true });
    useUi.getState().openSettings('general', { list: true });
    await render(h(SettingsPage));
    expect(navLabels()).toContain(en['settings.section.shortcuts']);
  });

  it('shows General when asked for the shortcuts without a keyboard', async () => {
    useUi.getState().openSettings('shortcuts');
    await render(h(SettingsPage));
    expect(document.querySelector('main h2')?.textContent).toBe(en['settings.section.general']);
    expect(document.querySelector('kbd')).toBeNull();
  });

  it('names the back arrow of a section on a phone after where it goes', async () => {
    phone = true;
    useUi.getState().showSettingsList(false, 'tasks');
    await render(h(SettingsPage));
    const back = document.querySelector('main button[aria-label]')!;
    expect(back.getAttribute('aria-label')).toBe('All settings');
    (back as HTMLButtonElement).click();
    expect(useUi.getState().settingsList).toBe(true);
  });
});

describe('General', () => {
  it('has no "Sync every" row: the app syncs by itself', async () => {
    await render(h(GeneralSection));
    expect(text()).not.toContain('Sync every');
    expect(document.getElementById('set-sync')).toBeNull();
  });

  it('leaves no manual sync wording in either language', async () => {
    const { pl } = await import('@/i18n/pl');
    const retired = ['nav.sync', 'nav.syncing', 'toast.synced', 'settings.syncInterval', 'settings.syncManual', 'settings.syncAccount', 'account.lastSync', 'shortcuts.sync', 'storage.chip.sync', 'storage.state.synced', 'storage.state.never', 'storage.state.syncing'];
    for (const dict of [en, pl] as Record<string, string>[]) {
      for (const key of retired) expect(dict[key], key).toBeUndefined();
      expect(Object.values(dict)).not.toEqual(expect.arrayContaining(['Sync now', 'Synchronizuj teraz', 'Sync every', 'Synchronizuj co']));
    }
  });

  it('groups its rows under headings', async () => {
    await render(h(GeneralSection));
    expect([...document.querySelectorAll('section > h3')].map((e) => e.textContent)).toEqual(['Language and format', 'Calendar view', 'New events']);
  });

  it('writes the days the week can start on with a capital letter, in one row that shares the width', async () => {
    useSettings.setState({ language: 'pl' });
    await render(h(GeneralSection));
    const group = [...document.querySelectorAll('[role="group"]')].find((g) => g.textContent?.includes('Poniedziałek'))!;
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Poniedziałek', 'Niedziela', 'Sobota']);
    expect(group.className).toContain('auto-cols-fr');
  });

  it('gives a long value the whole width on a phone, and short values one width at the end of their row', async () => {
    await render(h(GeneralSection));
    const row = (id: string) => document.getElementById(id)!.closest('.border-b')!;
    // Long values ("System default", "24-hour (13:00)", "1 day before at 09:00") sit under their label.
    for (const id of ['set-lang', 'set-time', 'set-alarm', 'set-alarm-ad']) {
      expect(row(id).className, id).toContain('flex-col');
      expect(document.getElementById(id)!.className, id).toContain('max-sm:w-full');
    }
    // Short ones ("Week", "4 days", "07:00", "30 minutes") share one width, so both edges line up.
    for (const id of ['set-view', 'set-days', 'set-daystart', 'set-dur']) {
      expect(row(id).className, id).not.toContain('flex-col');
      expect(document.getElementById(id)!.className.split(' '), id).toEqual(expect.arrayContaining(['w-36', 'shrink-0', 'sm:w-auto']));
    }
  });

  it('puts every switch at the end of its row', async () => {
    await render(h(GeneralSection));
    const switches = [...document.querySelectorAll('[role="switch"]')];
    expect(switches.length).toBeGreaterThanOrEqual(5);
    for (const s of switches) expect(s.parentElement!.parentElement!.className).not.toContain('flex-col');
  });

  it('shows no profile choice and no per-device badges', async () => {
    await render(h(GeneralSection));
    expect(document.getElementById('set-profile')).toBeNull();
    expect(document.querySelector('[data-scope]')).toBeNull();
  });

  it('lets a phone choose what the round + button starts, a new event by default', async () => {
    phone = true;
    await render(h(GeneralSection));
    const select = document.getElementById('set-fab') as HTMLSelectElement;
    expect(select.value).toBe('event');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['event', en['sidebar.newEvent']],
      ['task', en['sidebar.newTask']],
      ['choose', en['settings.fab.choose']],
    ]);
    expect(select.closest('.border-b')!.textContent).toContain(en['settings.fab.hint']);
    select.value = 'choose';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(useSettings.getState().fabAction).toBe('choose');
    select.value = 'task';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(useSettings.getState().fabAction).toBe('task');
  });

  it('shows the round + button choice only where the button is', async () => {
    await render(h(GeneralSection));
    expect(document.getElementById('set-fab')).toBeNull();
    expect(text()).not.toContain(en['settings.fab']);
  });

  it('resets the settings with a way back', async () => {
    useSettings.setState({ showWeekends: false });
    await render(h(GeneralSection));
    buttons().find((b) => b.textContent === en['settings.resetSettings'])!.click();
    expect(useSettings.getState().showWeekends).toBe(true);
    const toast = useUi.getState().toasts.at(-1)!;
    expect([toast.message, toast.action?.label]).toEqual(['Settings reset', 'Undo']);
    toast.action!.run();
    expect(useSettings.getState().showWeekends).toBe(false);
  });
});

describe('Account & storage', () => {
  it('keeps the gap before a main part of the page short on a phone', async () => {
    const { GroupHeading } = await import('@/components/account/shared');
    await render(h(GroupHeading, { major: true, children: 'Storage' }));
    const classes = document.querySelector('h3')!.parentElement!.className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['mt-6', 'sm:mt-12']));
    expect(classes).not.toContain('mt-8');
  });
});

describe('Import and export', () => {
  it('gives both selects the same whole width on a phone, their buttons under them', async () => {
    phone = true;
    useUi.getState().showSettingsList(false, 'import');
    await render(h(SettingsPage));
    const selects = [...document.querySelectorAll('main select')];
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.className).toContain('max-sm:w-full');
      expect(select.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['w-full', 'flex-wrap']));
    }
  });
});

describe('Tasks', () => {
  it('switches with a tap anywhere on the row text, and says it is saved', async () => {
    await render(h(TasksSection));
    vi.useFakeTimers();
    try {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent === en['settings.showCompletedTasks'])!;
      label.click();
      expect(useSettings.getState().showCompletedTasks).toBe(true);
      await vi.advanceTimersByTimeAsync(700);
      expect(useUi.getState().toasts.map((t) => t.message)).toEqual(['Saved']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Calendars & accounts', () => {
  beforeEach(() => {
    useData.setState({ accounts: [{ id: 'local', kind: 'local', name: 'This device', useProxy: false }], calendars: [] });
  });

  it('saves my e-mail addresses when the field is left, not with each key', async () => {
    const original = useSettings.getState().update;
    const update = vi.fn(original);
    useSettings.setState({ update });
    try {
      await render(h(CalendarsSection));
      const field = document.getElementById('set-emails') as HTMLInputElement;
      field.focus();
      for (const value of ['a', 'a@', 'a@example.com']) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      expect(update).not.toHaveBeenCalled();
      field.blur();
      expect(update.mock.calls).toEqual([[{ myEmails: 'a@example.com' }]]);
      expect(field.value).toBe('a@example.com');
    } finally {
      useSettings.setState({ update: original });
    }
  });

  it('saves them with Enter too, once', async () => {
    await render(h(CalendarsSection));
    const field = document.getElementById('set-emails') as HTMLInputElement;
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'b@example.com');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(useSettings.getState().myEmails).toBe('b@example.com');
  });

  it('keeps what was typed when Settings closes before the field is left', async () => {
    await render(h(CalendarsSection));
    const field = document.getElementById('set-emails') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'c@example.com');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    root!.unmount();
    root = null;
    expect(useSettings.getState().myEmails).toBe('c@example.com');
  });

  it('lists the ways to add calendars on a phone as full-width rows, the account one in the accent colour', async () => {
    phone = true;
    await render(h(CalendarsSection));
    const rows = [...document.querySelectorAll<HTMLButtonElement>('ul > li > button')].slice(0, 5);
    expect(rows.map((r) => r.textContent)).toEqual([en['settings.addAccount'], en['settings.newCalendar'], en['settings.newTaskList'], en['sidebar.addHolidays'], en['sidebar.addSubscription']]);
    for (const r of rows) expect(r.className).toContain('w-full');
    expect(rows[0].className).toContain('text-primary');
    expect(rows[1].className).not.toContain('text-primary');
    rows[0].click();
    expect(useUi.getState().accountDialog).toBe(true);
  });

  it('draws no empty list under an account without calendars', async () => {
    useData.setState({ accounts: [{ id: 'local', kind: 'local', name: 'This device', useProxy: false }], calendars: [] });
    await render(h(CalendarsSection));
    const card = document.querySelector('section[aria-labelledby="acc-local"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('ul')).toBeNull();
    useData.setState({ calendars: [{ id: 'c1', accountId: 'local', name: 'Home', color: '#007c73', components: ['VEVENT'], order: 0, visible: true, readOnly: false } as never] });
    await new Promise((r) => setTimeout(r, 20));
    expect(card.querySelector('ul')?.textContent).toContain('Home');
  });

  it('keeps the row of buttons on a computer', async () => {
    await render(h(CalendarsSection));
    const first = buttons().find((b) => b.textContent === en['settings.addAccount'])!;
    expect(first.closest('ul')).toBeNull();
  });
});
