// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import type { ReminderStatus } from '@/lib/nativeReminders';

const platform = vi.hoisted(() => ({ native: true }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  get isNative() {
    return platform.native;
  },
}));

const native = vi.hoisted(() => ({
  status: {} as Partial<ReminderStatus>,
  answer: { permission: 'prompt', shown: true } as { permission: ReminderStatus['permission']; shown?: boolean },
  requests: 0,
  fail: false,
  askingSeen: [] as boolean[],
  opened: [] as string[],
}));
vi.mock('@/lib/nativeReminders', () => ({
  NativeReminders: {
    getStatus: async () => ({ permission: 'prompt', systemEnabled: false, channelEnabled: true, exactAlarms: true, ...native.status }),
    requestNotificationPermission: async () => {
      native.requests++;
      native.askingSeen.push(useNotificationAccess.getState().asking);
      if (native.fail) throw new Error('no launcher');
      return native.answer;
    },
    openNotificationSettings: async () => void native.opened.push('notifications'),
    openExactAlarmSettings: async () => void native.opened.push('exact'),
  },
}));

const web = vi.hoisted(() => ({ permission: 'prompt' as string }));
vi.mock('@/lib/reminders', () => ({
  notificationPermission: async () => (platform.native ? (native.status.permission ?? 'prompt') : web.permission),
  requestNotificationPermission: async () => web.permission,
}));

const access = await import('./notificationAccess');
const { allowNotifications, askOnFirstRun, checkNotificationAccess, fixNotificationAccess, noticeShown, snoozeNotice, useNotificationAccess, wasAsked, NOTICE_SNOOZE_MS } = access;

beforeEach(() => {
  platform.native = true;
  native.status = {};
  native.answer = { permission: 'prompt', shown: true };
  native.requests = 0;
  native.fail = false;
  native.askingSeen = [];
  native.opened = [];
  web.permission = 'prompt';
  localStorage.clear();
  useSettings.setState({ notificationsEnabled: true });
  useNotificationAccess.setState({ problem: null, snoozedAt: null, asking: false });
});

afterEach(() => localStorage.clear());

describe('the first run on a phone', () => {
  it('asks once, and a "Don\'t allow" is not asked again at the next start', async () => {
    await askOnFirstRun();
    expect(native.requests).toBe(1);
    expect(wasAsked()).toBe(true);
    await askOnFirstRun();
    expect(native.requests).toBe(1);
  });

  it('holds the notice back only while the question is on screen', async () => {
    await askOnFirstRun();
    expect(native.askingSeen).toEqual([true]);
    expect(useNotificationAccess.getState().asking).toBe(false);
  });

  it('lets go of the notice when the request fails', async () => {
    native.fail = true;
    await askOnFirstRun();
    expect(useNotificationAccess.getState().asking).toBe(false);
    expect(wasAsked()).toBe(false);
  });

  it('asks again later when the system never showed its dialog (the app was not in front)', async () => {
    native.answer = { permission: 'prompt', shown: false };
    await askOnFirstRun();
    expect(wasAsked()).toBe(false);
    native.answer = { permission: 'granted', shown: true };
    await askOnFirstRun();
    expect(native.requests).toBe(2);
    expect(wasAsked()).toBe(true);
  });

  it('does not ask while reminders are off, nor where the permission was answered before', async () => {
    useSettings.setState({ notificationsEnabled: false });
    await askOnFirstRun();
    expect(native.requests).toBe(0);
    useSettings.setState({ notificationsEnabled: true });
    native.status = { permission: 'denied' };
    await askOnFirstRun();
    expect(native.requests).toBe(0);
    expect(wasAsked()).toBe(true);
  });

  it('is the phone apps\' alone: a browser asks only after a tap', async () => {
    platform.native = false;
    await askOnFirstRun();
    expect(native.requests).toBe(0);
  });
});

describe('the Allow button', () => {
  it('shows the system\'s dialog when it can', async () => {
    native.answer = { permission: 'granted', shown: true };
    expect(await allowNotifications()).toBe('granted');
    expect(native.opened).toEqual([]);
  });

  it('opens the app\'s notification settings when the system shows no dialog (turned down for good)', async () => {
    native.answer = { permission: 'denied', shown: false };
    expect(await allowNotifications()).toBe('denied');
    expect(native.opened).toEqual(['notifications']);
  });

  it('opens the app\'s notification settings when the request fails', async () => {
    native.fail = true;
    native.status = { permission: 'prompt' };
    expect(await allowNotifications()).toBe('prompt');
    expect(native.opened).toEqual(['notifications']);
  });

  it('respects a "Don\'t allow" in the dialog: no settings screen after it', async () => {
    native.answer = { permission: 'prompt', shown: true };
    await allowNotifications();
    expect(native.opened).toEqual([]);
  });
});

describe('what keeps reminders from arriving', () => {
  it('names the permission first, then the channel, then exact alarms', async () => {
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('ask');
    native.status = { permission: 'denied' };
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('denied');
    native.status = { permission: 'granted', systemEnabled: true, channelEnabled: false };
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('channel');
    native.status = { permission: 'granted', systemEnabled: true, exactAlarms: false };
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('exact');
    native.status = { permission: 'granted', systemEnabled: true };
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBeNull();
  });

  it('is nothing while reminders are off', async () => {
    useSettings.setState({ notificationsEnabled: false });
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBeNull();
  });

  it('is the browser\'s permission on the web', async () => {
    platform.native = false;
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('ask');
    web.permission = 'denied';
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBe('denied');
    web.permission = 'granted';
    await checkNotificationAccess();
    expect(useNotificationAccess.getState().problem).toBeNull();
  });

  it('opens the screen that puts each right', async () => {
    await fixNotificationAccess('channel');
    await fixNotificationAccess('exact');
    await fixNotificationAccess('denied');
    expect(native.opened).toEqual(['notifications', 'exact', 'notifications']);
  });
});

describe('the notice', () => {
  const now = Date.UTC(2026, 9, 27, 12);

  it('waits while the system\'s question is on screen, and tells at once otherwise', () => {
    expect(noticeShown('ask', null, true, now)).toBe(false);
    expect(noticeShown('ask', null, false, now)).toBe(true);
    expect(noticeShown('denied', null, false, now)).toBe(true);
    expect(noticeShown('channel', null, false, now)).toBe(true);
    platform.native = false;
    expect(noticeShown('ask', null, false, now)).toBe(true);
  });

  it('stays away for a week once put away', () => {
    expect(noticeShown('denied', now - NOTICE_SNOOZE_MS + 1, false, now)).toBe(false);
    expect(noticeShown('denied', now - NOTICE_SNOOZE_MS, false, now)).toBe(true);
    // A put-away time ahead of the clock (the clock was changed) does not hide it for good.
    expect(noticeShown('denied', now + 60_000, false, now)).toBe(true);
    expect(noticeShown(null, null, false, now)).toBe(false);
  });

  it('remembers on this device when it was put away', () => {
    snoozeNotice(now);
    expect(useNotificationAccess.getState().snoozedAt).toBe(now);
    expect(localStorage.getItem('calendar.permissionNotice')).toBe(String(now));
  });
});
