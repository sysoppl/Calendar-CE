// The service worker is a plain script in public/, so it is run here in a
// context of its own with stand-ins for the worker globals.
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildVersion, serviceWorkerVersion, stampServiceWorker } from '../scripts/sw-version.mjs';

const raw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
// As the build writes it.
const VERSION = '1.2.0-0123456789';
const source = stampServiceWorker(raw, VERSION);
const ORIGIN = 'https://calendar.example';
const CACHE = `calendar-shell-${VERSION}`;

const SHELL_V1 = [
  '<!doctype html><html><head>',
  '<link rel="icon" href="/favicon.svg" /><link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/icons/icon-192.webp" /><link rel="preconnect" href="//cdn.example/x.js" />',
  '<script type="module" crossorigin src="/assets/index-1.js"></script>',
  '<link rel="stylesheet" crossorigin href="/assets/index-1.css">',
  '</head><body><a href="/invite">invite</a><div id="root"></div></body></html>',
].join('');
const SHELL_V2 = SHELL_V1.replaceAll('index-1', 'index-2');

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const file = (body: string, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
const redirected = (res: Response) => Object.defineProperty(res, 'redirected', { value: true });

type Key = string | { url: string };
const pathOf = (key: Key) => {
  const url = new URL(typeof key === 'string' ? key : key.url, ORIGIN);
  return url.origin === ORIGIN ? url.pathname + url.search : url.href;
};

class FakeCache {
  entries = new Map<string, Response>();
  async put(key: Key, res: Response) {
    this.entries.set(pathOf(key), res);
  }
  async match(key: Key) {
    return this.entries.get(pathOf(key))?.clone();
  }
  async keys() {
    return [...this.entries.keys()].map((path) => ({ url: new URL(path, ORIGIN).href }));
  }
  async delete(key: Key) {
    return this.entries.delete(pathOf(key));
  }
}

interface FakeEvent {
  request?: { url: string; method: string; mode: string };
  waitUntil(promise: Promise<unknown>): void;
  respondWith(response: Promise<Response>): void;
}

/** Loads the worker against `network`, which answers every fetch by path (or throws when offline). */
function boot(network: (path: string) => Response) {
  const stores = new Map<string, FakeCache>();
  const handlers: Record<string, (event: FakeEvent) => void> = {};
  const fetched: string[] = [];
  const store = (name: string) => stores.get(name) ?? stores.set(name, new FakeCache()).get(name)!;

  runInNewContext(source, {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, handler: (event: FakeEvent) => void) => (handlers[type] = handler),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async (name: string) => store(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    fetch: async (input: Key) => {
      fetched.push(pathOf(input));
      return network(pathOf(input));
    },
    Response,
    URL,
  });

  /** Dispatches an event and waits for everything it started; `response` is undefined when the worker stays out of it. */
  async function dispatch(type: string, request?: FakeEvent['request']) {
    const pending: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    handlers[type]({ request, waitUntil: (promise) => pending.push(promise), respondWith: (response) => (answer = response) });
    const response = await answer;
    // waitUntil may be called again while earlier promises settle.
    for (let i = 0; i < pending.length; i++) await pending[i];
    return response;
  }

  const get = (path: string, mode = 'cors', method = 'GET') => dispatch('fetch', { url: new URL(path, ORIGIN).href, method, mode });
  return {
    cached: () => [...store(CACHE).entries.keys()].sort(),
    cachedText: (path: string) => store(CACHE).entries.get(path)?.clone().text(),
    stores,
    store,
    fetched,
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    get,
    navigate: (path: string) => get(path, 'navigate'),
  };
}

describe('service worker', () => {
  let online: boolean;
  let site: Record<string, () => Response>;
  const network = (path: string) => {
    if (!online) throw new TypeError('Failed to fetch');
    return (site[path] ?? (() => html('Not found', 404)))();
  };

  /** The server moves on to a newer release. */
  const release2 = () => {
    site['/'] = () => html(SHELL_V2);
    site['/assets/index-2.js'] = () => file('console.log(2)', 'text/javascript');
    site['/assets/index-2.css'] = () => file('body{color:red}', 'text/css');
  };

  beforeEach(() => {
    online = true;
    site = {
      '/': () => html(SHELL_V1),
      '/invite?id=1&token=abc': () => html(SHELL_V1),
      '/assets/index-1.js': () => file('console.log(1)', 'text/javascript'),
      '/assets/index-1.css': () => file('body{}', 'text/css'),
      '/favicon.svg': () => file('<svg/>', 'image/svg+xml'),
      '/manifest.webmanifest': () => file('{}', 'application/manifest+json'),
      '/icons/icon-192.webp': () => file('webp', 'image/webp'),
    };
  });

  describe('install', () => {
    it('stores the shell and what the shell refers to', async () => {
      const sw = boot(network);
      await sw.install();
      expect(sw.cached()).toEqual(['/', '/assets/index-1.css', '/assets/index-1.js', '/favicon.svg', '/icons/icon-192.webp', '/manifest.webmanifest']);
      // Links into the app and to other hosts are not files to keep.
      expect(sw.fetched).not.toContain('/invite');
      expect(sw.fetched.some((path) => path.includes('cdn.example'))).toBe(false);
    });

    it('fails rather than keep an error page as the shell', async () => {
      site['/'] = () => html('<h1>Bad gateway</h1>', 502);
      const sw = boot(network);
      await expect(sw.install()).rejects.toThrow();
      expect(sw.cached()).toEqual([]);
    });

    it('gets by without files that are missing or answered with a page', async () => {
      delete site['/assets/index-1.css'];
      site['/assets/index-1.js'] = () => html(SHELL_V1);
      const sw = boot(network);
      await sw.install();
      expect(sw.cached()).toEqual(['/', '/favicon.svg', '/icons/icon-192.webp', '/manifest.webmanifest']);
    });
  });

  it('drops the caches of earlier versions when it takes over', async () => {
    const sw = boot(network);
    sw.store('calendar-shell-v4');
    sw.store('calendar-shell-1.1.0-9876543210');
    await sw.install();
    await sw.activate();
    expect([...sw.stores.keys()]).toEqual([CACHE]);
  });

  describe('version', () => {
    it('is written into the worker by the build, so each build is a new worker with a cache of its own', async () => {
      expect(raw).toContain("'__SW_VERSION__'");
      expect(source).not.toContain('__SW_VERSION__');
      const sw = boot(network);
      await sw.install();
      expect([...sw.stores.keys()]).toEqual([CACHE]);
      expect(stampServiceWorker(raw, '1.2.1-aaaaaaaaaa')).not.toBe(source);
    });

    it('differs between builds of one release that name other files', () => {
      expect(buildVersion('1.2.0', SHELL_V1)).toMatch(/^1\.2\.0-[0-9a-f]{10}$/);
      expect(buildVersion('1.2.0', SHELL_V1)).toBe(buildVersion('1.2.0', SHELL_V1));
      expect(buildVersion('1.2.0', SHELL_V2)).not.toBe(buildVersion('1.2.0', SHELL_V1));
    });

    it('is refused when it would not fit into the code, or the placeholder is not there once', () => {
      expect(() => stampServiceWorker(raw, "1.0.0'; evil()")).toThrow(/version/);
      expect(() => stampServiceWorker('const CACHE = "fixed";', VERSION)).toThrow(/exactly once/);
      expect(() => stampServiceWorker(`${raw}
// __SW_VERSION__`, VERSION)).toThrow(/exactly once/);
    });

    it('is stamped into the finished build by the plugin', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'calendar-sw-'));
      try {
        await writeFile(join(dir, 'sw.js'), raw);
        await writeFile(join(dir, 'index.html'), SHELL_V1);
        const plugin = serviceWorkerVersion('1.2.0') as unknown as { configResolved(c: unknown): void; closeBundle(): Promise<void> };
        plugin.configResolved({ root: dir, build: { outDir: '.' } });
        await plugin.closeBundle();
        expect(await readFile(join(dir, 'sw.js'), 'utf8')).toBe(stampServiceWorker(raw, buildVersion('1.2.0', SHELL_V1)));
        // A worker without the placeholder stops the build instead of shipping a cache that never changes.
        await writeFile(join(dir, 'sw.js'), raw.replace('__SW_VERSION__', 'v4'));
        await expect(plugin.closeBundle()).rejects.toThrow(/exactly once/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('navigations', () => {
    it('come from the network and refresh the shell', async () => {
      const sw = boot(network);
      await sw.install();
      release2();
      const res = await sw.navigate('/');
      expect(await res!.text()).toBe(SHELL_V2);
      expect(await sw.cachedText('/')).toBe(SHELL_V2);
    });

    it("keep a newer release's shell together with its files, and drop the files only the old one named", async () => {
      site['/assets/chunk-7.js'] = () => file('export {}', 'text/javascript');
      const sw = boot(network);
      await sw.install();
      // A chunk the app loaded on demand: no shell names it, and it stays.
      await sw.get('/assets/chunk-7.js');
      release2();
      await sw.navigate('/');
      expect(sw.cached()).toEqual(['/', '/assets/chunk-7.js', '/assets/index-2.css', '/assets/index-2.js', '/favicon.svg', '/icons/icon-192.webp', '/manifest.webmanifest']);
      // A start without a network gets the new release, scripts and all.
      online = false;
      expect(await (await sw.navigate('/'))!.text()).toBe(SHELL_V2);
      expect(await (await sw.get('/assets/index-2.js'))!.text()).toBe('console.log(2)');
    });

    it('keep the shell they have while the files of a newer one cannot be had', async () => {
      const sw = boot(network);
      await sw.install();
      // The new release's script is missing, or answered with a page.
      site['/'] = () => html(SHELL_V2);
      site['/assets/index-2.css'] = () => file('body{}', 'text/css');
      site['/assets/index-2.js'] = () => html(SHELL_V2);
      expect(await (await sw.navigate('/'))!.text()).toBe(SHELL_V2);
      expect(await sw.cachedText('/')).toBe(SHELL_V1);
      expect(sw.cached()).toContain('/assets/index-1.js');
      expect(sw.cached()).not.toContain('/assets/index-2.js');
    });

    it('leave the cache alone when the shell is the one they have', async () => {
      const sw = boot(network);
      await sw.install();
      const before = sw.fetched.length;
      await sw.navigate('/');
      expect(sw.fetched.slice(before)).toEqual(['/']);
      expect(await sw.cachedText('/')).toBe(SHELL_V1);
    });

    it('keep one shell for every app path and no address with a secret in it', async () => {
      const sw = boot(network);
      await sw.install();
      const res = await sw.navigate('/invite?id=1&token=abc');
      expect(res!.status).toBe(200);
      expect(sw.cached().filter((path) => path.includes('invite'))).toEqual([]);
    });

    it.each([
      ['an error page', () => html('<h1>Not found</h1>', 404)],
      ['a redirect to a sign-in portal', () => redirected(html('<form>Wi-Fi login</form>'))],
      ['something that is not a page', () => file('{"error":true}', 'application/json')],
      ['a partial answer', () => html('<!doc', 206)],
    ])('never replace the shell with %s', async (_name, answer) => {
      const sw = boot(network);
      await sw.install();
      site['/'] = answer;
      const res = await sw.navigate('/');
      // The visitor still gets what the server said...
      expect(await res!.text()).toBe(await answer().text());
      // ...but the copy for offline use stays intact.
      expect(await sw.cachedText('/')).toBe(SHELL_V1);
    });

    it('fall back to the shell without a network', async () => {
      const sw = boot(network);
      await sw.install();
      online = false;
      expect(await (await sw.navigate('/'))!.text()).toBe(SHELL_V1);
      expect(await (await sw.navigate('/app/settings'))!.text()).toBe(SHELL_V1);
      // Any other address of the app is the shell too.
      expect(await (await sw.navigate('/app/day/2026-11-04'))!.text()).toBe(SHELL_V1);
    });

    it('fall back to the shell while the server is down', async () => {
      const sw = boot(network);
      await sw.install();
      site['/'] = () => html('<h1>Bad gateway</h1>', 502);
      expect(await (await sw.navigate('/'))!.text()).toBe(SHELL_V1);
      expect(await sw.cachedText('/')).toBe(SHELL_V1);
    });

    it('fail plainly when there is nothing to fall back to', async () => {
      const sw = boot(network);
      online = false;
      expect((await sw.navigate('/'))!.type).toBe('error');
    });

    it('keep as the shell only the page the app mounts in', async () => {
      site['/somewhere'] = () => html('<!doctype html><html><body>A page of something else</body></html>');
      const sw = boot(network);
      await sw.install();
      await sw.navigate('/somewhere');
      expect(await sw.cachedText('/')).toBe(SHELL_V1);
    });

    it('to a file are left to the browser', async () => {
      const sw = boot(network);
      await sw.install();
      online = false;
      expect(await sw.navigate('/THIRD-PARTY-NOTICES.txt')).toBeUndefined();
      expect(await sw.navigate('/assets/index-9.js')).toBeUndefined();
      expect(await sw.navigate('/assets/missing')).toBeUndefined();
    });
  });

  describe('assets', () => {
    it('are fetched once and then served from the cache', async () => {
      site['/assets/chunk-7.js'] = () => file('export {}', 'text/javascript');
      const sw = boot(network);
      expect(await (await sw.get('/assets/chunk-7.js'))!.text()).toBe('export {}');
      online = false;
      expect(await (await sw.get('/assets/chunk-7.js'))!.text()).toBe('export {}');
      expect(sw.fetched).toEqual(['/assets/chunk-7.js']);
    });

    it('are never stored when the answer is a page or an error', async () => {
      site['/assets/gone-1.js'] = () => html(SHELL_V1);
      site['/assets/gone-2.js'] = () => file('Not found', 'text/plain', 404);
      site['/assets/gone-3.js'] = () => redirected(file('export {}', 'text/javascript'));
      const sw = boot(network);
      expect(await (await sw.get('/assets/gone-1.js'))!.text()).toBe(SHELL_V1);
      expect((await sw.get('/assets/gone-2.js'))!.status).toBe(404);
      await sw.get('/assets/gone-3.js');
      expect(sw.cached()).toEqual([]);
    });
  });

  describe('files with fixed names', () => {
    it('come from the cache and are refreshed behind the scenes', async () => {
      const sw = boot(network);
      await sw.install();
      site['/icons/icon-192.webp'] = () => file('new webp', 'image/webp');
      expect(await (await sw.get('/icons/icon-192.webp'))!.text()).toBe('webp');
      expect(await (await sw.get('/icons/icon-192.webp'))!.text()).toBe('new webp');
      online = false;
      expect(await (await sw.get('/icons/icon-192.webp'))!.text()).toBe('new webp');
    });

    it('keep the licence notices of the release that asks for them, and only those', async () => {
      const notices = (version: string) => () => file(`notices ${version}`, 'text/plain; charset=utf-8');
      site['/THIRD-PARTY-NOTICES.txt'] = notices('of an older release');
      site['/THIRD-PARTY-NOTICES.txt?v=1.0.0'] = notices('1.0.0');
      site['/THIRD-PARTY-NOTICES.txt?v=1.1.0'] = notices('1.1.0');
      const sw = boot(network);
      await sw.get('/THIRD-PARTY-NOTICES.txt');
      expect(await (await sw.get('/THIRD-PARTY-NOTICES.txt?v=1.0.0'))!.text()).toBe('notices 1.0.0');
      // An update: its first look at the notices already shows its own list.
      expect(await (await sw.get('/THIRD-PARTY-NOTICES.txt?v=1.1.0'))!.text()).toBe('notices 1.1.0');
      online = false;
      expect(await (await sw.get('/THIRD-PARTY-NOTICES.txt?v=1.1.0'))!.text()).toBe('notices 1.1.0');
      // The copies of other releases are gone rather than left to pile up.
      expect(sw.cached().filter((path) => path.startsWith('/THIRD-PARTY-NOTICES.txt'))).toEqual(['/THIRD-PARTY-NOTICES.txt?v=1.1.0']);
    });

    it('include the licence notices once they have been opened', async () => {
      site['/THIRD-PARTY-NOTICES.txt'] = () => file('notices', 'text/plain; charset=utf-8');
      const sw = boot(network);
      expect(await (await sw.get('/THIRD-PARTY-NOTICES.txt'))!.text()).toBe('notices');
      online = false;
      expect(await (await sw.get('/THIRD-PARTY-NOTICES.txt'))!.text()).toBe('notices');
    });
  });

  it('stays out of everything else', async () => {
    const sw = boot(network);
    expect(await sw.get('/dav-proxy')).toBeUndefined();
    expect(await sw.get('/dav-proxy/', 'cors', 'PROPFIND')).toBeUndefined();
    expect(await sw.get('/assets/index-1.js', 'cors', 'POST')).toBeUndefined();
    expect(await sw.get('/sw.js')).toBeUndefined();
    expect(await sw.get('/api/status')).toBeUndefined();
    expect(await sw.get('https://dav.example.org/calendars/me/')).toBeUndefined();
    expect(await sw.get('https://feeds.example.org/holidays.ics')).toBeUndefined();
    expect(sw.fetched).toEqual([]);
    expect(sw.cached()).toEqual([]);
  });
});
