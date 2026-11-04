// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { SettingsPage } from './SettingsPage';

let root: Root | null = null;
let opener: HTMLButtonElement;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
});

beforeEach(async () => {
  useSettings.setState({ language: 'en' });
  // The header as the shell draws it: its settings button is where the focus may return.
  document.body.innerHTML = '<div id="shell"><header><button id="today">Today</button><button id="settings" data-settings-return>Settings</button></header><button id="opener">Open</button></div>';
  opener = document.getElementById('opener') as HTMLButtonElement;
  root = createRoot(document.getElementById('shell')!.appendChild(document.createElement('div')));
  root.render(h(SettingsPage));
});

afterEach(() => {
  useUi.getState().closeSettings();
  root?.unmount();
  root = null;
});

const dialog = () => document.querySelector('[role="dialog"]');

async function openFrom(el: HTMLElement) {
  el.focus();
  useUi.getState().openSettings('tasks');
  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  // Settings takes the focus.
  await vi.waitFor(() => expect(dialog()!.contains(document.activeElement)).toBe(true));
}

async function close() {
  useUi.getState().closeSettings();
  await vi.waitFor(() => expect(dialog()).toBeNull());
}

describe('Closing Settings', () => {
  it('gives the focus back to what opened it', async () => {
    await openFrom(opener);
    await close();
    expect(document.activeElement).toBe(opener);
  });

  it('puts the focus on the header when what opened it is gone', async () => {
    await openFrom(opener);
    // A drawer or a menu that closed when Settings opened.
    opener.remove();
    await close();
    expect(document.activeElement?.id).toBe('settings');
  });

  it('puts the focus on the header when it was opened with nothing focused', async () => {
    await openFrom(document.body);
    await close();
    expect(document.activeElement?.id).toBe('settings');
  });

  it('puts the focus on the header when the opener cannot take it any more', async () => {
    await openFrom(opener);
    opener.disabled = true;
    await close();
    expect(document.activeElement?.id).toBe('settings');
  });
});
