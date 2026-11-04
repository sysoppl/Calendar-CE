// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  get isNative() {
    return platform.native;
  },
}));
vi.mock('@/lib/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reminders')>()),
  notificationPermission: async () => 'granted',
  rescheduleReminders: () => {},
}));

const { NotificationsSection } = await import('./NotificationsSection');
const { ShortcutList } = await import('@/components/ShortcutsDialog');

let root: Root | null = null;

beforeEach(() => {
  platform.native = false;
  useSettings.setState({ language: 'en', notificationsEnabled: true });
  useUi.setState({ toasts: [] });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  root?.unmount();
  root = null;
});

async function render(node: Parameters<Root['render']>[0]) {
  root = createRoot(document.getElementById('root')!);
  root.render(node);
  await vi.waitFor(() => expect(document.getElementById('root')!.textContent).not.toBe(''));
}

describe('Notifications', () => {
  it('says how reminders work in a browser', async () => {
    await render(h(NotificationsSection));
    expect(document.body.textContent).toContain(en['settings.notificationsHintWeb']);
    expect(document.body.textContent).not.toContain(en['settings.notificationsHintAndroid']);
  });

  it('says how they work on Android, without the browser text', async () => {
    platform.native = true;
    await render(h(NotificationsSection));
    expect(document.body.textContent).toContain(en['settings.notificationsHintAndroid']);
    expect(document.body.textContent).not.toContain(en['settings.notificationsHintWeb']);
  });

  it('turns reminders off from the row', async () => {
    await render(h(NotificationsSection));
    document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await vi.waitFor(() => expect(useSettings.getState().notificationsEnabled).toBe(false));
  });
});

describe('The list of shortcuts', () => {
  it('calls R "Refresh", not sync', async () => {
    await render(h(ShortcutList));
    const row = [...document.querySelectorAll('li')].find((li) => li.querySelector('kbd')?.textContent === 'R')!;
    expect(row.textContent).toBe('RefreshR');
    expect(document.body.textContent).not.toMatch(/sync/i);
  });
});
