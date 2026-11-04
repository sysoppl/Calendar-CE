import type { Plugin } from 'vite';

/** The text in public/sw.js that the build replaces with the version. */
export const SW_VERSION_PLACEHOLDER: string;
/** `source` with the placeholder replaced by `version`; throws when it is not there exactly once or the version is unusable. */
export function stampServiceWorker(source: string, version: string): string;
/** The release and a digest of the built index.html, e.g. `1.0.0-3f2a9c01be`. */
export function buildVersion(appVersion: string, indexHtml: string): string;
/** Stamps the `sw.js` of the finished build with the build's version. */
export function serviceWorkerVersion(appVersion: string): Plugin;
