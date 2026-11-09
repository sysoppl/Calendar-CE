// @vitest-environment jsdom
import { createElement as h } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useApp } from '@/store/app';
import { useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const saved = vi.hoisted(() => ({ outcome: 'downloaded' as 'saved' | 'cancelled' | 'failed' | 'downloaded', files: [] as { name: string; text: string }[] }));
vi.mock('@/lib/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files')>()),
  saveTextFile: async (name: string, text: string) => {
    saved.files.push({ name, text });
    return saved.outcome;
  },
}));

const { DeviceStorageNotices, StorageRiskDialog } = await import('./DeviceStorage');
const { BackupSection } = await import('@/components/settings/BackupSection');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

const DAY = 86_400_000;
const PERSONAL: Calendar = { id: 'local|personal', accountId: 'local', remoteId: 'personal', name: 'Mine', color: '#d12e2c', components: ['VEVENT'], readOnly: false, visible: true, order: 0 };
const item = { url: 'local://local|personal/a.ics', etag: '"1"', calendarId: PERSONAL.id, data: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' };

function keepOnDevice(items = true) {
  useData.setState({ hydrated: true, accounts: [{ id: 'local', kind: 'local', name: 'This device', useProxy: false }], calendars: [PERSONAL], objects: { [PERSONAL.id]: items ? { [item.url]: item } : {} } });
}

beforeEach(() => {
  localStorage.clear();
  saved.outcome = 'downloaded';
  saved.files.length = 0;
  useSettings.setState({ language: 'en', backupReminderDays: 30 });
  useApp.setState({ onboarded: true, storageMode: 'local', riskAcceptedAt: undefined, riskNoticeClosedAt: undefined, lastBackupAt: undefined, keepingSince: undefined, backupSnoozedUntil: undefined });
  useUi.setState({ settings: null, toasts: [] });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
const notice = (kind: string) => document.querySelector(`[data-device-notice="${kind}"]`);
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

describe('the risk of keeping calendars on this device', () => {
  it('is asked once, and accepted for good', () => {
    keepOnDevice();
    act(() => root!.render(h(StorageRiskDialog)));
    expect(document.body.textContent).toContain(en['storage.risk.own']);
    act(() => button(en['storage.risk.accept'])!.click());
    expect(useApp.getState().riskAcceptedAt).toBeTypeOf('number');
    expect(document.body.textContent).not.toContain(en['storage.risk.own']);
  });

  it('is put off for the session by choosing another place, which opens the storage settings', () => {
    keepOnDevice();
    act(() => root!.render(h(StorageRiskDialog)));
    act(() => button(en['storage.risk.other'])!.click());
    expect(useApp.getState().riskAcceptedAt).toBeUndefined();
    expect(useUi.getState().settings).toBe('account');
    expect(document.body.textContent).not.toContain(en['storage.risk.own']);
  });

  it('is not asked where calendars live elsewhere', () => {
    keepOnDevice(false);
    useApp.setState({ storageMode: 'caldav' });
    act(() => root!.render(h(StorageRiskDialog)));
    expect(document.body.textContent).not.toContain(en['storage.risk.title']);
  });
});

describe('the notices above the calendar', () => {
  it('wait for the risk to be accepted, then list what deletes the calendars until closed', () => {
    keepOnDevice();
    act(() => root!.render(h(DeviceStorageNotices)));
    expect(notice('risks')).toBeNull();
    act(() => useApp.setState({ riskAcceptedAt: Date.now() }));
    expect(notice('risks')?.textContent).toContain(en['storage.risk.device']);
    // The count of the first reminder started.
    expect(useApp.getState().keepingSince).toBeTypeOf('number');
    act(() => button(en['storage.notice.close'])!.click());
    expect(notice('risks')).toBeNull();
    expect(useApp.getState().riskNoticeClosedAt).toBeTypeOf('number');
  });

  it('remind of a backup when it is due, and take one', async () => {
    keepOnDevice();
    useApp.setState({ riskAcceptedAt: 1, riskNoticeClosedAt: 1, keepingSince: Date.now() - 31 * DAY });
    act(() => root!.render(h(DeviceStorageNotices)));
    expect(notice('backup')?.textContent).toContain(en['backup.due.never']);
    act(() => button(en['backup.due.action'])!.click());
    await flush();
    expect(saved.files).toHaveLength(1);
    expect(saved.files[0].name).toMatch(/^Calendar CE backup \d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(saved.files[0].text).calendars[0].objects).toHaveLength(1);
    expect(useApp.getState().lastBackupAt).toBeTypeOf('number');
    expect(notice('backup')).toBeNull();
  });

  it('put the reminder off with Later, and say nothing while it is off or there is nothing to back up', () => {
    keepOnDevice();
    useApp.setState({ riskAcceptedAt: 1, riskNoticeClosedAt: 1, lastBackupAt: Date.now() - 40 * DAY });
    act(() => root!.render(h(DeviceStorageNotices)));
    expect(notice('backup')).not.toBeNull();
    act(() => button(en['backup.due.later'])!.click());
    expect(notice('backup')).toBeNull();
    act(() => useApp.setState({ backupSnoozedUntil: undefined }));
    expect(notice('backup')).not.toBeNull();
    act(() => useSettings.setState({ backupReminderDays: 0 }));
    expect(notice('backup')).toBeNull();
    act(() => {
      useSettings.setState({ backupReminderDays: 30 });
      keepOnDevice(false);
    });
    expect(notice('backup')).toBeNull();
  });

  it('do not count a cancelled save as a backup', async () => {
    keepOnDevice();
    saved.outcome = 'cancelled';
    useApp.setState({ riskAcceptedAt: 1, riskNoticeClosedAt: 1, keepingSince: Date.now() - 31 * DAY });
    act(() => root!.render(h(DeviceStorageNotices)));
    act(() => button(en['backup.due.action'])!.click());
    await flush();
    expect(useApp.getState().lastBackupAt).toBeUndefined();
    expect(notice('backup')).not.toBeNull();
  });
});

describe('Settings › Backup', () => {
  it('saves a backup, tells when, and chooses the reminder', async () => {
    keepOnDevice();
    act(() => root!.render(h(BackupSection)));
    expect(document.body.textContent).toContain(en['backup.last.none']);
    expect(document.body.textContent).toContain(en['storage.risk.device']);
    act(() => button(en['backup.make.button'])!.click());
    await flush();
    expect(saved.files).toHaveLength(1);
    expect(document.body.textContent).not.toContain(en['backup.last.none']);

    const select = document.querySelector('select')!;
    expect(select.value).toBe('30');
    act(() => {
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useSettings.getState().backupReminderDays).toBe(0);
    act(() => {
      select.value = 'custom';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const field = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(field).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(field, '45');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      field.focus();
      field.blur();
    });
    expect(useSettings.getState().backupReminderDays).toBe(45);
    act(() => {
      setValue.call(field, '9999');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      field.focus();
      field.blur();
    });
    expect(useSettings.getState().backupReminderDays).toBe(365);
  });
});
