// The app's own update check ("Newest version only", README): the pieces are
// in this folder, `startAppUpdate` wires them to this copy.
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { fetchVersionAnswer } from './answer';
import { updateChannel, type UpdateChannel } from './channel';
import { createAppUpdate, type AppUpdateController } from './controller';

export { compareVersions, isNewer, parseVersion } from './version';
export { readVersionAnswer, fetchVersionAnswer, type VersionAnswer } from './answer';
export { safeToReload, type ReloadProbe } from './reload';
export { updateChannel, type UpdateChannel } from './channel';
export { useAppUpdate, createAppUpdate, INITIAL_APP_UPDATE, type AppUpdateState } from './controller';

/** The file the build writes into the web bundle (scripts/version-file.mjs). */
export const VERSION_PATH = '/version.json';

/** What the Android app was built with (VITE_UPDATE_URL, VITE_ANDROID_URL; scripts/android-update.mjs). Both empty by default. */
export interface AndroidUpdate {
  versionUrl: string;
  downloadUrl: string;
}

/** This build's Android settings: empty unless both addresses were set when it was built. */
export const ANDROID_UPDATE: Readonly<AndroidUpdate> = Object.freeze({ ...__ANDROID_UPDATE__ });

/** This copy's channel. */
export function thisChannel(android: AndroidUpdate = ANDROID_UPDATE): UpdateChannel {
  return updateChannel({ native: Capacitor.isNativePlatform(), platform: Capacitor.getPlatform(), versionUrl: android.versionUrl, downloadUrl: android.downloadUrl });
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Focus, a visible page again, the connection back; in the apps also the app coming back to the front. */
function listen(wake: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState !== 'hidden') wake();
  };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', onVisible);
  const resume = Capacitor.isNativePlatform() ? CapApp.addListener('resume', wake) : null;
  return () => {
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', onVisible);
    void resume?.then((handle) => handle.remove()).catch(() => {});
  };
}

let running: AppUpdateController | null = null;

/**
 * Starts the update check of this copy; returns what stops it. Only in a
 * production build: the development server and the tests have no version.json.
 * The browser asks its own server; the Android app asks the server it was
 * built for, and nobody at all when it was built without one.
 */
export function startAppUpdate(options: { safeToReload: () => boolean; enabled?: boolean; android?: AndroidUpdate }): () => void {
  if (!(options.enabled ?? import.meta.env.PROD)) return () => {};
  running?.stop();
  const android = options.android ?? ANDROID_UPDATE;
  const channel = thisChannel(android);
  const controller = createAppUpdate({
    channel,
    current: __APP_VERSION__,
    // The Android app's page is at https://localhost: the server answers it with CORS (server/server.mjs).
    versionUrl: channel === 'android' ? android.versionUrl : VERSION_PATH,
    fetchAnswer: (url) => fetchVersionAnswer(url),
    safeToReload: options.safeToReload,
    session: session(),
    reload: () => window.location.reload(),
    shell: {
      caches: typeof caches === 'undefined' ? undefined : caches,
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    },
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    listen,
  });
  running = controller;
  return () => {
    controller.stop();
    if (running === controller) running = null;
  };
}

/** The lock's button. */
export function updateNow(): Promise<void> {
  return running?.update() ?? Promise.resolve();
}
