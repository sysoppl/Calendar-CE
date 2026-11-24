// Where this copy of the app learns of a newer version, and how it updates.

/**
 * - 'web': the browser's app, which asks its own server (`/version.json`) and loads itself again;
 * - 'android': the Android app built with both VITE_UPDATE_URL and
 *   VITE_ANDROID_URL, which asks that server's `/version.json` and links the
 *   download of the new APK;
 * - 'none': nothing to ask and no way to update from inside (an Android app
 *   built without those two addresses, which is the default, the iOS shell,
 *   an unknown shell). It never sends a request and never locks.
 */
export type UpdateChannel = 'web' | 'android' | 'none';

export interface ChannelFacts {
  /** Inside the Android or iOS shell. */
  native: boolean;
  /** `Capacitor.getPlatform()`: 'android', 'ios' or 'web'. */
  platform: string;
  /** The server's version.json the Android app asks (`<VITE_UPDATE_URL>/version.json`); empty when unset. */
  versionUrl: string;
  /** Where the new APK is downloaded (VITE_ANDROID_URL); empty when unset. */
  downloadUrl: string;
}

/**
 * The channel of this copy. The Android app asks a server only when it was
 * built with the server's address and with somewhere to download the update
 * from: without the first there is nobody to ask (it never asks anyone else),
 * without the second nothing it could offer to install, so it does not lock.
 */
export function updateChannel(facts: ChannelFacts): UpdateChannel {
  if (!facts.native) return 'web';
  if (facts.platform !== 'android') return 'none';
  return facts.versionUrl && facts.downloadUrl ? 'android' : 'none';
}
