// @vitest-environment jsdom
import { createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useShortcuts } from './useShortcuts';

const actions = vi.hoisted(() => ({
  startNewEvent: vi.fn(),
  openNewTask: vi.fn(),
  openEditEvent: vi.fn(),
  deleteOccurrence: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/actions', () => actions);
const autoSync = vi.hoisted(() => ({ refreshNow: vi.fn((): Promise<void> => Promise.resolve()) }));
vi.mock('@/lib/autoSync', () => autoSync);

let root: Root | null = null;

let listening = false;

function Probe() {
  useShortcuts();
  // Effects run in order: once this one has, the shortcuts listen.
  useEffect(() => {
    listening = true;
    return () => void (listening = false);
  }, []);
  return null;
}

async function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(h(Probe));
  await vi.waitFor(() => expect(listening).toBe(true));
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div><input id="field" />';
  for (const fn of Object.values(actions)) fn.mockClear();
  autoSync.refreshNow.mockReset().mockImplementation(() => Promise.resolve());
  useUi.setState({ toasts: [] });
  useSettings.setState({ language: 'en', customDays: 4, tasksPanelOpen: false });
  useUi.setState({ view: 'week', date: new Date(2026, 9, 14), settings: null, searchOpen: false, shortcutsOpen: false, popover: null });
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.getState().closeSettings();
});

describe('useShortcuts', () => {
  it('switches views by letter and by number', async () => {
    await mount();
    press('m');
    expect(useUi.getState().view).toBe('month');
    press('1');
    expect(useUi.getState().view).toBe('day');
    // Caps Lock does not get in the way.
    press('Y');
    expect(useUi.getState().view).toBe('year');
  });

  it('steps by the period on screen, a week being seven days on a phone too, in the direction it went', async () => {
    await mount();
    press('ArrowRight');
    expect(useUi.getState().date).toEqual(new Date(2026, 9, 21));
    expect(useUi.getState().navDir).toBe(1);
    press('j');
    expect(useUi.getState().date).toEqual(new Date(2026, 9, 14));
    expect(useUi.getState().navDir).toBe(-1);
    press('k');
    expect(useUi.getState().date).toEqual(new Date(2026, 9, 21));
  });

  it('opens what the letters name', async () => {
    await mount();
    expect(press('n').defaultPrevented).toBe(true);
    expect(actions.startNewEvent).toHaveBeenCalledTimes(1);
    press('N', { shiftKey: true });
    expect(actions.openNewTask).toHaveBeenCalledTimes(1);
    press('g');
    expect(useSettings.getState().tasksPanelOpen).toBe(true);
    press('?');
    expect(useUi.getState().shortcutsOpen).toBe(true);
  });

  it('refreshes everything with R, saying nothing when that worked', async () => {
    await mount();
    press('r');
    expect(autoSync.refreshNow).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(useUi.getState().toasts).toEqual([]);
  });

  it('says so when the refresh with R failed', async () => {
    autoSync.refreshNow.mockImplementation(() => Promise.reject(new Error('No connection')));
    await mount();
    press('R');
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => [t.message, t.kind])).toEqual([["Couldn't refresh: No connection", 'error']]));
  });

  it('leaves keys alone while typing, with a modifier, or with a dialog open', async () => {
    await mount();
    press('m', {}, document.getElementById('field')!);
    press('m', { ctrlKey: true });
    expect(useUi.getState().view).toBe('week');
    useUi.getState().openSettings('general');
    press('m');
    expect(useUi.getState().view).toBe('week');
  });
});
