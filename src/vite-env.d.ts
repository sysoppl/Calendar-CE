/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Set in server/publicConfig.mjs, compiled in by vite.config.ts and defined
// as globals when the code runs under Vitest.
/** Public address of the web app without a trailing slash, e.g. `http://localhost:8787`. */
declare const __APP_URL__: string;
/**
 * Links set at build time (VITE_PRIVACY_URL, VITE_TERMS_URL, VITE_CONTACT_URL;
 * server/publicConfig.mjs). Empty when not set: such a link is not shown.
 * Read through src/lib/links.ts.
 */
declare const __APP_LINKS__: { privacy: string; terms: string; contact: string };
/**
 * Where the Android app asks for the newest version and downloads it
 * (VITE_UPDATE_URL, VITE_ANDROID_URL; scripts/android-update.mjs). Both empty
 * unless both were set at build time: then the Android app asks nobody.
 * Read through src/lib/appUpdate.
 */
declare const __ANDROID_UPDATE__: { versionUrl: string; downloadUrl: string };
