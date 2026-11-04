// Whether reminders can reach the person on this device: asking for the
// notification permission once on the first run (on the first screen of a new
// install, and again when the calendar first shows if that was not possible),
// the "Allow" buttons, and the notice above the calendar while reminders are
// on but cannot arrive (the permission, Android's reminders channel, exact
// alarms).
//
// Android shows its permission dialog only while the app is in front; a request
// made in the background (while another app is in front, say) is never shown
// and leaves the activity waiting on it. The native side
// refuses such a request and says whether a dialog was on screen (`shown`), and
// the first-run request is made again when the app is back in front.
import { create } from 'zustand';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '@/lib/platform';
import { NativeReminders } from '@/lib/nativeReminders';
import { notificationPermission, requestNotificationPermission, type PermissionState } from '@/lib/reminders';
import { useSettings } from '@/store/settings';

/** Set on this device once the first run's request was answered (the Android app). */
const ASKED_KEY = 'calendar.notificationsAsked';
/** When the notice was last put away, in ms, on this device. */
const SNOOZE_KEY = 'calendar.permissionNotice';
/** How long a notice that was put away stays away. Settings › Notifications still shows the problem. */
export const NOTICE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What keeps reminders from arriving: the permission can be asked for, it was
 * turned down, Android's reminders channel is off, exact alarms are not allowed.
 */
export type AccessProblem = 'ask' | 'denied' | 'channel' | 'exact';

interface AccessState {
  /** The problem to show, or null when there is none or reminders are off. */
  problem: AccessProblem | null;
  /** When the notice was put away, in ms; null when it never was. */
  snoozedAt: number | null;
  /** The first run's question is on screen: the notice waits for its answer. */
  asking: boolean;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Asked or shown again then; nothing else depends on it.
  }
}

function storedSnooze(): number | null {
  const at = Number(read(SNOOZE_KEY));
  return Number.isFinite(at) && at > 0 ? at : null;
}

export const useNotificationAccess = create<AccessState>(() => ({ problem: null, snoozedAt: storedSnooze(), asking: false }));

/** Whether the first run's request was answered on this device. */
export function wasAsked(): boolean {
  return read(ASKED_KEY) === '1';
}

/** The problem of this device right now, or null. Never rejects. */
async function currentProblem(): Promise<AccessProblem | null> {
  if (!useSettings.getState().notificationsEnabled) return null;
  if (!isNative) {
    const permission = await notificationPermission();
    return permission === 'prompt' ? 'ask' : permission === 'denied' ? 'denied' : null;
  }
  try {
    const status = await NativeReminders.getStatus();
    if (status.permission !== 'granted' || !status.systemEnabled) return status.permission === 'prompt' ? 'ask' : 'denied';
    if (!status.channelEnabled) return 'channel';
    if (!status.exactAlarms) return 'exact';
    return null;
  } catch {
    return null;
  }
}

/** Looks again at what reminders need (after the app comes back from the system's settings, say). */
export async function checkNotificationAccess(): Promise<void> {
  const problem = await currentProblem();
  if (useNotificationAccess.getState().problem !== problem) useNotificationAccess.setState({ problem });
}

/**
 * Asks for the notification permission. On Android, when the system shows no
 * dialog (the permission was turned down for good) or the request fails,
 * opens the app's notification settings instead, where it can be turned on.
 * For the "Allow" buttons, so that one never does nothing.
 */
export async function allowNotifications(): Promise<PermissionState> {
  let permission: PermissionState;
  if (isNative) {
    let shown: boolean | undefined;
    try {
      ({ permission, shown } = await NativeReminders.requestNotificationPermission());
    } catch {
      permission = await notificationPermission();
      shown = false;
    }
    if (permission !== 'granted' && shown === false) await NativeReminders.openNotificationSettings().catch(() => {});
  } else {
    permission = await requestNotificationPermission();
  }
  if (permission !== 'prompt') write(ASKED_KEY, '1');
  await checkNotificationAccess();
  return permission;
}

/** Opens the system's screen where `problem` is put right, or asks for the permission. */
export async function fixNotificationAccess(problem: AccessProblem): Promise<void> {
  // Turned down for good: only the system's settings can turn it on (a browser has none to open).
  if (problem === 'channel' || (problem === 'denied' && isNative)) await NativeReminders.openNotificationSettings();
  else if (problem === 'exact') await NativeReminders.openExactAlarmSettings();
  else await allowNotifications();
  await checkNotificationAccess();
}

let asking: Promise<void> | null = null;

/**
 * The phone apps ask for the notification permission once: on the first
 * screen of a new install, or the first time the calendar shows if it could
 * not be asked then, with reminders on. A "Don't allow" is respected: it is
 * not asked again (the notice and Settings offer it). A request the system
 * never showed counts as not asked.
 */
export function askOnFirstRun(): Promise<void> {
  if (!isNative) return Promise.resolve();
  asking ??= (async () => {
    if (!useSettings.getState().notificationsEnabled || wasAsked()) return;
    if ((await notificationPermission()) !== 'prompt') {
      write(ASKED_KEY, '1');
      return;
    }
    useNotificationAccess.setState({ asking: true });
    const answer = await NativeReminders.requestNotificationPermission();
    if (answer.shown !== false || answer.permission !== 'prompt') write(ASKED_KEY, '1');
  })()
    .catch(() => {})
    .finally(() => {
      asking = null;
      useNotificationAccess.setState({ asking: false });
    });
  return asking;
}

/**
 * Whether the notice shows: a problem, not put away in the last week, and not
 * while the system's own dialog asks. A permission that was turned down shows
 * at once: reminders will not arrive, and the person is told so.
 */
export function noticeShown(problem: AccessProblem | null, snoozedAt: number | null, asking: boolean, now: number): problem is AccessProblem {
  if (!problem || asking) return false;
  if (snoozedAt !== null && now - snoozedAt < NOTICE_SNOOZE_MS && now >= snoozedAt) return false;
  return true;
}

/** Puts the notice away for a week. */
export function snoozeNotice(now = Date.now()): void {
  write(SNOOZE_KEY, String(now));
  useNotificationAccess.setState({ snoozedAt: now });
}

/**
 * Asks on the first run, then keeps the notice in step: when the app comes
 * back in front (from the system's settings) and when reminders are turned on
 * or off. Returns a function that stops.
 */
export function startNotificationAccess(): () => void {
  let live = true;
  const again = () => {
    if (!live) return;
    void askOnFirstRun().then(checkNotificationAccess);
  };
  again();
  const onVisible = () => document.visibilityState === 'visible' && again();
  document.addEventListener('visibilitychange', onVisible);
  const resume = isNative ? CapApp.addListener('resume', again) : undefined;
  const unsubscribe = useSettings.subscribe((s, prev) => {
    if (s.notificationsEnabled !== prev.notificationsEnabled) void checkNotificationAccess();
  });
  return () => {
    live = false;
    document.removeEventListener('visibilitychange', onVisible);
    void resume?.then((h) => h.remove());
    unsubscribe();
  };
}
