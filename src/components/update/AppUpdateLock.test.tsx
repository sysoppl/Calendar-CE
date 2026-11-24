// @vitest-environment jsdom
// The lock of the whole app while a newer version is known: above every
// screen and dialog, not to be put away, the focus kept inside, one button
// per channel; and what the update check asks of the page before it loads it
// again by itself.
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useData } from '@/store/data';

const update = vi.hoisted(() => ({ updateNow: vi.fn(async () => {}) }));
vi.mock('@/lib/appUpdate', async (original) => ({ ...(await original<typeof import('@/lib/appUpdate')>()), ...update }));

const { useAppUpdate, INITIAL_APP_UPDATE } = await import('@/lib/appUpdate');
const { AppUpdateLock } = await import('./AppUpdateLock');
const { readReloadProbe, watchReloadProbe } = await import('./reloadProbe');
const { Modal, closeTopModal, isModalOpen } = await import('@/components/ui/Modal');

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  useSettings.setState({ language: 'en' });
  useAppUpdate.setState({ ...INITIAL_APP_UPDATE }, true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  update.updateNow.mockReset();
  useUi.setState({ eventEditor: null, settings: null });
});

function draw(element: ReturnType<typeof h>) {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

const lock = () => document.querySelector<HTMLElement>('[data-app-update-lock]');
const action = () => lock()?.querySelector<HTMLElement>('[data-update-action]');
const press = (key: string, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

describe('the app lock', () => {
  it('is not there while this is the newest version', () => {
    draw(h(AppUpdateLock));
    expect(lock()).toBeNull();
    expect(isModalOpen()).toBe(false);
  });

  it('covers the browser app with one way out: loading the new version', () => {
    useAppUpdate.setState({ channel: 'web', locked: true, latest: '1.16.1' });
    draw(h(AppUpdateLock));
    const el = lock()!;
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.parentElement).toBe(document.body);
    expect(el.textContent).toContain('Update Calendar CE');
    expect(el.textContent).toContain('A new version of Calendar CE is out. Load it');
    expect(el.textContent).toContain(`Version in use: ${__APP_VERSION__}`);
    // No close: the update is the only button.
    expect(el.querySelectorAll('button, a')).toHaveLength(1);
    expect(action()!.textContent).toBe('Load the new version');
    act(() => action()!.click());
    expect(update.updateNow).toHaveBeenCalledOnce();
  });

  it('says that it is loading while it does', () => {
    useAppUpdate.setState({ channel: 'web', locked: true, latest: '1.16.1', busy: true });
    draw(h(AppUpdateLock));
    expect(action()!.textContent).toBe('Loading the new version…');
    expect((action() as HTMLButtonElement).disabled).toBe(true);
  });

  it('links the download the Android app was built with', () => {
    useAppUpdate.setState({ channel: 'android', locked: true, latest: '1.16.1' });
    draw(h(AppUpdateLock, { downloadUrl: 'https://calendar.example.com/calendar.apk' }));
    const link = action() as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://calendar.example.com/calendar.apk');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Download the update');
    expect(lock()!.textContent).toContain('Download and install it');
    expect(lock()!.querySelectorAll('button, a')).toHaveLength(1);
    expect(update.updateNow).not.toHaveBeenCalled();
  });

  it('never locks the Android app without a download to offer', () => {
    useAppUpdate.setState({ channel: 'android', locked: true, latest: '1.16.1' });
    draw(h(AppUpdateLock, { downloadUrl: '' }));
    expect(lock()).toBeNull();
    expect(isModalOpen()).toBe(false);
  });

  it('wins over every dialog: they are out of reach, Escape and Back close nothing', () => {
    const onClose = vi.fn();
    useAppUpdate.setState({ channel: 'web', locked: true, latest: '1.16.1' });
    draw(h('div', null, h(Modal, { open: true, onClose, title: 'Editor', children: h('input', { 'aria-label': 'Title' }) }), h(AppUpdateLock)));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.closest('[inert]')).not.toBeNull();
    expect(lock()!.closest('[inert]')).toBeNull();
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true);
    // The focus is on the lock, and Tab keeps it there.
    expect(lock()!.contains(document.activeElement)).toBe(true);
    press('Tab');
    expect(lock()!.contains(document.activeElement)).toBe(true);
    press('Tab', true);
    expect(lock()!.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    // The Android back button and the keyboard shortcuts see a dialog that must be answered.
    expect(closeTopModal()).toBe(false);
    expect(isModalOpen()).toBe(true);
    // What the dialog under it holds stays as it was.
    expect(dialog.querySelector('input')).not.toBeNull();
    // Whatever opens later is out of reach too.
    const late = document.createElement('div');
    act(() => document.body.appendChild(late));
    return Promise.resolve().then(() => {
      expect(late.hasAttribute('inert')).toBe(true);
      act(() => useAppUpdate.setState({ locked: false }));
      expect(lock()).toBeNull();
      // The dialog is the top one again; the page behind it stays out of reach, as for any dialog.
      expect(dialog.closest('[inert]')).toBeNull();
      expect(isModalOpen()).toBe(true);
      expect(closeTopModal()).toBe(true);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

describe('a newer version waiting for what is open', () => {
  it('says so in a notice that covers nothing and takes no tap or focus, also over a dialog', () => {
    useAppUpdate.setState({ channel: 'web', waiting: true, latest: '1.16.1' });
    draw(h('div', null, h(Modal, { open: true, onClose: () => {}, title: 'Editor', children: h('input', { 'aria-label': 'Title' }) }), h(AppUpdateLock)));
    expect(lock()).toBeNull();
    const notice = document.querySelector<HTMLElement>('[data-app-update-waiting]')!;
    expect(notice.parentElement).toBe(document.body);
    expect(notice.querySelector('[role="status"]')!.textContent).toBe('A new version of Calendar CE is ready. The app updates once you save or close what is open.');
    expect(notice.className).toContain('pointer-events-none');
    expect(notice.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    // Read out above the dialog's layer, which leaves the dialog usable.
    expect(notice.closest('[inert]')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.closest('[inert]')).toBeNull();
    expect(isModalOpen()).toBe(true);
    // Locked, the notice gives way to the lock.
    act(() => useAppUpdate.setState({ locked: true, waiting: false }));
    expect(document.querySelector('[data-app-update-waiting]')).toBeNull();
    expect(lock()).not.toBeNull();
  });

  it('is shown for the Android app built with a download, and nowhere there is nothing to update to', () => {
    useAppUpdate.setState({ channel: 'android', waiting: true, latest: '1.16.1' });
    draw(h(AppUpdateLock, { downloadUrl: 'https://calendar.example.com/calendar.apk' }));
    expect(document.querySelector('[data-app-update-waiting]')).not.toBeNull();
    act(() => root!.render(h(AppUpdateLock, { downloadUrl: '' })));
    expect(document.querySelector('[data-app-update-waiting]')).toBeNull();
    act(() => useAppUpdate.setState({ channel: 'none' }));
    act(() => root!.render(h(AppUpdateLock, { downloadUrl: 'https://calendar.example.com/calendar.apk' })));
    expect(document.querySelector('[data-app-update-waiting]')).toBeNull();
  });
});

describe('Escape under the lock', () => {
  it('reaches nothing under it: no menu or picker listening on the document closes', () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    try {
      useAppUpdate.setState({ channel: 'web', locked: true, latest: '1.16.1' });
      draw(h(AppUpdateLock));
      const event = press('Escape');
      expect(event.defaultPrevented).toBe(true);
      expect(heard).not.toHaveBeenCalled();
      // Other keys go their way (Tab is kept inside by the lock itself).
      press('a');
      expect(heard).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('keydown', heard);
    }
  });
});

describe('what the page has open', () => {
  it('lets it load again by itself only when nothing is open or typed', () => {
    draw(h('div', null, h('input', { 'aria-label': 'Search', defaultValue: '' }), h('input', { type: 'checkbox', defaultChecked: true })));
    expect(readReloadProbe()).toEqual({ modalOpen: false, overlayOpen: false, typing: false, filled: false, working: false });
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Search"]')!;
    field.focus();
    expect(readReloadProbe().typing).toBe(true);
    field.value = 'Dentist';
    field.blur();
    expect(readReloadProbe()).toMatchObject({ typing: false, filled: true });
  });

  it('counts the editors, Settings and open dialogs', () => {
    useUi.setState({ settings: 'general' });
    expect(readReloadProbe().overlayOpen).toBe(true);
    useUi.setState({ settings: null });
    expect(readReloadProbe().overlayOpen).toBe(false);
    draw(h(Modal, { open: true, onClose: () => {}, title: 'Prompt', children: 'Sure?' }));
    expect(readReloadProbe().modalOpen).toBe(true);
  });

  it('counts work that must not be cut off: a sync under way', () => {
    useData.setState({ syncing: { acc: true } });
    expect(readReloadProbe().working).toBe(true);
    useData.setState({ syncing: { acc: false } });
    expect(readReloadProbe().working).toBe(false);
  });

  it('is watched without polling: every change of what it reads is told, until the watch stops', async () => {
    const changed = vi.fn();
    const stop = watchReloadProbe(changed);
    const told = async (what: () => void) => {
      changed.mockClear();
      what();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
      expect(changed).toHaveBeenCalled();
    };
    try {
      await told(() => useUi.setState({ settings: 'general' }));
      await told(() => useUi.setState({ settings: null }));
      await told(() => useData.setState({ syncing: { acc: true } }));
      // A dialog opened or closed: a child of <body>.
      await told(() => document.body.appendChild(document.createElement('div')));
      const field = document.createElement('input');
      document.body.appendChild(field);
      await told(() => field.focus());
      await told(() => field.dispatchEvent(new Event('input', { bubbles: true })));
      await told(() => field.blur());
      // A data change that is not a sync says nothing.
      changed.mockClear();
      useData.setState({ revision: useData.getState().revision + 1 });
      expect(changed).not.toHaveBeenCalled();
    } finally {
      stop();
      useData.setState({ syncing: {} });
    }
    changed.mockClear();
    useUi.setState({ settings: 'general' });
    document.body.appendChild(document.createElement('div'));
    document.body.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled();
  });
});
