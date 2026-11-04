// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The first test of the file also loads the modules, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

async function load() {
  vi.resetModules();
  return import('./syncStatus');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 16, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the connection status', () => {
  it('starts from what the browser says', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    expect((await load()).useSyncStatus.getState().online).toBe(false);
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    expect((await load()).useSyncStatus.getState()).toMatchObject({ online: true });
  });

  it('follows the online and offline events once watched, and stops when told', async () => {
    const { useSyncStatus, watchConnectivity } = await load();
    const stop = watchConnectivity();
    // Watching twice is watching once.
    expect(watchConnectivity()).toBe(stop);
    window.dispatchEvent(new Event('offline'));
    expect(useSyncStatus.getState().online).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(useSyncStatus.getState().online).toBe(true);
    stop();
    window.dispatchEvent(new Event('offline'));
    expect(useSyncStatus.getState().online).toBe(true);
  });
});
