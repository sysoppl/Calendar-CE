// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every test starts the store from fresh modules; the first start of a run
// also compiles them, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const v1 = (accounts: unknown[]) => JSON.stringify({ state: { accounts, calendars: [] }, version: 1 });
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('first run', () => {
  it('is detected when nothing is stored, and written down at once', async () => {
    const { useApp, isFirstRun } = await import('./app');
    expect(isFirstRun).toBe(true);
    expect(useApp.getState()).toMatchObject({ onboarded: false, storageMode: null });
    // Before anything was set: the next start must not depend on what else gets stored.
    expect(stored('calendar.app')).toEqual({ state: { onboarded: false, storageMode: null }, version: 1 });
  });

  it('is decided before the data store writes its key', async () => {
    // Importing the data store pulls in the app store first, whichever file the app imports first.
    const { useData } = await import('./data');
    await useData.getState().init();
    expect(localStorage.getItem('calendar.data')).not.toBeNull();
    const { useApp, isFirstRun } = await import('./app');
    expect(isFirstRun).toBe(true);
    expect(useApp.getState().onboarded).toBe(false);
  });

  it('is still the first run after a reload on the welcome screen', async () => {
    const first = await import('./data');
    await first.useData.getState().init();
    expect(localStorage.getItem('calendar.data')).not.toBeNull();

    vi.resetModules();
    const { useApp, isFirstRun } = await import('./app');
    // No longer "nothing stored", but the welcome screen was never finished.
    expect(isFirstRun).toBe(false);
    expect(useApp.getState()).toMatchObject({ onboarded: false, storageMode: null });
  });

  it('ends with the choice, which survives a restart', async () => {
    const first = await import('./app');
    first.useApp.getState().setOnboarded('caldav');
    expect(first.useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'caldav' });

    vi.resetModules();
    const second = await import('./app');
    expect(second.isFirstRun).toBe(false);
    expect(second.useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'caldav' });

    second.useApp.getState().setStorageMode('local');
    expect(stored('calendar.app').state).toEqual({ onboarded: true, storageMode: 'local' });
  });
});

describe('an install from before the welcome screen', () => {
  it('counts as set up, on the device when it has no server account', async () => {
    localStorage.setItem('calendar.data', v1([{ id: 'local', kind: 'local', name: 'On this device', useProxy: false }]));
    const { useApp, isFirstRun } = await import('./app');
    expect(isFirstRun).toBe(false);
    expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'local' });
    expect(stored('calendar.app').state).toEqual({ onboarded: true, storageMode: 'local' });
  });

  it('counts as CalDAV when it has such an account', async () => {
    localStorage.setItem(
      'calendar.data',
      v1([
        { id: 'local', kind: 'local', name: 'On this device', useProxy: false },
        { id: 'a1', kind: 'caldav', name: 'Work', useProxy: true },
      ]),
    );
    const { useApp } = await import('./app');
    expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'caldav' });
  });

  it('survives stored data it cannot read', async () => {
    localStorage.setItem('calendar.data', '{not json');
    const { useApp, isFirstRun } = await import('./app');
    expect(isFirstRun).toBe(false);
    expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'local' });
  });
});

describe('without localStorage', () => {
  it('starts as a first run and keeps the choice for the session', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      const { useApp, isFirstRun } = await import('./app');
      expect(isFirstRun).toBe(true);
      useApp.getState().setOnboarded('local');
      expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'local' });
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('what the device knows about keeping calendars on it', () => {
  it('is stored with the choice, only the facts there are', async () => {
    const first = await import('./app');
    first.useApp.getState().setOnboarded('local');
    first.useApp.getState().updateDeviceStorage({ riskAcceptedAt: 10, keepingSince: 5 });
    expect(stored('calendar.app').state).toEqual({ onboarded: true, storageMode: 'local', riskAcceptedAt: 10, keepingSince: 5 });

    vi.resetModules();
    const second = await import('./app');
    expect(second.useApp.getState()).toMatchObject({ riskAcceptedAt: 10, keepingSince: 5 });
    expect(second.useApp.getState().lastBackupAt).toBeUndefined();
    second.useApp.getState().updateDeviceStorage({ lastBackupAt: 20, backupSnoozedUntil: undefined });
    expect(stored('calendar.app').state).toEqual({ onboarded: true, storageMode: 'local', riskAcceptedAt: 10, keepingSince: 5, lastBackupAt: 20 });
  });

  it('drops stamps that are no numbers', async () => {
    localStorage.setItem('calendar.app', JSON.stringify({ state: { onboarded: true, storageMode: 'local', riskAcceptedAt: 'yes', lastBackupAt: 7, riskNoticeClosedAt: null }, version: 1 }));
    const { useApp } = await import('./app');
    expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'local', lastBackupAt: 7 });
    expect(useApp.getState().riskAcceptedAt).toBeUndefined();
    expect(useApp.getState().riskNoticeClosedAt).toBeUndefined();
  });
});
