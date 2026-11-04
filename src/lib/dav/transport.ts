// HTTP transports for DAV requests in the browser. The Android app has its
// own, the native DavHttp plugin (src/lib/nativeHttp.ts), which CORS does not
// concern.
//
// * `direct`  - plain fetch(). Works only with servers that send CORS headers.
// * `proxy`   - sends the request to the bundled /dav-proxy endpoint.

import { t, type MessageKey } from '@/i18n';

export interface DavRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DavResponseRaw {
  status: number;
  headers: Headers;
  body: string;
  /** Absolute redirect target when the server answered with 3xx. */
  location?: string;
}

export type Transport = (req: DavRequest) => Promise<DavResponseRaw>;

export class DavHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body = '') {
    super(message);
    this.name = 'DavHttpError';
    this.status = status;
    this.body = body;
  }
}

export class DavNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DavNetworkError';
  }
}

export const directTransport: Transport = async (req) => {
  let res: Response;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    throw new DavNetworkError(t('dav.direct.unreachable', { host: new URL(req.url).host, detail: err instanceof Error ? err.message : String(err) }));
  }
  // The browser follows redirects by itself here. Current ones drop the
  // Authorization header when the target is another origin; an answer that
  // came from one is refused all the same, so nothing is built on it.
  if (res.redirected && res.url && hasCredentials(req) && !keepsCredentials(req.url, res.url)) {
    throw crossOriginRedirect(req.url, res.url);
  }
  return {
    status: res.status,
    headers: res.headers,
    body: await res.text(),
    location: res.redirected ? undefined : (res.headers.get('location') ?? undefined),
  };
};

/** What a feed the browser fetches itself may take: what the proxy allows (server/davProxy.mjs). */
export const FEED_MAX_BYTES = 64 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 90_000;

/** The browser could not fetch the address itself (no CORS headers, blocked, a network failure); the proxy may. */
export class DirectFetchUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectFetchUnavailable';
  }
}

/**
 * A subscribed feed fetched by the browser itself, so that neither its
 * address (often a secret token) nor its contents pass the app's server: no
 * cookies or other credentials, no referrer, the proxy's size limit and time
 * limit. Redirects are followed by the browser, which refuses a step down to
 * plain http on an https page. What the browser may not read (the feed's
 * server sends no CORS headers) or cannot reach is `DirectFetchUnavailable`.
 */
