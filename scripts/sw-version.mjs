// The service worker names its cache after the build it belongs to.
// public/sw.js holds a placeholder that the build replaces, so every build is
// a new worker byte for byte: the browser installs it, the worker fills a
// cache of its own, and when it takes over it drops the caches of the builds
// before. Without this the worker never changed between releases and every
// release's hashed files stayed in the visitor's cache for good.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const SW_VERSION_PLACEHOLDER = '__SW_VERSION__';
/** Goes into a string in the worker's code and into a cache name. */
const SAFE = /^[0-9A-Za-z.+_-]{1,64}$/;

/** `source` with the placeholder replaced by `version`; it must be there exactly once. */
export function stampServiceWorker(source, version) {
  if (!SAFE.test(version)) throw new Error(`Not a usable service worker version: "${version}"`);
  const parts = source.split(SW_VERSION_PLACEHOLDER);
  if (parts.length !== 2) throw new Error(`The service worker must name ${SW_VERSION_PLACEHOLDER} exactly once, found ${parts.length - 1}`);
  return parts.join(version);
}

/**
 * The release, and a digest of the page that names the build's entry files.
 * Those names carry the digests of everything they load, so two builds of
 * one release that differ anywhere in the code get two versions as well.
 */
export function buildVersion(appVersion, indexHtml) {
  return `${appVersion}-${createHash('sha256').update(indexHtml).digest('hex').slice(0, 10)}`;
}

/** Writes the version into the `sw.js` of the finished build; a build whose worker has no placeholder fails. */
export function serviceWorkerVersion(appVersion) {
  let outDir = '';
  return {
    name: 'calendar-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // index.html and the copy of public/ are on disk by then.
    async closeBundle() {
      const worker = join(outDir, 'sw.js');
      const html = await readFile(join(outDir, 'index.html'), 'utf8');
      await writeFile(worker, stampServiceWorker(await readFile(worker, 'utf8'), buildVersion(appVersion, html)));
    },
  };
}
