// Calendars kept on this device (the local account, docs/DESIGN.md §5a): what
// can delete them, the user's acceptance that they are kept at their own risk,
// and when a backup is due. All of it is the device's own and never leaves it.
import type { MessageKey } from '@/i18n';
import { useApp, type DeviceStorageState, type StorageMode } from '@/store/app';
import { isGeneratedCalendar, LOCAL_ACCOUNT_ID, useData, type Calendar } from '@/store/data';
import { isBackupReminderDays } from '@/store/settings';
import { isAndroid, isNative } from './platform';

const DAY_MS = 86_400_000;

/** How long "Later" on the backup reminder puts it off. */
export const BACKUP_SNOOZE_DAYS = 3;

/** The calendars and task lists of this device that the user writes to: not feeds, not holidays. */
export function ownDeviceCalendars(calendars: readonly Calendar[]): Calendar[] {
  return calendars.filter((c) => c.accountId === LOCAL_ACCOUNT_ID && !isGeneratedCalendar(c));
}

function hasEntries(map: Record<string, unknown> | undefined): boolean {
  for (const _ in map ?? {}) return true;
  return false;
}

/**
 * Whether this device keeps calendars of its own: they were chosen as the
 * place for calendars (the welcome screen, or later), or its own calendars
 * hold something. A device whose calendars live on a server, with the two
 * empty ones an earlier version made, does not.
 */
export function keepsCalendarsOnDevice(mode: StorageMode | null, calendars: readonly Calendar[], objects: Record<string, Record<string, unknown>>): boolean {
  const own = ownDeviceCalendars(calendars);
  if (!own.length) return false;
  return mode === 'local' || own.some((c) => hasEntries(objects[c.id]));
}

/** The events and tasks of this device's own calendars. */
export function deviceItemCount(calendars: readonly Calendar[], objects: Record<string, Record<string, unknown>>): number {
  return ownDeviceCalendars(calendars).reduce((n, c) => n + Object.keys(objects[c.id] ?? {}).length, 0);
}

/** `keepsCalendarsOnDevice` for the interface, as the stores have it now. */
export function useKeepsCalendarsOnDevice(): boolean {
  const mode = useApp((s) => s.storageMode);
  return useData((s) => s.hydrated && keepsCalendarsOnDevice(mode, s.calendars, s.objects));
}

/** Where the app runs, as far as what can delete its data goes. */
export type DevicePlace = 'web' | 'android' | 'app';

export function currentPlace(): DevicePlace {
  return isAndroid ? 'android' : isNative ? 'app' : 'web';
}

/**
 * What deletes the calendars kept on this device for good, in the words of
 * the place the app runs in. A browser keeps a site's data at the browser's
 * pleasure; an app's data goes with the app. Android's own backup does not
 * copy this app's data (`android:allowBackup="false"`), so a new phone starts
 * empty.
 */
export function deletionRisks(place: DevicePlace = currentPlace()): MessageKey[] {
  if (place === 'android') return ['storage.risk.uninstall', 'storage.risk.android.clear', 'storage.risk.android.newPhone', 'storage.risk.device'];
  if (place === 'app') return ['storage.risk.uninstall', 'storage.risk.device'];
  return ['storage.risk.web.clear', 'storage.risk.web.private', 'storage.risk.web.space', 'storage.risk.web.unused', 'storage.risk.web.browser', 'storage.risk.device'];
}

/**
 * Whether the backup reminder is due at `now`: the last backup (without one,
 * the moment this device began to keep calendars) is at least `days` old,
 * and the reminder was not put off past `now`. A stamp in the future (a clock
 * that was set back) counts as now; `noteKeeping` writes it down as now, so
 * that the reminder is not held off until the clock catches up.
 */
export function backupDue(now: number, state: DeviceStorageState, days: number): boolean {
  if (!isBackupReminderDays(days) || days === 0) return false;
  const base = state.lastBackupAt ?? state.keepingSince;
  if (base === undefined) return false;
  // A snooze further ahead than "Later" puts it (with a day to spare for the clock the page last read) came from a clock set back since.
  if (state.backupSnoozedUntil !== undefined && now < state.backupSnoozedUntil && state.backupSnoozedUntil - now <= (BACKUP_SNOOZE_DAYS + 1) * DAY_MS) return false;
  return now - Math.min(base, now) >= days * DAY_MS;
}

/** Whole days since `at`, for "3 days ago"; none before it. */
export function daysSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/** "Later" on the backup reminder. */
export function snoozeBackupReminder(now = Date.now()): void {
  useApp.getState().updateDeviceStorage({ backupSnoozedUntil: now + BACKUP_SNOOZE_DAYS * DAY_MS });
}

/** A backup file was saved: the reminder counts from now. */
export function noteBackupSaved(now = Date.now()): void {
  useApp.getState().updateDeviceStorage({ lastBackupAt: now, backupSnoozedUntil: undefined });
}

/**
 * Notes when this device began to keep calendars, which the first backup
 * reminder counts from (kept from then on), and puts stamps of a clock that
 * ran ahead back to now.
 */
export function noteKeeping(keeps: boolean, now = Date.now()): void {
  const { keepingSince, lastBackupAt, updateDeviceStorage } = useApp.getState();
  const patch: DeviceStorageState = {};
  if (keeps && keepingSince === undefined) patch.keepingSince = now;
  // Stamps from a clock that ran ahead (and was set back since) count from now.
  if (keepingSince !== undefined && keepingSince > now) patch.keepingSince = now;
  if (lastBackupAt !== undefined && lastBackupAt > now) patch.lastBackupAt = now;
  if (Object.keys(patch).length) updateDeviceStorage(patch);
}

/**
 * Asks a browser to keep this site's data when space runs low (the Storage
 * API's persistence), once the user accepted keeping calendars here. Most
 * browsers decide by themselves without asking; some ask the user, which is
 * why this runs only on the user's own click. Never rejects.
 */
export async function askToPersist(): Promise<boolean> {
  if (isNative || typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
