// Calendar CE service worker: keeps the app shell available offline.
// Calendar data itself lives in IndexedDB; DAV requests are never cached, and
// neither is anything from another origin.
//
// The build writes its version over the placeholder (scripts/sw-version.mjs),
// so every release is a new worker: it fills a cache of its own when it is
// installed and drops the caches of the releases before when it takes over.
const VERSION = '__SW_VERSION__';
const CACHE = `calendar-shell-${VERSION}`;
const SHELL = '/';
// Files with fixed names: served from the cache and refreshed in the background.
const STATIC = /^\/(icons\/.+|favicon\.svg|manifest(\.[a-z-]+)?\.webmanifest|THIRD-PARTY-NOTICES\.txt)$/;
// The app asks for the licence notices with its version in the query.
const NOTICES = '/THIRD-PARTY-NOTICES.txt';

const isHtml = (res) => (res.headers.get('content-type') ?? '').includes('text/html');
// Error pages, redirects (a login portal on public Wi-Fi) and partial answers
// are not what the URL stands for and must not end up in the cache.
const complete = (res) => res.status === 200 && !res.redirected;
// A server that answers a missing file with the app shell would otherwise
// leave HTML in the cache under the name of a script, for good.
const isAsset = (res) => complete(res) && !isHtml(res);
// Only the app's own page is ever kept as the shell: it has the element the app mounts in.
const isShell = (html) => html.includes('<div id="root">');

/** Fetches `request` and files a copy; the answer is not held back until the copy is written. */
async function fetchAndStore(event, cache, request) {
  const res = await fetch(request);
  if (isAsset(res)) event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return res;
}

/** The files of its own a shell names that the worker keeps: the build's assets and the files with fixed names. */
function shellFiles(html) {
  const referenced = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  return [...new Set(referenced.filter((path) => path.startsWith('/assets/') || STATIC.test(path)))];
}

const isBuildFile = (path) => path.startsWith('/assets/');

async function install(event) {
  const cache = await caches.open(CACHE);
  const res = await fetch(SHELL, { cache: 'no-cache' });
  if (!complete(res) || !isHtml(res)) throw new Error('The app shell is not available');
  const html = await res.clone().text();
  await cache.put(SHELL, res);
  // The page that registers this worker has loaded its scripts and styles
  // already, so they would be missing on the first visit without a network.
  await Promise.all(shellFiles(html).map((path) => fetchAndStore(event, cache, path).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(install(event));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Navigations: network first, fall back to the cached shell.
async function navigate(event) {
  const cache = await caches.open(CACHE);
  let res;
  try {
    res = await fetch(event.request);
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
  if (complete(res) && isHtml(res)) event.waitUntil(refreshShell(cache, res.clone()).catch(() => {}));
  // A server that is down behind its reverse proxy answers 502; the app works
  // without it, so the shell is the better answer.
  if (res.status >= 500) return (await cache.match(SHELL)) ?? res;
  return res;
}

/** Fetches `path` into the cache and waits for the copy: true once it is there. */
async function store(cache, path) {
  if (await cache.match(path)) return true;
  try {
    const res = await fetch(path);
    if (!isAsset(res)) return false;
    await cache.put(path, res);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a shell from the network for starts without one. A shell that names
 * other build files than the one kept (a release that came out while this
 * worker runs; its own worker is on its way) replaces it only once all of
 * them are in the cache, so a start without a network never gets a page
 * whose scripts are missing. The build files that only the shell before it
 * named go then: nothing else will ask for them.
 */
async function refreshShell(cache, res) {
  const html = await res.clone().text();
  if (!isShell(html)) return;
  const kept = await cache.match(SHELL);
  const before = kept ? await kept.text() : '';
  if (html === before) return;
  const files = shellFiles(html);
  const stored = await Promise.all(files.map((path) => store(cache, path)));
  if (files.some((path, i) => isBuildFile(path) && !stored[i])) return;
  await cache.put(SHELL, res);
  const named = new Set(files);
  await Promise.all(shellFiles(before).filter((path) => isBuildFile(path) && !named.has(path)).map((path) => cache.delete(path)));
}

// Hashed build assets are immutable: cache first.
async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  return (await cache.match(event.request)) ?? fetchAndStore(event, cache, event.request);
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const fresh = fetchAndStore(event, cache, event.request);
  if (!hit) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return hit;
}

// A copy of the notices answers only for the release it was fetched for, so
// an update never shows the list of the version before. The copies of other
// releases go when a new one is filed.
async function versionedNotices(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (isAsset(res)) {
    const copy = res.clone();
    const replace = async () => {
      for (const key of await cache.keys()) if (new URL(key.url).pathname === NOTICES) await cache.delete(key);
      await cache.put(event.request, copy);
    };
    event.waitUntil(replace().catch(() => {}));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/dav-proxy')) return;

  const isFile = url.pathname.startsWith('/assets/') || /\.[^/]*$/.test(url.pathname);
  if (req.mode === 'navigate') {
    // Like the server: the shell stands in for app paths, never for a file.
    if (!isFile) event.respondWith(navigate(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event));
  } else if (url.pathname === NOTICES && url.search) {
    event.respondWith(versionedNotices(event));
  } else if (STATIC.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
