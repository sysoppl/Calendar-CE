// Production server: serves the built SPA from ./dist and the DAV proxy.
// Zero dependencies so it runs anywhere Node 20+ is available.
//
// Run it (`node server/server.mjs`, PORT and HOST from the environment) or
// import it: nothing listens until the file is the entry point.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleDavProxy, proxyNotices } from './davProxy.mjs';
import { resolveLinks } from './publicConfig.mjs';
import { securityHeaders } from './securityHeaders.mjs';

const DIST = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Opens `path` if it is a regular file; directories, devices and missing files give null. */
async function openFile(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    if ((await handle.stat()).isFile()) return handle;
  } catch {
    /* missing or unreadable */
  }
  await handle?.close();
  return null;
}

function matchesEtag(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag);
}

function sendPlain(res, status, text = '') {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  if (text) res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

/** The meta tag the app reads the server's links from (src/lib/links.ts). */
export const LINKS_META = 'calendar-links';

const escapeAttribute = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The links the app shows (privacy policy, terms, contact) as the server was
 * started with them, written into every HTML page it serves: a ready-made
 * image is built without any, and its operator sets them when it starts. A
 * link set here wins over the one the bundle was built with; null when none
 * is set, which leaves the pages as they were built.
 */
export function linksInjector(links) {
  const set = Object.fromEntries(Object.entries(links ?? {}).filter(([, value]) => typeof value === 'string' && value));
  if (!Object.keys(set).length) return null;
  const tag = Buffer.from(`<meta name="${LINKS_META}" content="${escapeAttribute(JSON.stringify(set))}">`);
  return (html) => {
    const end = html.indexOf('</head>');
    return end < 0 ? html : Buffer.concat([html.subarray(0, end), tag, html.subarray(end)]);
  };
}

async function serveStatic(req, res, root, headers, inject) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return sendPlain(res, 405);
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return sendPlain(res, 400);
  }
  let file = normalize(join(root, urlPath));
  if (urlPath.includes('\0') || (file !== root && !file.startsWith(root + sep))) return sendPlain(res, 403);
  // Windows reads a backslash as a separator too, which would slip a hidden
  // segment (/%5c.env) past the check below; nothing the build emits has one.
  if (urlPath.includes('\\')) return sendPlain(res, 404, 'Not found');

  const segments = urlPath.split('/');
  // Nothing the build emits starts with a dot, so such a path is a probe
  // (/.env, /.git/config) - except the directory reserved for site metadata.
  const hidden = segments.some((s) => s.startsWith('.') && s !== '.well-known');
  let handle = hidden ? null : await openFile(file);
  if (!handle && !hidden) {
    file = join(file, 'index.html');
    handle = await openFile(file);
  }
  if (!handle) {
    // The app shell answers every path the client-side app may own (/app/...).
    // Anything that names a file must exist: a missing chunk that
    // came back as HTML would be cached and executed as if it were the chunk.
    const appPath = !hidden && !/^\/assets(\/|$)/i.test(urlPath) && !segments.at(-1).includes('.');
    if (!appPath) return sendPlain(res, 404, 'Not found');
    file = join(root, 'index.html');
    handle = await openFile(file);
    if (!handle) return sendPlain(res, 404, 'Not found - did you run "npm run build"?');
  }

  let data;
  try {
    data = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (inject && extname(file).toLowerCase() === '.html') data = inject(data);
  // A digest rather than size and time: rebuilt files often keep both.
  const etag = `"${createHash('sha256').update(data).digest('base64url').slice(0, 22)}"`;
  res.setHeader('etag', etag);
  // Hashed assets never change; everything else (index.html, sw.js, the
  // manifest) must be revalidated so updates and fixes reach users.
  res.setHeader('cache-control', file.startsWith(join(root, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (matchesEtag(req.headers['if-none-match'], etag)) {
    res.statusCode = 304;
    return res.end();
  }
  res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('content-length', data.length);
  res.end(req.method === 'HEAD' ? undefined : data);
}

/**
 * Builds the request handler: the DAV proxy first, static files otherwise.
 * `root` is the directory to serve (default ./dist next to this folder),
 * `headers` go on every static response, `proxy` is a `handleDavProxy`
 * compatible function, `links` the links written into HTML pages (default:
 * VITE_PRIVACY_URL, VITE_TERMS_URL and VITE_CONTACT_URL from the environment).
 */
export function createRequestHandler({ root = DIST, headers = securityHeaders(), proxy = handleDavProxy, links = resolveLinks() } = {}) {
  const base = resolve(root);
  const inject = linksInjector(links);
  return async function handleRequest(req, res) {
    try {
      if (await proxy(req, res)) return;
      await serveStatic(req, res, base, headers, inject);
    } catch (err) {
      console.error(err);
      if (res.headersSent) return res.destroy();
      sendPlain(res, 500);
    }
  };
}

/** The handler for ./dist with the settings from the environment. */
export const handleRequest = createRequestHandler();

/** How long a stop waits for reads in flight, and for everything when a DAV write is among them (ms). */
export const STOP_GRACE = Object.freeze({ graceMs: 5000, writeGraceMs: 10_000 });

/** Methods that change something on a DAV server; a stop lets these finish. */
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'PROPPATCH', 'MKCALENDAR', 'MKCOL', 'MOVE', 'COPY']);
/** server -> the responses of writes still in flight. */
const writesInFlight = new WeakMap();

/** An `http.Server` that is not listening yet. */
export function createAppServer(options) {
  const server = createServer(options ? createRequestHandler(options) : handleRequest);
  const writes = new Set();
  writesInFlight.set(server, writes);
  server.on('request', (req, res) => {
    if (!WRITE_METHODS.has((req.method ?? '').toUpperCase())) return;
    writes.add(res);
    res.on('close', () => writes.delete(res));
  });
  return server;
}

/**
 * Stops taking connections and resolves once the server may exit. Idle
 * connections close at once and the rest as their answers go out. Reads get
 * `graceMs`; a DAV write the upstream may already have applied gets up to
 * `writeGraceMs` in all, which covers an ordinary write, so that a restart
 * seldom leaves the client unsure whether its change was made. Not longer:
 * the new process cannot take the port before this one has gone, and every
 * request waits for that, so a deploy stays an outage of a few seconds. A
 * write cut off there is reported to the client as failed, which looks again
 * before it repeats it (the next sync).
 */
export function stopGracefully(server, { graceMs = STOP_GRACE.graceMs, writeGraceMs = STOP_GRACE.writeGraceMs } = {}) {
  const writes = writesInFlight.get(server) ?? new Set();
  const started = Date.now();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearInterval(timer);
      resolve();
    };
    server.close(done);
    server.closeIdleConnections();
    timer = setInterval(() => {
      server.closeIdleConnections();
      const elapsed = Date.now() - started;
      if ((elapsed >= graceMs && writes.size === 0) || elapsed >= writeGraceMs) done();
    }, Math.min(250, Math.max(10, graceMs)));
  });
}

function isEntryFile() {
  if (!process.argv[1]) return false;
  try {
    // Both sides resolved, so starting through a symlink counts.
    const [entry, self] = [process.argv[1], fileURLToPath(import.meta.url)].map((path) => realpathSync(path));
    return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
  } catch {
    return false;
  }
}

if (isEntryFile()) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Calendar CE listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    for (const notice of proxyNotices()) console.warn(notice);
  });
  // As PID 1 in a container Node ignores these signals unless they are
  // handled, and the stop would run into its timeout. The unit's
  // TimeoutStopSec (15 s, compose's stop_grace_period too) allows for the writes.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void stopGracefully(server).then(() => process.exit(0));
    });
  }
}
