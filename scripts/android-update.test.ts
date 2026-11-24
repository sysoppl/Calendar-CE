import { describe, expect, it } from 'vitest';
import { androidUpdateNotice, resolveAndroidUpdate } from './android-update.mjs';

// Declared in src/vite-env.d.ts, which is outside this folder's type-check.
declare const __ANDROID_UPDATE__: { versionUrl: string; downloadUrl: string };

const OFF = { versionUrl: '', downloadUrl: '' };

describe("the Android app's update check, as built", () => {
  it('is off unless the build is told otherwise: nobody to ask', () => {
    expect(resolveAndroidUpdate({})).toEqual(OFF);
    // A build argument left empty is not set.
    expect(resolveAndroidUpdate({ VITE_UPDATE_URL: ' ', VITE_ANDROID_URL: '' })).toEqual(OFF);
    expect(androidUpdateNotice({})).toBeNull();
  });

  it("asks the server's version.json and offers the download when both are set", () => {
    expect(resolveAndroidUpdate({ VITE_UPDATE_URL: 'https://calendar.example.com/', VITE_ANDROID_URL: 'https://calendar.example.com/calendar.apk' })).toEqual({
      versionUrl: 'https://calendar.example.com/version.json',
      downloadUrl: 'https://calendar.example.com/calendar.apk',
    });
    // A server under a path, and a download with a query, written as the browser writes them.
    expect(resolveAndroidUpdate({ VITE_UPDATE_URL: 'https://Example.com/cal', VITE_ANDROID_URL: 'https://files.example.com/a b.apk?v=1' })).toEqual({
      versionUrl: 'https://example.com/cal/version.json',
      downloadUrl: 'https://files.example.com/a%20b.apk?v=1',
    });
    expect(androidUpdateNotice({ VITE_UPDATE_URL: 'https://calendar.example.com', VITE_ANDROID_URL: 'https://calendar.example.com/calendar.apk' })).toBeNull();
  });

  it('stays off with only one of the two, and the build says so', () => {
    expect(resolveAndroidUpdate({ VITE_UPDATE_URL: 'https://calendar.example.com' })).toEqual(OFF);
    expect(resolveAndroidUpdate({ VITE_ANDROID_URL: 'https://calendar.example.com/calendar.apk' })).toEqual(OFF);
    expect(androidUpdateNotice({ VITE_UPDATE_URL: 'https://calendar.example.com' })).toMatch(/VITE_UPDATE_URL is set without VITE_ANDROID_URL/);
    expect(androidUpdateNotice({ VITE_ANDROID_URL: 'https://calendar.example.com/calendar.apk' })).toMatch(/VITE_ANDROID_URL is set without VITE_UPDATE_URL/);
  });

  it.each([
    { VITE_UPDATE_URL: 'http://calendar.example.com' },
    { VITE_UPDATE_URL: 'calendar.example.com' },
    { VITE_UPDATE_URL: 'https://user:pw@calendar.example.com' },
    { VITE_UPDATE_URL: 'https://calendar.example.com/?x=1' },
    { VITE_UPDATE_URL: 'https://calendar.example.com/#top' },
    { VITE_ANDROID_URL: 'http://calendar.example.com/calendar.apk' },
    { VITE_ANDROID_URL: 'javascript:alert(1)' },
    { VITE_ANDROID_URL: 'https://user:pw@calendar.example.com/calendar.apk' },
  ])('stops the build on %o', (env) => {
    expect(() => resolveAndroidUpdate(env)).toThrow(/VITE_(UPDATE|ANDROID)_URL/);
  });

  it('is compiled into the code under test as the environment says (off by default)', () => {
    expect(__ANDROID_UPDATE__).toEqual(resolveAndroidUpdate());
  });
});
