// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Toasts, toastOffset } from './Toasts';

let root: Root | null = null;
let phone = true;

const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 390, width: 390, x: 0, y: top, toJSON() {} }) as DOMRect;

beforeEach(() => {
  phone = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: phone, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  // jsdom lays nothing out: a dialog header across the top of the screen, toasts 66 px tall.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-dialog-header')) return rect(0, 64);
    if (this.hasAttribute('data-toast')) return rect(16, 82);
    return rect(0, 0);
  });
  useSettings.setState({ language: 'en' });
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ toasts: [] });
  vi.restoreAllMocks();
});

async function show() {
  useUi.setState({ toasts: [{ id: 1, message: 'Could not save', kind: 'error' }] });
  root = createRoot(document.getElementById('app')!.appendChild(document.createElement('div')));
  root.render(h(Toasts));
  await vi.waitFor(() => expect(document.querySelector('[data-toast]')).not.toBeNull());
  return document.querySelector<HTMLElement>('[data-toast]')!.parentElement!;
}

function dialogHeader({ inert = false } = {}) {
  const dialog = document.body.appendChild(document.createElement('div'));
  if (inert) dialog.setAttribute('inert', '');
  const header = dialog.appendChild(document.createElement('div'));
  header.setAttribute('data-dialog-header', '');
  return dialog;
}

describe('toastOffset', () => {
  it('moves the toasts below a header they would cover', () => {
    // A full-screen sheet: its header is at the top.
    expect(toastOffset({ top: 0, bottom: 64 }, 16, 66)).toBe(56);
    // A tall dialog a little below the top.
    expect(toastOffset({ top: 60, bottom: 120 }, 16, 50)).toBe(112);
  });

  it('leaves them at the top when the header is clear of them', () => {
    // A short dialog in the middle of the screen.
    expect(toastOffset({ top: 300, bottom: 360 }, 16, 66)).toBe(0);
  });
});

describe('Toasts', () => {
  it('stay off the header of an open dialog on a phone', async () => {
    dialogHeader();
    const box = await show();
    await vi.waitFor(() => expect(box.style.top).toBe('72px'));
  });

  it('follow a dialog that opens while they are on screen', async () => {
    const box = await show();
    expect(box.style.top).toBe('');
    dialogHeader();
    await vi.waitFor(() => expect(box.style.top).toBe('72px'));
  });

  it('ignore the header of a dialog under the one on top', async () => {
    dialogHeader({ inert: true });
    const box = await show();
    await new Promise((r) => setTimeout(r, 50));
    expect(box.style.top).toBe('');
  });

  it('stay where they are on wider screens, at the bottom', async () => {
    phone = false;
    dialogHeader();
    const box = await show();
    await new Promise((r) => setTimeout(r, 50));
    expect(box.style.top).toBe('');
  });
});

describe('What screen readers hear', () => {
  const polite = () => document.querySelector<HTMLElement>('[data-live="polite"]')!;
  const assertive = () => document.querySelector<HTMLElement>('[data-live="assertive"]')!;

  async function mount() {
    root = createRoot(document.getElementById('app')!.appendChild(document.createElement('div')));
    root.render(h(Toasts));
    await vi.waitFor(() => expect(polite()).not.toBeNull());
  }

  it('has both regions there before any toast, empty', async () => {
    await mount();
    expect(polite().getAttribute('aria-live')).toBe('polite');
    expect(polite().getAttribute('aria-atomic')).toBe('true');
    expect(assertive().getAttribute('role')).toBe('alert');
    expect(polite().textContent).toBe('');
    expect(assertive().textContent).toBe('');
  });

  it('says errors in the assertive region and the rest in the polite one', async () => {
    await mount();
    useUi.getState().toast('Saved', 'success');
    await vi.waitFor(() => expect(polite().textContent).toBe('Saved'));
    expect(assertive().textContent).toBe('');
    useUi.getState().toast("Couldn't sync", 'error');
    await vi.waitFor(() => expect(assertive().textContent).toBe("Couldn't sync"));
    expect(polite().textContent).toBe('Saved');
  });

  it('says the same message again: the region is emptied first', async () => {
    await mount();
    useUi.getState().toast('Saved', 'success');
    await vi.waitFor(() => expect(polite().textContent).toBe('Saved'));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(polite().textContent ?? ''));
    observer.observe(polite(), { childList: true, characterData: true, subtree: true });
    useUi.getState().toast('Saved', 'success');
    await vi.waitFor(() => expect(seen).toEqual(['', 'Saved']));
    observer.disconnect();
  });

  it('says the newest of messages that come together in each region', async () => {
    await mount();
    useUi.getState().toast('Saved', 'success');
    useUi.getState().toast('Calendar added', 'success');
    useUi.getState().toast("Couldn't sync", 'error');
    await vi.waitFor(() => expect(assertive().textContent).toBe("Couldn't sync"));
    await vi.waitFor(() => expect(polite().textContent).toBe('Calendar added'));
    await new Promise((r) => setTimeout(r, 150));
    expect(polite().textContent).toBe('Calendar added');
  });

  it('says a message whose toast was closed at once', async () => {
    await mount();
    useUi.getState().toast('Account removed', 'success');
    await vi.waitFor(() => expect(document.querySelector('[data-toast]')).not.toBeNull());
    useUi.setState({ toasts: [] });
    await vi.waitFor(() => expect(polite().textContent).toBe('Account removed'));
  });

  it('leaves the toasts themselves unannounced, so nothing is said twice, and never takes the focus', async () => {
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();
    await mount();
    useUi.getState().toast("Couldn't sync", 'error', { label: 'Try again', run: () => {} });
    await vi.waitFor(() => expect(document.querySelector('[data-toast]')).not.toBeNull());
    const toast = document.querySelector('[data-toast]')!;
    expect(toast.getAttribute('role')).toBeNull();
    expect(toast.querySelector('[role], [aria-live]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