export async function fetchFeedDirect(url: string, limits: { maxBytes?: number; timeoutMs?: number } = {}): Promise<DavResponseRaw> {
  const maxBytes = limits.maxBytes ?? FEED_MAX_BYTES;
  const signal = AbortSignal.timeout(limits.timeoutMs ?? FEED_TIMEOUT_MS);
  const timedOut = () => new DavNetworkError(t('data.feedTimeout'));
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/calendar, */*' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'follow',
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw timedOut();
    throw new DirectFetchUnavailable(err instanceof Error ? err.message : String(err));
  }
  const tooLarge = () => new DavNetworkError(t('data.feedTooLarge', { mib: Math.round(maxBytes / 1048576) }));
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  let body = '';
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooLarge();
        }
        body += decoder.decode(value, { stream: true });
      }
    } catch (err) {
      if (err instanceof DavNetworkError) throw err;
      if (signal.aborted) throw timedOut();
      throw new DirectFetchUnavailable(err instanceof Error ? err.message : String(err));
    }
    body += decoder.decode();
  }
  return { status: res.status, headers: res.headers, body };
}

function hasCredentials(req: DavRequest): boolean {
  return Object.keys(req.headers ?? {}).some((name) => name.toLowerCase() === 'authorization');
}

/** The proxy's own refusals that a user can act on, by the `code` it sends (server/davProxy.mjs). */
const PROXY_MESSAGES: Record<string, MessageKey> = {
  upstream: 'dav.proxy.upstream',
  timeout: 'dav.proxy.timeout',
  'rate-limited': 'dav.proxy.rateLimited',
  busy: 'dav.proxy.busy',
  'too-large': 'dav.proxy.tooLarge',
  disabled: 'dav.proxy.disabled',
  'host-not-allowed': 'dav.proxy.hostNotAllowed',
  'private-address': 'dav.proxy.privateAddress',
  'port-not-allowed': 'dav.proxy.portNotAllowed',
  'https-required': 'dav.proxy.httpsRequired',
  misdirected: 'dav.proxy.misdirected',
};

/**
 * How much of an answer its one-line summary is made from. Stripping tags is
 * quadratic on a long run of '<' without '>', so only the start is read.
 */
export const SUMMARY_SOURCE = 4096;

/**
 * An answer as one short line of text. It becomes the account's error, which
 * is shown and stored, so a server must not be able to put a page there.
 */
function summarize(body: string): string {
  return body.slice(0, SUMMARY_SOURCE).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The proxy's error answer in the user's language where there is a text for it, else a summary of it. */
function proxyMessage(body: string, target: string): string {
  let answer: { error?: unknown; code?: unknown } = {};
  try {
    answer = JSON.parse(body) ?? {};
  } catch {
    return summarize(body);
  }
  const raw = summarize(typeof answer.error === 'string' ? answer.error : body);
  const key = typeof answer.code === 'string' ? PROXY_MESSAGES[answer.code] : undefined;
  if (!key) return raw;
  let host = target;
  let port = '';
  try {
    ({ hostname: host, port } = new URL(target));
  } catch {
    /* keep the target as given */
  }
  // "Upstream request failed: ECONNREFUSED": the system's code is the useful part.
  const detail = /: ([A-Z0-9_]+)$/.exec(raw)?.[1] ?? raw;
  return t(key, { host, port, detail });
}

export function proxyTransport(proxyUrl = '/dav-proxy'): Transport {
  return async (req) => {
    let res: Response;
    let body: string;
    try {
      res = await fetch(proxyUrl, {
        method: req.method,
        headers: { ...req.headers, 'X-Dav-Target': req.url },
        body: req.body,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new DavNetworkError(t('dav.proxy.unreachable'));
    }
    try {
      // Streamed by the proxy: a transfer cut off half-way fails here.
      body = await res.text();
    } catch (err) {
      throw new DavNetworkError(t('dav.proxy.cut', { detail: err instanceof Error ? err.message : String(err) }));
    }
    // Answers produced by the proxy itself (blocked host, upstream down, ...).
    if (res.headers.has('x-dav-proxy-error')) throw new DavNetworkError(proxyMessage(body, req.url));
    // The proxy marks what it relays. A gateway error without the mark comes
    // from a reverse proxy in front of the app's server, which is down; the
    // calendar server's own errors go on to the client to be worded there.
    if (!res.headers.has('x-dav-proxy-relay') && [502, 503, 504].includes(res.status)) {
      throw new DavNetworkError(t('dav.proxy.unreachable'));
    }
    return {
      status: res.status,
      headers: res.headers,
      body,
      location: res.headers.get('x-dav-location') ?? undefined,
    };
  };
}

/**
 * Resolves a redirect target. Redirects are followed manually so credentials
 * survive them, which makes it our job to refuse the dangerous ones: anything
 * that is not http(s), and a downgrade from https to plain http (which would
 * put the password on the wire in clear text). Requests with credentials
 * check `keepsCredentials` on top of this.
 */
export function resolveRedirect(from: string, location: string): string {
  const current = new URL(from);
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new DavNetworkError(t('dav.redirect.invalid', { host: current.host }));
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    throw new DavNetworkError(t('dav.redirect.unsupported', { host: current.host }));
  }
  if (current.protocol === 'https:' && next.protocol === 'http:') {
    throw new DavNetworkError(t('dav.redirect.downgrade', { host: current.host }));
  }
  return next.toString();
}

/**
 * Whether a request that carries the user's password may be repeated at `to`
 * after a redirect from `from`: only on the same origin, or on the same host
 * when plain http is upgraded to https on the standard ports. Anywhere else
 * the password would reach a server the user never named.
 */
export function keepsCredentials(from: string, to: string): boolean {
  const a = new URL(from);
  const b = new URL(to);
  if (a.origin === b.origin) return true;
  return a.protocol === 'http:' && b.protocol === 'https:' && a.hostname === b.hostname && !a.port && !b.port;
}

export function crossOriginRedirect(from: string, to: string): DavNetworkError {
  return new DavNetworkError(t('dav.redirect.crossOrigin', { from: new URL(from).host, to: new URL(to).host }));
}

/** Throws unless `url` is an absolute http(s) URL; returns it normalised. */
export function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DavNetworkError(t('dav.url.invalid'));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DavNetworkError(t('dav.url.scheme'));
  }
  return parsed.toString();
}

/**
 * A server address as the user typed it, the way discovery reads it: https://
 * when no scheme was given, then normalised. A user name or password in it is
 * refused: it would be stored with the address, outside the password box,
 * and copied into every address derived from it.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  const url = assertHttpUrl(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  assertNoCredentials(url);
  return url;
}

/** Throws when `url` carries a user name or password (`https://user:pass@host/`). */
export function assertNoCredentials(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DavNetworkError(t('dav.url.invalid'));
  }
  if (parsed.username || parsed.password) throw new DavNetworkError(t('dav.url.credentials'));
}

/** Host names only a local network or this device resolves. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.intranet'];

function isLocalIPv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
}

function isLocalIPv6(host: string): boolean {
  if (!host.startsWith('[')) return false;
  const h = host.slice(1, -1);
  // Loopback, unique local (fc00::/7), link-local (fe80::/10), and IPv4 written as IPv6.
  if (h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!mapped) return false;
  const hi = parseInt(mapped[1], 16);
  const lo = parseInt(mapped[2], 16);
  return isLocalIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
}

/**
 * Whether requests to `url` would carry the password and the calendars in
 * clear over the internet: plain http to a host that is not this device or
 * the local network (loopback, RFC 1918, link-local, unique local, CGNAT,
 * `.local`/`.lan`/`.home.arpa` and the like, or a single-label name). An
 * address without a scheme is https (as discovery reads it).
 */
export function sendsInClear(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (host.startsWith('[')) return !isLocalIPv6(host);
  if (/^[\d.]+$/.test(host)) return !isLocalIPv4(host);
  return host.includes('.');
}

export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `Basic ${btoa(bin)}`;
}
