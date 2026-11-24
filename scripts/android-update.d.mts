export interface AndroidUpdate {
  /** `<VITE_UPDATE_URL>/version.json`; empty unless both variables are set. */
  versionUrl: string;
  /** VITE_ANDROID_URL; empty unless both variables are set. */
  downloadUrl: string;
}

/** What the Android app is built with; throws when a value is malformed. */
export function resolveAndroidUpdate(env?: Record<string, string | undefined>): AndroidUpdate;
/** A line for the build's output when only one of the two variables is set; null otherwise. */
export function androidUpdateNotice(env?: Record<string, string | undefined>): string | null;
