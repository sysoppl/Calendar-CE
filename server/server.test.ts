import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appUrl, resolveLinks, resolvePublicConfig } from './publicConfig.mjs';
import { contentSecurityPolicy, hstsFromEnv, PERMISSIONS_POLICY, securityHeaders } from './securityHeaders.mjs';
import { LINKS_META, STOP_GRACE, createAppServer, createRequestHandler, handleRequest, linksInjector, stopGracefully } from './server.mjs';

// Declared in src/vite-env.d.ts, which is outside this folder's type-check.
declare const __APP_VERSION__: string;
declare const __APP_URL__: string;
declare const __APP_LINKS__: Record<string, string>;

const SHELL = '<!doctype html><html><head><title>Calendar</title></head><body><div id="root"></div></body></html>';

describe('public configuration', () => {
  it('serves localhost by default', () => {
    expect(resolvePublicConfig({})).toEqual({ appUrl: 'http://localhost:8787' });
    // A build argument that was left empty is not an override.
    expect(resolvePublicConfig({ VITE_APP_URL: ' ' }).appUrl).toBe('http://localhost:8787');
  });

  it('takes overrides from the environment', () => {
    expect(resolvePublicConfig({ VITE_APP_URL: 'https://calendar.example.com/' })).toEqual({ appUrl: 'https://calendar.example.com' });
  });

  it.each([{ VITE_APP_URL: 'calendar.example.com' }, { VITE_APP_URL: 'ftp://calendar.example.com' }, { VITE_APP_URL: 'https://user:pw@calendar.example.com' }, { VITE_APP_URL: 'https://calendar.example.com/?x=1' }])(
    'refuses %o',
    (env) => {
      expect(() => resolvePublicConfig(env)).toThrow(/VITE_/);
    },
  );

  it('names no legal page until the build is told one', () => {
    expect(resolveLinks({})).toEqual({ privacy: '', terms: '', contact: '' });
    expect(resolveLinks({ VITE_PRIVACY_URL: ' ', VITE_TERMS_URL: '' }).privacy).toBe('');
  });

  it('takes the links the app shows from the environment', () => {
    expect(
      resolveLinks({
        VITE_PRIVACY_URL: 'https://example.org/privacy',
        VITE_TERMS_URL: 'https://example.org/terms?lang=en#top',
        VITE_CONTACT_URL: 'mailto:hello@example.org',
      }),
    ).toEqual({
      privacy: 'https://example.org/privacy',
      terms: 'https://example.org/terms?lang=en#top',
      contact: 'mailto:hello@example.org',
    });
    // Written as a browser writes it, so it cannot leave the attribute it goes into.
    expect(resolveLinks({ VITE_TERMS_URL: 'https://example.org/a"b<c' }).terms).toBe('https://example.org/a%22b%3Cc');
  });

  it.each([
    { VITE_PRIVACY_URL: 'example.org/privacy' },
    { VITE_TERMS_URL: 'javascript:alert(1)' },
    { VITE_TERMS_URL: 'https://user:pw@example.org/terms' },
    { VITE_PRIVACY_URL: 'mailto:hello@example.org' },
    { VITE_CONTACT_URL: 'mailto:nobody' },
    { VITE_CONTACT_URL: 'data:text/html,hi' },
  ])('refuses the link %o', (env) => {
    expect(() => resolveLinks(env)).toThrow(/VITE_/);
  });

  it('is compiled into the code under test as well', () => {
    expect(__APP_URL__).toBe(appUrl);
    expect(__APP_LINKS__).toEqual(resolveLinks());
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('security headers', () => {
  it('allow only same-origin scripts and nothing inline', () => {
    const policy = contentSecurityPolicy();
    expect(policy.split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https: http:",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });

  it('leave out of the <meta> policy what browsers reject there', () => {
    const meta = contentSecurityPolicy({ meta: true });
    expect(meta).not.toContain('frame-ancestors');
    expect(`${meta}; frame-ancestors 'none'`).toBe(contentSecurityPolicy());
    // Goes into an attribute as it is.
    expect(meta).not.toMatch(/["<>&]/);
  });

  it('carry HSTS unless it is switched off', () => {
    expect(securityHeaders({ hsts: hstsFromEnv({}) })['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(hstsFromEnv({ CALENDAR_HSTS: 'max-age=300' })).toBe('max-age=300');
    expect(hstsFromEnv({ CALENDAR_HSTS: 'off' })).toBeNull();
    expect(() => hstsFromEnv({ CALENDAR_HSTS: 'max-age=1\r\nx: y' })).toThrow();
    expect(securityHeaders({ hsts: false })).not.toHaveProperty('strict-transport-security');
  });
});

describe('server', () => {
  let dir: string;
  let server: Server;
  let port: number;

  interface Reply {
    status: number;
    headers: IncomingHttpHeaders;
    body: string;
  }

  /** `path` goes on the wire as it is: no client-side normalisation. */
  function get(path: string, options: { method?: string; headers?: Record<string, string>; port?: number } = {}) {
    return new Promise<Reply>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: options.port ?? port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  const listen = (s: Server) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'calendar-server-'));
    const root = join(dir, 'dist');
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'icons'));
    await mkdir(join(root, '.well-known'));
    await writeFile(join(dir, 'secret.txt'), 'outside the web root');
    await writeFile(join(root, 'index.html'), SHELL);
    await writeFile(join(root, 'sw.js'), 'self.skipWaiting();');
    await writeFile(join(root, 'manifest.webmanifest'), '{}');
    await writeFile(join(root, 'THIRD-PARTY-NOTICES.txt'), 'notices');
    await writeFile(join(root, '.env'), 'SECRET=1');
    await writeFile(join(root, '.well-known', 'security.txt'), 'Contact: mailto:security@example.com');
    await writeFile(join(root, 'icons', 'icon-192.webp'), 'webp');
    await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1);');
    server = createAppServer({ root, headers: securityHeaders({ hsts: hstsFromEnv({}) }) });
    port = await listen(server);
  });

  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('can be imported without starting to listen', () => {
    expect(typeof handleRequest).toBe('function');
    expect(typeof createRequestHandler()).toBe('function');
    expect(createAppServer().listening).toBe(false);
  });

  describe('headers', () => {
    it('locks every static response down', async () => {
      for (const path of ['/', '/assets/index-abc123.js', '/missing.txt', '/..%2fsecret.txt']) {
        const { headers } = await get(path);
        expect(headers['content-security-policy'], path).toBe(contentSecurityPolicy());
        expect(headers['strict-transport-security'], path).toBe('max-age=63072000; includeSubDomains');
        expect(headers['x-content-type-options'], path).toBe('nosniff');
        expect(headers['x-frame-options'], path).toBe('DENY');
        expect(headers['referrer-policy'], path).toBe('no-referrer');
        expect(headers['cross-origin-opener-policy'], path).toBe('same-origin');
        expect(headers['cross-origin-resource-policy'], path).toBe('same-origin');
        expect(headers['permissions-policy'], path).toBe(PERMISSIONS_POLICY);
      }
    });

    it('switches off the powerful features the app does not use, and only those', () => {
      const features = PERMISSIONS_POLICY.split(', ');
      for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture', 'bluetooth', 'serial', 'hid', 'midi', 'publickey-credentials-get']) {
        expect(features).toContain(`${feature}=()`);
      }
      // Copying to the clipboard and fullscreen must keep working.
      expect(PERMISSIONS_POLICY).not.toMatch(/clipboard|fullscreen|web-share/);
      expect(features.every((f) => /^[a-z-]+=\(\)$/.test(f))).toBe(true);
    });

    it('sends the types browsers insist on', async () => {
      expect((await get('/')).headers['content-type']).toBe('text/html; charset=utf-8');
      expect((await get('/assets/index-abc123.js')).headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect((await get('/manifest.webmanifest')).headers['content-type']).toBe('application/manifest+json');
      expect((await get('/THIRD-PARTY-NOTICES.txt')).headers['content-type']).toBe('text/plain; charset=utf-8');
      expect((await get('/icons/icon-192.webp')).headers['content-type']).toBe('image/webp');
    });

    it('caches hashed assets for good and revalidates the rest', async () => {
      expect((await get('/assets/index-abc123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
      for (const path of ['/', '/sw.js', '/manifest.webmanifest', '/app/settings']) {
        expect((await get(path)).headers['cache-control'], path).toBe('no-cache');
      }
      expect((await get('/assets/gone-000000.js')).headers['cache-control']).toBe('no-store');
    });

    it('answers 304 to a matching validator', async () => {
      const first = await get('/sw.js');
      const etag = first.headers.etag as string;
      expect(etag).toMatch(/^"[\w-]{22}"$/);
      expect(first.headers['content-length']).toBe(String(first.body.length));

      const same = await get('/sw.js', { headers: { 'if-none-match': etag } });
      expect(same.status).toBe(304);
      expect(same.body).toBe('');
      expect(same.headers.etag).toBe(etag);
      expect(same.headers['cache-control']).toBe('no-cache');
      expect((await get('/sw.js', { headers: { 'if-none-match': `"other", W/${etag}` } })).status).toBe(304);
      expect((await get('/sw.js', { headers: { 'if-none-match': '"other"' } })).status).toBe(200);
      // The validator follows the content, not the file's size or age.
      expect((await get('/manifest.webmanifest')).headers.etag).not.toBe(etag);
    });

    it('answers HEAD with headers only and refuses other methods', async () => {
      const head = await get('/sw.js', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers['content-length']).toBe(String('self.skipWaiting();'.length));
      expect(head.body).toBe('');

      const post = await get('/', { method: 'POST' });
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET, HEAD');
      expect(post.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('app shell fallback', () => {
    it.each(['/', '/app/settings', '/welcome/', '/icons', '/icons/', '/dev', '/developer'])('serves the app for %s', async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.body).toBe(SHELL);
    });

    it.each([
      '/assets/index-old999.js',
      '/assets/missing',
      '/assets',
      '/assets/',
      '/ASSETS/missing',
      '/robots.txt',
      '/favicon.ico',
      '/icons/icon-512.webp',
      '/app/main.js.map',
      '/verify.php?x=1',
    ])('answers 404 for the missing file %s', async (path) => {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.body).toBe('Not found');
    });

    it('keeps hidden files to itself, even ones that exist', async () => {
      // A backslash separates path segments on Windows, so it must not hide a dot from the check.
      for (const path of ['/.env', '/.git/config', '/app/.htpasswd', '/.hidden/page', '/%5c.env', '/%5C.git%5Cconfig', '/assets%5c..%5c.env']) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        expect(res.body, path).toBe('Not found');
      }
      expect((await get('/.well-known/security.txt')).body).toBe('Contact: mailto:security@example.com');
    });

    it('writes the links it was started with into the pages, and nothing else', async () => {
      const links = { privacy: 'https://example.org/privacy?a=1&b="2"', terms: '', contact: 'mailto:hello@example.org' };
      const withLinks = createAppServer({ root: join(dir, 'dist'), links });
      try {
        const other = await listen(withLinks);
        const tag = `<meta name="${LINKS_META}" content="{&quot;privacy&quot;:&quot;https://example.org/privacy?a=1&amp;b=\\&quot;2\\&quot;&quot;,&quot;contact&quot;:&quot;mailto:hello@example.org&quot;}">`;
        for (const path of ['/', '/app/settings']) {
          const res = await get(path, { port: other });
          expect(res.body, path).toBe(SHELL.replace('</head>', `${tag}</head>`));
          expect(res.headers['content-length'], path).toBe(String(Buffer.byteLength(res.body)));
        }
        // What the attribute holds is the JSON the app parses.
        const content = /content="([^"]*)"/.exec(tag)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        expect(JSON.parse(content)).toEqual({ privacy: links.privacy, contact: links.contact });
        expect((await get('/sw.js', { port: other })).body).toBe('self.skipWaiting();');
        expect((await get('/', { port: other })).headers.etag).not.toBe((await get('/')).headers.etag);
      } finally {
        withLinks.close();
      }
      // Started without any, it serves the pages as they were built.
      expect((await get('/')).body).toBe(SHELL);
      expect(linksInjector({ privacy: '', terms: '', contact: '' })).toBeNull();
      expect(linksInjector(undefined)).toBeNull();
      expect(linksInjector({ terms: 'https://example.org/terms' })!(Buffer.from('<p>no head</p>')).toString()).toBe('<p>no head</p>');
    });

    it('says what is wrong when there is no build', async () => {
      const empty = createAppServer({ root: join(dir, 'no-such-dist') });
      try {
        const res = await get('/', { port: await listen(empty) });
        expect(res.status).toBe(404);
        expect(res.body).toContain('npm run build');
      } finally {
        empty.close();
      }
    });
  });

  describe('path traversal', () => {
    it.each([
      '/..%2fsecret.txt',
      '/..%2f..%2f..%2fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/./../secret.txt',
      '//../secret.txt',
      '/assets/%00/../../secret.txt',
      '/secret.txt%00.html',
    ])('does not leave the web root for %s', async (path) => {
      const res = await get(path);
      expect([400, 403, 404]).toContain(res.status);
      expect(res.body).not.toContain('outside the web root');
    });

    it('refuses what it cannot decode or what points elsewhere', async () => {
      expect((await get('/..%2fsecret.txt')).status).toBe(403);
      expect((await get('/a%00b')).status).toBe(403);
      expect((await get('/%E0%A4%A')).status).toBe(400);
    });
  });

  describe('routing', () => {
    it('hands /dav-proxy to the proxy and nothing else', async () => {
      const calls: string[] = [];
      const routed = createAppServer({
        root: join(dir, 'dist'),
        proxy: async (req, res) => {
          if (req.url !== '/dav-proxy') return false;
          calls.push(req.method ?? '');
          res.end('proxied');
          return true;
        },
      });
      try {
        const routedPort = await listen(routed);
        expect((await get('/dav-proxy', { method: 'PROPFIND', port: routedPort })).body).toBe('proxied');
        expect((await get('/', { port: routedPort })).body).toBe(SHELL);
        expect(calls).toEqual(['PROPFIND']);
      } finally {
        routed.close();
      }
    });

    it('answers proxy requests itself when nothing replaces the proxy', async () => {
      const print = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.env.CALENDAR_PROXY_LOG = 'false';
      try {
        const res = await get('/dav-proxy', { method: 'PROPFIND' });
        expect(res.status).toBe(400);
        expect(res.headers['x-dav-proxy-error']).toBe('1');
        expect(print).not.toHaveBeenCalled();
        // The switch is read per request.
        delete process.env.CALENDAR_PROXY_LOG;
        await get('/dav-proxy', { method: 'PROPFIND' });
        expect(print).toHaveBeenCalledTimes(1);
        expect(print).toHaveBeenCalledWith(expect.stringMatching(/^dav-proxy client=127\.0\.0\.1 method=PROPFIND host=- status=400 ms=\d+$/));
      } finally {
        delete process.env.CALENDAR_PROXY_LOG;
        print.mockRestore();
      }
    });

    it('turns a crash into a 500 instead of taking the server down', async () => {
      const broken = createAppServer({
        root: join(dir, 'dist'),
        proxy: async () => {
          throw new Error('boom');
        },
      });
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        const brokenPort = await listen(broken);
        expect((await get('/', { port: brokenPort })).status).toBe(500);
        expect((await get('/', { port: brokenPort })).status).toBe(500);
        expect(errors).toHaveLength(2);
      } finally {
        console.error = original;
        broken.close();
      }
    });
  });
});

describe('stopping', () => {
  /** A server whose proxy answers each request only when the test says so. */
  async function holdingServer() {
    const pending: (() => void)[] = [];
    const proxy = async (_req: unknown, res: { end: (body: string) => void }) => {
      await new Promise<void>((resolve) => pending.push(resolve));
      res.end('done');
      return true;
    };
    const server = createAppServer({ root: tmpdir(), proxy: proxy as never });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const send = (method: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/dav-proxy', method }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end();
      });
    return { server, pending, send };
  }

  it('lets a DAV write in flight finish before it lets the process go', async () => {
    const { server, pending, send } = await holdingServer();
    const write = send('PUT');
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    let stopped = false;
    const stop = stopGracefully(server, { graceMs: 20, writeGraceMs: 5000 }).then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stopped).toBe(false);
    pending[0]();
    expect(await write).toBe(200);
    await stop;
    expect(server.listening).toBe(false);
  });

  it('does not wait long for reads, nor forever for a write', async () => {
    for (const [method, options] of [
      ['PROPFIND', { graceMs: 20, writeGraceMs: 5000 }],
      ['PUT', { graceMs: 20, writeGraceMs: 120 }],
    ] as const) {
      const { server, pending, send } = await holdingServer();
      send(method).catch(() => {});
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      const started = Date.now();
      await stopGracefully(server, options);
      expect(Date.now() - started, method).toBeLessThan(1500);
      server.closeAllConnections();
    }
  });
});

describe('deployment kit', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  /** Every environment variable the server's modules read, however they read it. */
  function serverVariables(): string[] {
    const names = new Set<string>();
    for (const file of readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs'))) {
      // Comments name variables too, and examples of them.
      const code = read(`server/${file}`)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');
      for (const m of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
      for (const m of code.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
      for (const m of code.matchAll(/['"`]((?:CALENDAR|VITE)_[A-Z0-9_]+)['"`]/g)) names.add(m[1]);
    }
    return [...names].sort();
  }

  it('finds what the server reads', () => {
    expect(serverVariables()).toEqual(expect.arrayContaining(['PORT', 'HOST', 'CALENDAR_TRUST_PROXY', 'CALENDAR_PROXY_ALLOW', 'CALENDAR_HSTS', 'VITE_APP_URL']));
  });

  it('documents every variable in the example environment and in the README', () => {
    const example = read('deploy/calendar.env.example');
    const readme = read('README.md').split('\n');
    /** Named whole, or on a row that names a sibling and adds this one's ending: "`CALENDAR_PROXY_RATE` / `_BURST`". */
    const documented = (name: string) =>
      readme.some(
        (line) =>
          line.includes(`\`${name}\``) ||
          [...name.matchAll(/_/g)].some(({ index }) => index > 0 && line.includes(`\`${name.slice(0, index)}_`) && line.includes(`\`${name.slice(index)}\``)),
      );
    for (const name of serverVariables()) {
      expect(example, name).toMatch(new RegExp(`^(# )?${name}=`, 'm'));
      expect(documented(name), name).toBe(true);
    }
    expect(documented('CALENDAR_NO_SUCH_SETTING')).toBe(false);
  });

  it('runs the server locked down', () => {
    const unit = read('deploy/calendar.service');
    for (const line of [
      'User=calendar',
      'ExecStart=/usr/bin/node server/server.mjs',
      'EnvironmentFile=/etc/calendar.env',
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'PrivateTmp=yes',
      'MemoryMax=512M',
      'Restart=always',
      // A crash loop must not leave it stopped for good.
      'StartLimitIntervalSec=0',
      'ProtectProc=invisible',
      'ProcSubset=pid',
      'SystemCallFilter=@system-service',
      'SystemCallErrorNumber=EPERM',
    ]) {
      expect(unit).toContain(`\n${line}\n`);
    }
    // Longer than the server waits for DAV writes in flight when it stops, and short: an update's outage.
    expect(Number(/^TimeoutStopSec=(\d+)$/m.exec(unit)?.[1])).toBe(15);
    expect(STOP_GRACE.writeGraceMs).toBeLessThanOrEqual(10_000);
    expect(STOP_GRACE.writeGraceMs).toBeLessThan(15_000 - 2000);
    expect(STOP_GRACE.graceMs).toBeLessThanOrEqual(STOP_GRACE.writeGraceMs);
    expect(read('docker-compose.yml')).toMatch(/^\s+stop_grace_period: 15s$/m);
    // The start limit belongs to [Unit], where older systemd versions read it.
    expect(unit.indexOf('StartLimitIntervalSec=0')).toBeLessThan(unit.indexOf('[Service]'));
    expect(unit).toMatch(/^WorkingDirectory=\/opt\/calendar$/m);
    // V8 compiles code at run time.
    expect(unit).not.toMatch(/^MemoryDenyWriteExecute=yes/m);
  });

  it('listens behind the reverse proxy only, which hands it the client address', () => {
    const example = read('deploy/calendar.env.example');
    expect(example).toMatch(/^HOST=127\.0\.0\.1$/m);
    expect(example).toMatch(/^CALENDAR_TRUST_PROXY=1$/m);
    expect(read('deploy/nginx.conf')).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    // Caddy adds the client to X-Forwarded-For by itself; one proxy is what CALENDAR_TRUST_PROXY=1 counts.
    expect(read('deploy/Caddyfile')).toMatch(/^\s*reverse_proxy 127\.0\.0\.1:8787 /m);
    expect(read('deploy/Caddyfile')).toContain('CALENDAR_TRUST_PROXY=1');
    // Neither adds headers of its own next to the server's policy.
    for (const file of ['deploy/nginx.conf', 'deploy/Caddyfile']) expect(read(file)).not.toMatch(/^\s*(add_header|header)\s/m);
  });

  it('keeps CalDAV addresses and credentials out of the access logs', () => {
    const caddy = read('deploy/Caddyfile');
    for (const header of ['X-Dav-Target', 'Destination', 'Authorization', 'Cookie']) expect(caddy).toMatch(new RegExp(`^\\s*request>headers>${header} delete$`, 'm'));
    // nginx logs the path without the query, and no header.
    expect(read('deploy/nginx.conf')).toMatch(/^log_format calendar '[^']*\$uri [^']*';$/m);
    expect(read('deploy/nginx.conf')).not.toMatch(/log_format[^;]*\$(http_|request_uri|args)/);
  });

  it('speaks TLS with forward secrecy only', () => {
    const nginx = read('deploy/nginx.conf');
    const ciphers = /^\s*ssl_ciphers ([^;]+);$/m.exec(nginx)?.[1].split(':') ?? [];
    expect(ciphers.length).toBeGreaterThan(0);
    expect(ciphers.every((c) => /^ECDHE-(ECDSA|RSA)-(AES(128|256)-GCM-SHA(256|384)|CHACHA20-POLY1305)$/.test(c))).toBe(true);
    expect(nginx).toMatch(/^\s*ssl_protocols TLSv1\.2 TLSv1\.3;$/m);
    expect(nginx).toMatch(/^\s*ssl_session_tickets off;$/m);
  });

  describe('the test workflow', () => {
    const workflow = read('.github/workflows/test.yml');
    /** The workflow without its comments, which may say what it does not do. */
    const steps = workflow
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

    it('only runs the tests: no secrets, nothing deployed or published, no write access', () => {
      expect(steps).not.toMatch(/secrets\.|deploy|publish|release|upload-artifact|ssh /i);
      expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
      for (const step of ['npm run typecheck', 'npx vitest run', 'node scripts/third-party-notices.mjs --check', 'npm run build', './gradlew --no-daemon testDebugUnitTest']) expect(workflow).toContain(step);
    });

    it('runs no install script', () => {
      const installs = [...workflow.matchAll(/npm ci[^\n]*/g)].map((m) => m[0]);
      expect(installs.length).toBeGreaterThanOrEqual(2);
      for (const install of installs) expect(install).toContain('--ignore-scripts');
    });

    it('can be run by the Docker workflow', () => {
      expect(workflow).toMatch(/^ {2}workflow_call:$/m);
    });
  });

  describe('the Docker workflow', () => {
    const workflow = read('.github/workflows/docker.yml');

    it('publishes for version tags only, after the tests, with the one write permission it needs', () => {
      expect(workflow).toMatch(/^ {2}push:\n {4}tags: \['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\]$/m);
      expect(workflow).not.toMatch(/^ {4}branches:/m);
      expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
      expect(workflow).toMatch(/^ {4}needs: tests$/m);
      expect(workflow).toContain('uses: ./.github/workflows/test.yml');
      expect([...workflow.matchAll(/packages: write/g)]).toHaveLength(1);
      expect(workflow).toContain("push: ${{ github.ref_type == 'tag' }}");
      expect(workflow).toContain("if: github.ref_type == 'tag'");
      // A tag that does not match the app's version publishes nothing.
      expect(workflow).toContain("require('./package.json').version");
      expect(workflow).toContain('platforms: linux/amd64,linux/arm64');
    });

    it('pins every action to a commit', () => {
      for (const file of ['docker.yml', 'test.yml']) {
        const uses = [...read(`.github/workflows/${file}`).matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1]).filter((u) => !u.startsWith('./'));
        expect(uses.length, file).toBeGreaterThan(0);
        for (const action of uses) expect(action, file).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      }
    });

    it('publishes the image the compose file and the README use', () => {
      expect(workflow).toContain('IMAGE=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/calendar-ce');
      expect(read('docker-compose.yml')).toMatch(/^ {4}image: ghcr\.io\/sysoppl\/calendar-ce:latest$/m);
      expect(read('README.md')).toContain('ghcr.io/sysoppl/calendar-ce');
    });
  });
});
