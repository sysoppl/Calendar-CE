// The server's word on the newest version: `version.json` in the web bundle,
// which every running copy of the app asks for (src/lib/appUpdate) and which
// the server sends uncached, to the Android app as well (CORS,
// server/server.mjs).
//
//   {"version":"1.16.0"}
//
// `version` is the bundle's own: what the browser's app updates to, and what
// an Android app built with VITE_UPDATE_URL compares itself with. Public
// facts only.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const VERSION_FILE = 'version.json';

/** What the app accepts (src/lib/appUpdate/version.ts, `parseVersion`): three plain numbers. */
const PLAIN_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** Whether `value` is a version the app would read ("1.16.0"). */
export function isPlainVersion(value) {
  return typeof value === 'string' && PLAIN_VERSION.test(value);
}

/** The release part of package.json's version ("1.17.0" of "1.17.0-rc.1"). */
export function releaseOf(appVersion) {
  const release = /^(\d+\.\d+\.\d+)/.exec(appVersion)?.[1];
  if (!release || !isPlainVersion(release)) throw new Error(`package.json's version cannot go into ${VERSION_FILE}: "${appVersion}"`);
  return release;
}

/** The file's text for a bundle of `appVersion`. */
export function versionFileText(appVersion) {
  return `${JSON.stringify({ version: releaseOf(appVersion) })}\n`;
}

/** Writes version.json into the finished build. */
export function versionFile(appVersion) {
  const text = versionFileText(appVersion);
  let outDir = '';
  return {
    name: 'calendar-version-file',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, VERSION_FILE), text);
    },
  };
}
