// @vitest-environment jsdom
// The Android app as it starts: built without a server (the default), it asks
// nobody at all; built with one, it asks that server and nobody else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({ addListener: vi.fn(async () => ({ remove: async () => {} })) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: shell.addListener } }));

const { ANDROID_UPDATE, startAppUpdate, thisChannel, useAppUpdate, INITIAL_APP_UPDATE } = await import('./index');
const { APP_UPDATE_TIMING } = await import('./controller');

const OFF = { versionUrl: '', downloadUrl: '' };
const SERVER = { versionUrl: 'https://calendar.example.com/version.json', downloadUrl: 'https://calendar.example.com/calendar.apk' };

let stop: (() => void) | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  useAppUpdate.setState({ ...INITIAL_APP_UPDATE }, true);
  fetchSpy = vi.fn(async () => new Response('{"version":"99.0.0"}', { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchSpy);
  shell.addListener.mockClear();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the Android app', () => {
  it('carries what the build was given, nothing by default', () => {
    expect(ANDROID_UPDATE).toEqual(__ANDROID_UPDATE__);
  });

  it('built without a server makes no request at all and never locks', async () => {
    expect(thisChannel(OFF)).toBe('none');
    stop = startAppUpdate({ enabled: true, safeToReload: () => true, android: OFF });
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs * 3);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.gapMs * 2);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Not even a listener for the app coming back to the front.
    expect(shell.addListener).not.toHaveBeenCalled();
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'none', locked: false });
  });

  it('built with a server but no download makes no request either', async () => {
    stop = startAppUpdate({ enabled: true, safeToReload: () => true, android: { ...OFF, versionUrl: SERVER.versionUrl } });
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs * 2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useAppUpdate.getState().locked).toBe(false);
  });

  it('built with both asks that server only, without credentials, and locks for a newer version', async () => {
    stop = startAppUpdate({ enabled: true, safeToReload: () => true, android: SERVER });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SERVER.versionUrl);
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'android', locked: true, latest: '99.0.0' });
  });
});
