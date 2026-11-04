// Bridge to the native reminder engine (android/app/src/main/java/pl/patrykpro/calendar/reminders).
import { registerPlugin } from '@capacitor/core';

export interface NativeReminder {
  key: string;
  at: number;
  title: string;
  /**
   * With `start`: the line below the time, the place (or nothing). Without:
   * the whole text, as a test notification has it.
   */
  body: string;
  /**
   * The event's start or the task's due time, in ms. The notification words
   * it when it is shown ("Today at 18:00", reminders/RelativeWhen.java).
   */
  start?: number;
  /** The item takes whole days: `start` names a day, and the notification names the day alone. */
  allDay?: boolean;
  /**
   * Tied to the wall clock rather than an instant (all-day events, date-only
   * task dues, times without a zone, each with a relative trigger): moved
   * with the clock when the device changes time zone.
   */
  floating?: boolean;
}

export interface SyncCalendarConfig {
  key: string;
  name: string;
  url: string;
  username: string;
  password: string;
  visible: boolean;
  components: string[];
}

export interface ReminderStatus {
  permission: 'granted' | 'denied' | 'prompt';
  /** Android: whether this install ever put the system's permission dialog on screen. */
  asked?: boolean;
  systemEnabled: boolean;
  channelEnabled: boolean;
  exactAlarms: boolean;
  ignoringBatteryOptimizations: boolean;
  scheduled: number;
  upcoming: number;
  nextAt?: number;
  nextTitle?: string;
  workerLastRun: number;
  workerLastSuccess: number;
  workerLastError?: string;
  sdk: number;
}

interface RemindersPlugin {
  setReminders(options: { sets: Record<string, NativeReminder[]>; enabled: boolean }): Promise<{ scheduled: number }>;
  setSyncConfig(options: { config: { enabled: boolean; horizonDays: number; calendars: SyncCalendarConfig[] } }): Promise<void>;
  runBackgroundSync(): Promise<void>;
  getStatus(): Promise<ReminderStatus>;
  /**
   * `shown` (Android): whether the system's dialog was on screen. It is false
   * when the permission was turned down for good, and when the app was not in
   * front, where Android shows no dialog.
   */
  requestNotificationPermission(): Promise<{ permission: ReminderStatus['permission']; shown?: boolean }>;
  openNotificationSettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  testNotification(options: { delaySeconds: number; title: string; body: string }): Promise<void>;
  listUpcoming(): Promise<{ reminders: NativeReminder[] }>;
}

export const NativeReminders = registerPlugin<RemindersPlugin>('Reminders');
