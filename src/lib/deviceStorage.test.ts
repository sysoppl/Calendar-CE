import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import type { Calendar } from '@/store/data';
import { backupDue, BACKUP_SNOOZE_DAYS, daysSince, deletionRisks, deviceItemCount, keepsCalendarsOnDevice, ownDeviceCalendars } from './deviceStorage';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12);

const calendar = (id: string, accountId: string, over: Partial<Calendar> = {}): Calendar => ({
  id,
  accountId,
  remoteId: id.slice(accountId.length + 1),
  name: id,
  color: '#d12e2c',
  components: ['VEVENT'],
  readOnly: false,
  visible: true,
  order: 0,
  ...over,
});

const PERSONAL = calendar('local|personal', 'local');
const HOLIDAYS = calendar('local|h', 'local', { readOnly: true, holidayCountry: 'PL' });
const FEED = calendar('local|f', 'local', { readOnly: true, subscriptionUrl: 'https://example.com/f.ics' });
const SERVER = calendar('dav|https://dav.test/c/', 'dav');

describe('calendars kept on this device', () => {
  it('are the device account\'s own, not its feeds and holidays', () => {
    expect(ownDeviceCalendars([PERSONAL, HOLIDAYS, FEED, SERVER])).toEqual([PERSONAL]);
  });

  it('are kept when the device was chosen for them, or when they hold something', () => {
    const empty = {};
    const filled = { [PERSONAL.id]: { 'local://x': {} } };
    expect(keepsCalendarsOnDevice('local', [PERSONAL], empty)).toBe(true);
    // A server's user with the two empty calendars an earlier version made.
    expect(keepsCalendarsOnDevice('caldav', [PERSONAL], empty)).toBe(false);
    expect(keepsCalendarsOnDevice('caldav', [PERSONAL], filled)).toBe(true);
    // Feeds and holidays alone are nothing to lose.
    expect(keepsCalendarsOnDevice('local', [HOLIDAYS, FEED], { [HOLIDAYS.id]: { x: {} } })).toBe(false);
    expect(keepsCalendarsOnDevice(null, [], empty)).toBe(false);
    expect(deviceItemCount([PERSONAL, HOLIDAYS], { [PERSONAL.id]: { a: {}, b: {} }, [HOLIDAYS.id]: { c: {} } })).toBe(2);
  });
});

describe('what deletes them', () => {
  it('is told for the place the app runs in, in texts that exist', () => {
    expect(deletionRisks('android')).toEqual(['storage.risk.uninstall', 'storage.risk.android.clear', 'storage.risk.android.newPhone', 'storage.risk.device']);
    expect(deletionRisks('web')).toContain('storage.risk.web.clear');
    expect(deletionRisks('web')).not.toContain('storage.risk.uninstall');
    expect(deletionRisks('app')).toEqual(['storage.risk.uninstall', 'storage.risk.device']);
    for (const place of ['web', 'android', 'app'] as const) for (const key of deletionRisks(place)) expect(en[key], key).toBeTruthy();
  });
});

describe('the backup reminder', () => {
  it('is due once the last backup is as old as chosen', () => {
    expect(backupDue(NOW, { lastBackupAt: NOW - 29 * DAY }, 30)).toBe(false);
    expect(backupDue(NOW, { lastBackupAt: NOW - 30 * DAY }, 30)).toBe(true);
    expect(backupDue(NOW, { lastBackupAt: NOW - 8 * DAY }, 7)).toBe(true);
  });

  it('counts from when the device began to keep calendars while there is no backup', () => {
    expect(backupDue(NOW, {}, 30)).toBe(false);
    expect(backupDue(NOW, { keepingSince: NOW - 10 * DAY }, 30)).toBe(false);
    expect(backupDue(NOW, { keepingSince: NOW - 31 * DAY }, 30)).toBe(true);
    // A backup since counts instead.
    expect(backupDue(NOW, { keepingSince: NOW - 90 * DAY, lastBackupAt: NOW - DAY }, 30)).toBe(false);
  });

  it('is off at 0 days, and for a value no setting has', () => {
    expect(backupDue(NOW, { lastBackupAt: NOW - 400 * DAY }, 0)).toBe(false);
    expect(backupDue(NOW, { lastBackupAt: NOW - 400 * DAY }, -5)).toBe(false);
    expect(backupDue(NOW, { lastBackupAt: NOW - 400 * DAY }, 2.5)).toBe(false);
  });

  it('waits while put off, but not for a stamp far ahead of the clock', () => {
    const old = { lastBackupAt: NOW - 40 * DAY };
    expect(backupDue(NOW, { ...old, backupSnoozedUntil: NOW + DAY }, 30)).toBe(false);
    expect(backupDue(NOW, { ...old, backupSnoozedUntil: NOW - 1 }, 30)).toBe(true);
    expect(backupDue(NOW, { ...old, backupSnoozedUntil: NOW + (BACKUP_SNOOZE_DAYS + 30) * DAY }, 30)).toBe(true);
    // A backup "made" in the future (a clock set back since) is taken as made now.
    expect(backupDue(NOW, { lastBackupAt: NOW + 100 * DAY }, 30)).toBe(false);
    expect(backupDue(NOW + 30 * DAY, { lastBackupAt: NOW + 100 * DAY }, 30)).toBe(false);
  });

  it('tells whole days', () => {
    expect(daysSince(NOW - 3 * DAY - 5, NOW)).toBe(3);
    expect(daysSince(NOW + DAY, NOW)).toBe(0);
  });
});

describe('noting the device storage', () => {
  it('starts the count once, and puts stamps from the future back to now', async () => {
    const { useApp } = await import('@/store/app');
    const { noteKeeping } = await import('./deviceStorage');
    useApp.setState({ keepingSince: undefined, lastBackupAt: undefined });
    noteKeeping(false, NOW);
    expect(useApp.getState().keepingSince).toBeUndefined();
    noteKeeping(true, NOW);
    noteKeeping(true, NOW + DAY);
    expect(useApp.getState().keepingSince).toBe(NOW);
    useApp.setState({ lastBackupAt: NOW + 100 * DAY });
    noteKeeping(true, NOW + DAY);
    expect(useApp.getState()).toMatchObject({ keepingSince: NOW, lastBackupAt: NOW + DAY });
  });
});
