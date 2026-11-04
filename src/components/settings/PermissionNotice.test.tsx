// @vitest-environment jsdom
import { createElement as h } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useSettings } from '@/store/settings';

const platform = vi.hoisted(() => ({ native: true }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  get isNative() {
    return platform.native;
  },
}));
const fixed = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/notificationAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notificationAccess')>()),
  fixNotificationAccess: async (problem: string) => void fixed.push(problem),
}));

const { useNotificationAccess } = await import('@/lib/notificationAccess');
const { PermissionNotice } = await import('./PermissionNotice');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

beforeEach(() => {
  platform.native = true;
  fixed.length = 0;
  localStorage.clear();
  localStorage.setItem('calendar.notificationsAsked', '1');
  useSettings.setState({ language: 'en' });
  useNotificationAccess.setState({ problem: null, snoozedAt: null, asking: false });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const notice = () => document.querySelector('[data-permission-notice]');
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);

describe('PermissionNotice', () => {
  it('shows nothing while reminders can arrive', () => {
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()).toBeNull();
  });

  it('offers to allow notifications, and goes once they are allowed', () => {
    act(() => useNotificationAccess.setState({ problem: 'ask' }));
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()?.textContent).toContain(en['reminders.notice.ask']);
    act(() => button(en['reminders.allow'])!.click());
    expect(fixed).toEqual(['ask']);
    act(() => useNotificationAccess.setState({ problem: null }));
    expect(notice()).toBeNull();
  });

  it('opens the system\'s settings for what only they can put right', () => {
    act(() => useNotificationAccess.setState({ problem: 'exact' }));
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()?.textContent).toContain(en['reminders.notice.exact']);
    act(() => button(en['reminders.openSettings'])!.click());
    expect(fixed).toEqual(['exact']);
  });

  it('is put away for a week', () => {
    act(() => useNotificationAccess.setState({ problem: 'denied' }));
    act(() => root!.render(h(PermissionNotice)));
    act(() => button(en['banner.dismiss'])!.click());
    expect(notice()).toBeNull();
    expect(Number(localStorage.getItem('calendar.permissionNotice'))).toBeGreaterThan(0);
  });

  it('waits while the system\'s own question is on screen', () => {
    act(() => useNotificationAccess.setState({ problem: 'ask', asking: true }));
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()).toBeNull();
    act(() => useNotificationAccess.setState({ asking: false }));
    expect(notice()).not.toBeNull();
  });

  it('tells at once when the permission was turned down, also before the first run asked', () => {
    localStorage.clear();
    act(() => useNotificationAccess.setState({ problem: 'denied' }));
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()).not.toBeNull();
  });

  it('in a browser that blocks notifications says so, with nothing to open', () => {
    platform.native = false;
    act(() => useNotificationAccess.setState({ problem: 'denied' }));
    act(() => root!.render(h(PermissionNotice)));
    expect(notice()?.textContent).toContain(en['reminders.notice.webBlocked']);
    expect(button(en['reminders.openSettings'])).toBeUndefined();
  });
});
