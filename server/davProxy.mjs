// Minimal CalDAV forwarding proxy.
//
// Browsers cannot talk to most DAV servers directly because those servers do
// not send CORS headers. The web build therefore sends every DAV request to
// `/dav-proxy` with the real destination in the `X-Dav-Target` header.
// This module forwards the request and relays the answer back.
//
// A forwarding proxy is a classic SSRF vector, so by default it only connects
// to public internet addresses, and never to the ports browsers keep for
// other protocols (mail, shell, chat). It also has no way to tell the app
// from any other program, so every client gets a budget: a token bucket for
// requests and a cap on requests in flight. Configuration (environment
// variables):
//
//   CALENDAR_PROXY_ALLOW          Comma-separated host patterns the proxy may
//                                  contact (e.g. "dav.example.com,*.fastmail.com,
//                                  192.168.1.10"). Every other host is refused.
//                                  An exact entry that is an IP address, a name
//                                  without a dot ("radicale") or a name under a
//                                  local-only suffix (.local, .lan, .internal,
//                                  .home.arpa, .localhost) may also live on a
//                                  private network; other names, and wildcards,
//                                  must resolve to public addresses.
//   CALENDAR_PROXY_PRIVATE_HOSTS  Comma-separated exact host names that may
//                                  live on a private network (e.g.
//                                  "dav.home.example"). They are allowed as if
//                                  listed in CALENDAR_PROXY_ALLOW.
//   CALENDAR_PROXY_OPEN           "true" lets the proxy contact any public host
//                                  when neither list above is set. Without it
//                                  and without a list, every target is refused.
//   CALENDAR_PROXY_ALLOW_PRIVATE  "true" lets the proxy reach loopback, LAN and
//                                  link-local addresses for any allowed host.
//                                  Only enable this on a trusted network.
//   CALENDAR_PROXY_ALLOW_HTTP     "true" lets plain http: requests with a
//                                  password (an Authorization header) reach
//                                  public addresses. By default those go only
//                                  to hosts on a private network, so passwords
//                                  never cross the internet unencrypted;
//                                  without one (a public feed) http: goes
//                                  anywhere an https: request would.
//   CALENDAR_PROXY_DISABLED       "true" switches the proxy off: every request
//                                  is refused and nothing is forwarded.
//   CALENDAR_TRUST_PROXY          Number of reverse proxies in front of this
//                                  server ("true" = 1). Only then is the client
//                                  address taken from X-Forwarded-For; without
//                                  it everybody behind the reverse proxy shares
//                                  one budget. Default 0.
//   CALENDAR_PROXY_RATE           Requests per minute one client may make in
//                                  the long run. Default 600, 0 = unlimited.
//   CALENDAR_PROXY_BURST          Requests a client may make at once before the
//                                  rate applies. Default 300.
//   CALENDAR_PROXY_CLIENT_CONCURRENCY
//                                  Requests in flight per client. Default 6,
//                                  0 = unlimited.
//   CALENDAR_PROXY_CONCURRENCY    Requests in flight in total. Default 32,
//                                  0 = unlimited. Each may hold a request body
//                                  of up to 10 MiB in memory; all bodies
//                                  together are capped at 128 MiB (one client:
//                                  a quarter), and requests over it get 503/429.
//   CALENDAR_PROXY_AUTH_FAILURES  Answers 401 (wrong password) one client may
//                                  get for requests with a password in 10
//                                  minutes. Default 20, 0 = unlimited. Past it
//                                  its requests with a password get 429 without
//                                  reaching the server, so the proxy is no tool
//                                  for trying passwords against somebody's
//                                  account; those without one go on.
//   CALENDAR_PUBLIC_HOSTS         Comma-separated host names this server is
//                                  reached by, besides the host of VITE_APP_URL
//                                  (wildcards like *.example.com allowed; when
//                                  VITE_APP_URL is not set, the app's default
//                                  address, publicConfig.mjs). Proxy requests
//                                  for any other Host (but IP addresses and
//                                  local names) get 421, which keeps
//                                  DNS-rebinding pages out.
//   CALENDAR_PROXY_LOG            "false" silences the line logged per request.
//
// Requests over a limit wait for their turn (up to 30 s) instead of failing,
// so a large sync or import merely slows down.
import { lookup as dnsLookup } from 'node:dns';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolvePublicConfig } from './publicConfig.mjs';

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'depth',
  'content-type',
  'if-match',
  'if-none-match',
  'prefer',
  'accept',
  'brief',
  'destination',
  'overwrite',
];

const FORWARD_RESPONSE_HEADERS = ['content-type', 'etag', 'dav', 'last-modified', 'allow', 'schedule-tag'];

const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'PROPFIND',
  'PROPPATCH',
  'REPORT',
  'MKCALENDAR',
  'MKCOL',
  'MOVE',
  'COPY',
]);

// The ports browsers refuse to fetch from (the Fetch standard's "bad ports"):
// mail, shell, chat and other services that would read an HTTP request as
// commands, so the proxy never becomes a way to talk to them.
const BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
  113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
  6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export const PROXY_PATH = '/dav-proxy';
export const TARGET_HEADER = 'x-dav-target';
/** Marks answers produced by the proxy itself rather than the DAV server. */
export const PROXY_ERROR_HEADER = 'x-dav-proxy-error';
/**
 * Marks answers relayed from the DAV server. An answer with neither mark did
 * not come from the proxy at all (a reverse proxy in front of this server).
 */
export const PROXY_RELAY_HEADER = 'x-dav-proxy-relay';

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
/**
 * Request bodies held in memory by all running requests together. With the
 * unit's MemoryMax=512M this leaves room for Node itself and for the copies
 * made while a body is joined or sent.
 */
const MAX_BODY_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Longest a request may hold its slot: reading the body, the upstream exchange and the relay back. */
const UPSTREAM_TIMEOUT_MS = 90_000;
/** Longest a request waits for a token or a free slot before it is turned away. */
const MAX_WAIT_MS = 30_000;
/** Requests that may wait at the same time in total; each holds a connection open. */
const MAX_PARKED = 1024;
/**
 * Requests one client may have waiting: PARKED_PER_SLOT times what it may run,
 * at most MAX_PARKED_PER_CLIENT. Once a quarter of the room is taken, every
 * client gets a quarter of that share, so that a handful of addresses cannot
 * fill the line: they get 429 for their own requests instead of everybody
 * getting 503.
 */
const PARKED_PER_SLOT = 8;
const MAX_PARKED_PER_CLIENT = 128;
/** The window the answers 401 of CALENDAR_PROXY_AUTH_FAILURES are counted in. */
const AUTH_FAILURE_WINDOW_MS = 10 * 60_000;
/** nginx's code for "the client went away before the answer"; only ever logged. */
const CLIENT_CLOSED_REQUEST = 499;

// Loopback, private, link-local (incl. cloud metadata), CGNAT, multicast and
// other ranges that never belong to a public DAV server.
const PRIVATE_RANGES = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  // Documentation (TEST-NET-1..3) and the retired 6to4 relay anycast range.
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv4');
}
// The tunnelling ranges (NAT64, Teredo, 6to4) wrap an IPv4 address of the
// sender's choice, so they are refused whole rather than unwrapped.
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv6');
}

/** Expands an IPv6 literal into its eight 16-bit groups, or null. */
function ipv6Groups(address) {
  let addr = address;
  const v4 = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (v4) {
    const [a, b, c, d] = v4.slice(2).map(Number);
    addr = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
}

/** True for addresses that are not publicly routable (or not addresses at all). */
export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return PRIVATE_RANGES.check(address, 'ipv4');
  if (family !== 6) return true;
  const groups = ipv6Groups(address.replace(/%.*$/, ''));
  if (!groups) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    if (groups[5] === 0xffff || groups[6] !== 0 || groups[7] > 1) return PRIVATE_RANGES.check(v4, 'ipv4');
  }
  // Public unicast lives in 2000::/3. Everything else (IPv4-translated
  // ::ffff:0:a.b.c.d, ULA, link-local, multicast, the unassigned rest) is not
  // a DAV server on the internet.
  if ((groups[0] & 0xe000) !== 0x2000) return true;
  return PRIVATE_RANGES.check(address.replace(/%.*$/, ''), 'ipv6');
}

/** Suffixes that never resolve on the public internet (RFC 6761, 6762, 8375; ICANN's .internal; the common .lan). */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.internal', '.home.arpa'];

/**
 * True for a host whose exact listing in CALENDAR_PROXY_ALLOW may open private
 * networks: an IP address, a name without a dot (a container or LAN host), or
 * a name under a local-only suffix. A dotted public name is someone else's
 * zone, and whoever controls its DNS could point it into this network.
 */
export function isLocalName(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return isIP(host) !== 0 || !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function hostAllowed(hostname, allowList) {
  if (!allowList.length) return true;
  const host = hostname.toLowerCase();
  return allowList.some((pattern) => {
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) || host === pattern.slice(2);
    return host === pattern;
  });
}

/** Whether a proxy request carries a password for the DAV server (the one header that does). */
function carriesCredentials(req) {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.trim() !== '';
}

/** A comma-separated list of hosts from the environment, in lower case. */
function envHosts(name, env = process.env) {
  return (env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function envFlag(name, env = process.env) {
  return /^(1|true|yes|on)$/i.test((env[name] ?? '').trim());
}

/**
 * The host names this server answers proxy requests for: CALENDAR_PUBLIC_HOSTS
 * and the host of VITE_APP_URL. With neither set, the host of the app's
 * default address (publicConfig.mjs), which the bundle was built for too: the
 * Docker image does not carry VITE_APP_URL into its runtime unless it was
 * built with one, and answering for any name would leave a server on a LAN
 * open to DNS rebinding. Null (any name) only when that cannot be read.
 */
export function publicHosts(env = process.env) {
  const hosts = envHosts('CALENDAR_PUBLIC_HOSTS', env);
  const appUrl = (env.VITE_APP_URL ?? '').trim();
  if (appUrl) {
    try {
      hosts.push(new URL(appUrl).hostname.toLowerCase());
    } catch {
      /* publicConfig.mjs refuses such a value when the server starts */
    }
  } else if (!hosts.length) {
    try {
      hosts.push(new URL(resolvePublicConfig(env).appUrl).hostname.toLowerCase());
    } catch {
      /* another public setting is wrong, which stops the server's start */
    }
  }
  return hosts.length ? hosts : null;
}

/**
 * True when the Host header names this server: one of `hosts`, an IP address
 * (direct access on a LAN, or a reverse proxy that passes its upstream's
 * address) or a local name (`localhost`, a name without a dot, `.lan` and the
 * like). A web page that rebinds its own public name to this server's
 * address sends that name, which is refused.
 */
export function hostHeaderAllowed(header, hosts) {
  if (!hosts) return true;
  if (typeof header !== 'string' || !header) return false;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(header);
  const host = (bracketed ? bracketed[1] : header.replace(/:\d+$/, '')).toLowerCase().replace(/\.$/, '');
  if (!host || isLocalName(host)) return Boolean(host);
  return hostAllowed(host, hosts);
}

/** What the operator should know about the proxy's configuration when the server starts. */
export function proxyNotices(env = process.env) {
  if (envFlag('CALENDAR_PROXY_DISABLED', env)) return ['dav-proxy: switched off (CALENDAR_PROXY_DISABLED)'];
  const notices = [];
  if (envHosts('CALENDAR_PROXY_ALLOW', env).length || envHosts('CALENDAR_PROXY_PRIVATE_HOSTS', env).length) {
    // The usual case.
  } else if (envFlag('CALENDAR_PROXY_OPEN', env)) {
    notices.push('dav-proxy: warning: CALENDAR_PROXY_OPEN is set and CALENDAR_PROXY_ALLOW is not, so anyone who reaches this server can use it to contact any public host');
  } else {
    notices.push(
      'dav-proxy: CALENDAR_PROXY_ALLOW is not set, so the proxy refuses every target (since 1.2.0; before, an empty list meant any public host); name the CalDAV servers there, or set CALENDAR_PROXY_OPEN=true',
    );
  }
  // Since 1.2.0 an exact dotted name opens the private network only from
  // CALENDAR_PROXY_PRIVATE_HOSTS (or under a local-only suffix): a LAN server
  // listed in CALENDAR_PROXY_ALLOW by such a name gets 403 private-address.
  if (!envFlag('CALENDAR_PROXY_ALLOW_PRIVATE', env)) {
    const privateHosts = envHosts('CALENDAR_PROXY_PRIVATE_HOSTS', env);
    const publicOnly = envHosts('CALENDAR_PROXY_ALLOW', env).filter((host) => !host.startsWith('*.') && !isLocalName(host) && !privateHosts.includes(host));
    if (publicOnly.length) {
      notices.push(
        `dav-proxy: these exact names in CALENDAR_PROXY_ALLOW reach public addresses only, not a private network (since 1.2.0): ${publicOnly.join(', ')}; ` +
          'list a server of your own network by such a name in CALENDAR_PROXY_PRIVATE_HOSTS instead',
      );
    }
  }
  if (!envHosts('CALENDAR_PUBLIC_HOSTS', env).length && !(env.VITE_APP_URL ?? '').trim()) {
    const hosts = publicHosts(env);
    notices.push(
      hosts
        ? `dav-proxy: neither CALENDAR_PUBLIC_HOSTS nor VITE_APP_URL is set, so the proxy answers only for ${hosts.join(', ')}, IP addresses and local names; name the host this server is reached by in CALENDAR_PUBLIC_HOSTS`
        : 'dav-proxy: neither CALENDAR_PUBLIC_HOSTS nor VITE_APP_URL is set, so the proxy answers for any host name; set one to keep pages that rebind their name to this server out',
    );
  }
  return notices;
}

/** A non-negative whole number from the environment; anything else means the default. */
function envCount(name, fallback) {
  const value = (process.env[name] ?? '').trim();
  return /^\d{1,9}$/.test(value) ? Number(value) : fallback;
}

/** Explicit options win over the environment, which is read per request like the allow-list. */
function resolveSettings(options) {
  const limits = options.limits ?? {};
  const pick = (value, name, fallback) => value ?? envCount(name, fallback);
  return {
    allowPrivate: options.allowPrivate,
    // A caller the server trusts with private networks (the dev server's
    // loopback clients) may also reach any host when no list is set.
    open: options.open ?? (options.allowPrivate === true || envFlag('CALENDAR_PROXY_OPEN')),
    disabled: options.disabled ?? envFlag('CALENDAR_PROXY_DISABLED'),
    publicHosts: options.publicHosts !== undefined ? options.publicHosts : publicHosts(),
    trustProxy: options.trustProxy ?? (envFlag('CALENDAR_TRUST_PROXY') ? 1 : envCount('CALENDAR_TRUST_PROXY', 0)),
    log: options.log === false ? null : (options.log ?? (/^(0|false|no|off)$/i.test((process.env.CALENDAR_PROXY_LOG ?? '').trim()) ? null : console.log)),
    limits: {
      ratePerMinute: pick(limits.ratePerMinute, 'CALENDAR_PROXY_RATE', 600),
      burst: Math.max(1, pick(limits.burst, 'CALENDAR_PROXY_BURST', 300)),
      clientConcurrency: pick(limits.clientConcurrency, 'CALENDAR_PROXY_CLIENT_CONCURRENCY', 6) || Infinity,
      concurrency: pick(limits.concurrency, 'CALENDAR_PROXY_CONCURRENCY', 32) || Infinity,
      maxWaitMs: limits.maxWaitMs ?? MAX_WAIT_MS,
      timeoutMs: limits.timeoutMs ?? UPSTREAM_TIMEOUT_MS,
      maxResponseBytes: limits.maxResponseBytes ?? MAX_RESPONSE_BYTES,
      maxParked: limits.maxParked ?? MAX_PARKED,
      maxBodyBytes: limits.maxBodyBytes ?? MAX_BODY_BYTES,
      authFailures: pick(limits.authFailures, 'CALENDAR_PROXY_AUTH_FAILURES', 20),
      authWindowMs: limits.authWindowMs ?? AUTH_FAILURE_WINDOW_MS,
    },
  };
}

class ProxyError extends Error {
  /** `code` is a stable identifier for the client; `retryAfterMs` becomes a Retry-After header. */
  constructor(status, code, message, retryAfterMs) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** An address as written by a socket or a reverse proxy, in canonical form, or null. */
function normaliseAddress(value) {
  let address = value.trim();
  // Some proxies append the port: "203.0.113.7:4711", "[2001:db8::1]:4711".
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) address = bracketed[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(':'));
  address = address.replace(/%.*$/, '');
  // Dual-stack sockets report IPv4 peers as ::ffff:a.b.c.d.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) address = mapped[1];
  return isIP(address) ? address.toLowerCase() : null;
}

/**
 * The address a request came from. X-Forwarded-For is written by whoever sent
 * the request, so it counts only when `trustedHops` reverse proxies are known
 * to sit in front: each appends the address it saw, which makes the entry that
 * many places from the right the first one a client cannot forge.
 */
export function clientAddress(req, trustedHops = 0) {
  const peer = normaliseAddress(req.socket?.remoteAddress ?? '') ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (!(trustedHops > 0) || typeof forwarded !== 'string') return peer;
  const chain = forwarded.split(',');
  return normaliseAddress(chain[Math.max(0, chain.length - trustedHops)]) ?? peer;
}

/** Budgets are per address, except IPv6, where one customer holds a whole /64. */
function clientKey(address) {
  if (isIP(address) !== 6) return address;
  const groups = ipv6Groups(address);
  return groups ? groups.slice(0, 4).join(':') : address;
}

/**
 * Per-client token bucket plus per-client and overall caps on requests in
 * flight. Callers over a limit wait (for a token, then in line: oldest first,
 * without letting one busy client hold up the others) and are turned away
 * only when the wait would be longer than `maxWaitMs` or too many wait.
 */
function createLimiter() {
  /**
   * key -> { tat, authTat, running, parked, inLine }; `tat` is the time the
   * bucket's next token is due (GCRA), `authTat` the same for the bucket of
   * answers 401.
   */
  const clients = new Map();
  const line = [];
  let running = 0;
  let parked = 0;
  let bodyBytes = 0;
  let sweptAt = 0;

  const tooMany = (retryAfterMs = 1000) =>
    new ProxyError(429, 'rate-limited', 'Too many requests to the DAV proxy. Try again in a moment.', retryAfterMs);
  const busy = () => new ProxyError(503, 'busy', 'The DAV proxy is busy. Try again in a moment.', 1000);

  function clientState(key, now) {
    let client = clients.get(key);
    if (client) return client;
    // An idle client whose bucket has refilled is indistinguishable from a new
    // one, so such entries are dropped and the map follows recent traffic.
    if (clients.size >= 1024 && now - sweptAt > 1000) {
      sweptAt = now;
      for (const [k, c] of clients) if (!c.running && !c.parked && c.tat <= now && c.authTat <= now) clients.delete(k);
    }
    client = { tat: 0, authTat: 0, running: 0, parked: 0, inLine: 0, bodyBytes: 0 };
    clients.set(key, client);
    return client;
  }

  /** How many requests one client may have waiting right now. */
  function parkingShare(limits) {
    const share = Math.min(MAX_PARKED_PER_CLIENT, PARKED_PER_SLOT * limits.clientConcurrency);
    return parked >= limits.maxParked / 4 ? Math.max(1, Math.floor(share / 4)) : share;
  }

  /** Counts a request that has to wait; there is only so much room for those. */
  function park(client, limits) {
    if (client.parked >= parkingShare(limits)) throw tooMany();
    if (parked >= limits.maxParked) throw busy();
    client.parked++;
    parked++;
  }

  function unpark(client) {
    client.parked--;
    parked--;
  }

  /** Takes a token and waits until it may be used. */
  async function takeToken(client, limits, now, signal) {
    if (!limits.ratePerMinute) return;
    const interval = 60_000 / limits.ratePerMinute;
    const tat = Math.max(client.tat, now);
    const wait = Math.round(tat - interval * (limits.burst - 1) - now);
    if (wait > limits.maxWaitMs) throw tooMany(wait);
    if (wait > 0) park(client, limits);
    client.tat = tat + interval;
    if (wait <= 0) return;
    try {
      await sleep(wait, undefined, { signal });
    } finally {
      unpark(client);
    }
  }

  const hasSlot = (client, limits) => client.running < limits.clientConcurrency && running < limits.concurrency;

  function grant(client) {
    client.running++;
    running++;
  }

  /** Resolves once the request may run. */
  function takeSlot(client, limits, signal) {
    if (!client.inLine && hasSlot(client, limits)) return grant(client);
    park(client, limits);
    return new Promise((resolve, reject) => {
      const waiter = { client, limits, enter: undefined };
      const leave = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const at = line.indexOf(waiter);
        if (at >= 0) line.splice(at, 1);
        client.inLine--;
        unpark(client);
      };
      const onAbort = () => {
        leave();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        leave();
        // Its own requests are in the way, or everybody else's.
        reject(client.running >= limits.clientConcurrency ? tooMany() : busy());
      }, limits.maxWaitMs);
      waiter.enter = () => {
        leave();
        grant(client);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      client.inLine++;
      line.push(waiter);
    });
  }

  /**
   * Resolves with a token for `release` once the request of client `key` may
   * run. Rejects with a ProxyError when it is turned away, and with the
   * signal's reason when `signal` aborts while it waits.
   */
  async function admit(key, limits, signal) {
    const now = Date.now();
    const client = clientState(key, now);
    await takeToken(client, limits, now, signal);
    await takeSlot(client, limits, signal);
    return client;
  }

  function release(client) {
    client.running--;
    running--;
    // Oldest first, skipping clients that are at their own cap.
    for (const waiter of [...line]) if (hasSlot(waiter.client, waiter.limits)) waiter.enter();
  }

  /**
   * Counts `bytes` of request body that a running request is about to hold in
   * memory. The slots alone would let 32 bodies of 10 MiB (twice that while
   * they are joined) take the whole memory limit, so the bytes have a budget
   * of their own, and one client gets at most a quarter of it.
   */
  function holdBody(client, bytes, limits) {
    const share = Math.max(MAX_REQUEST_BYTES, limits.maxBodyBytes / 4);
    if (client.bodyBytes + bytes > share) throw tooMany();
    if (bodyBytes + bytes > limits.maxBodyBytes) throw busy();
    client.bodyBytes += bytes;
    bodyBytes += bytes;
  }

  function dropBody(client, bytes) {
    client.bodyBytes -= bytes;
    bodyBytes -= bytes;
  }

  /**
   * Answers 401 have a bucket of their own (GCRA again: `authFailures` at
   * once, then one per `authWindowMs / authFailures`). Throws 429 when the
   * client of `key` has none left; nothing is sent upstream then. Requests
   * already in flight may still add their answers (a few at most, see
   * clientConcurrency).
   */
  function checkAuth(key, limits) {
    if (!limits.authFailures) return;
    const now = Date.now();
    const client = clientState(key, now);
    const interval = limits.authWindowMs / limits.authFailures;
    const wait = Math.round(client.authTat - interval * (limits.authFailures - 1) - now);
    if (wait > 0) throw new ProxyError(429, 'rate-limited', 'Too many wrong passwords through the DAV proxy. Try again later.', wait);
  }

  /** Counts an answer 401 to a request of `client` that carried a password. */
  function noteAuthFailure(client, limits) {
    if (!limits.authFailures) return;
    client.authTat = Math.max(client.authTat, Date.now()) + limits.authWindowMs / limits.authFailures;
  }

  return { admit, release, holdBody, dropBody, checkAuth, noteAuthFailure };
}

/**
 * Reads the request body into memory. `hold(bytes)` counts what it keeps
 * against the body budget and throws a ProxyError when that is spent. With a
 * Content-Length the whole body is counted, and copied into one buffer of that
 * size, before the first byte arrives; without one each chunk is counted as it
 * comes, and the copy that joins them once more.
 */
function readBody(req, limit, signal, hold) {
  return new Promise((resolve, reject) => {
    // The caller knows why it gave up; this only has to stop waiting.
    if (signal.aborted) return reject();
    signal.addEventListener('abort', () => reject(), { once: true });
    let failed = false;
    const fail = (err) => {
      failed = true;
      reject(err);
      req.resume();
    };
    const declared = Number(req.headers['content-length']);
    const known = /^\d+$/.test(req.headers['content-length'] ?? '') && declared <= limit;
    let buffer = null;
    const chunks = [];
    let size = 0;
    try {
      if (known) {
        hold(declared);
        buffer = Buffer.allocUnsafe(declared);
      }
    } catch (err) {
      return fail(err);
    }
    req.on('data', (c) => {
      if (failed) return;
      if (size + c.length > (known ? declared : limit)) return fail(new ProxyError(413, 'too-large', 'Request body too large'));
      if (buffer) {
        c.copy(buffer, size);
      } else {
        try {
          hold(c.length);
        } catch (err) {
          return fail(err);
        }
        chunks.push(c);
      }
      size += c.length;
    });
    req.on('end', () => {
      if (failed) return;
      if (buffer) return resolve(buffer.subarray(0, size));
      if (chunks.length < 2) return resolve(chunks[0] ?? Buffer.alloc(0));
      try {
        hold(size);
      } catch (err) {
        return reject(err);
      }
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', reject);
  });
}

function sendError(res, err) {
  res.statusCode = err.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader(PROXY_ERROR_HEADER, '1');
  if (err.retryAfterMs !== undefined) res.setHeader('retry-after', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
  res.end(JSON.stringify({ error: err.message, code: err.code }));
}

/**
 * The proxy forwards credentials, so only the app itself may use it. Browsers
 * attach Sec-Fetch-Site / Origin to requests made by other sites; reject those.
 */
function isCrossSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter((h) => typeof h === 'string');
  return !hosts.some((h) => h.toLowerCase() === originHost.toLowerCase());
}

/**
 * DNS lookup that refuses private addresses. Passed to the socket so the
 * address that was checked is the one that gets connected to (no rebinding).
 */
function guardedLookup(allowPrivate, privateOnly) {
  return (hostname, options, callback) => {
    const opts = typeof options === 'object' && options ? options : {};
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length) return callback(Object.assign(new Error('No address'), { code: 'ENOTFOUND' }));
      if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
        return callback(Object.assign(new Error('Private address'), { code: 'EPRIVATEADDRESS' }));
      }
      // Plain http: carries the password in clear, so it stays on the private network.
      if (privateOnly && addresses.some((a) => !isPrivateAddress(a.address))) {
        return callback(Object.assign(new Error('Public address over http'), { code: 'EPUBLICHTTP' }));
      }
      if (opts.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// The lookup guard runs when a socket connects, not when a pooled one is
// reused. Sockets opened for a caller that may reach private addresses
// therefore live in a pool of their own and never serve anyone else; so do
// those opened for a password over plain http, which the guard keeps on the
// private network: a socket a feed request (no password) opened to a public
// address must not carry a password in clear afterwards. `timeout` only
// closes idle sockets, so the pools do not pile up connections to hosts
// that were contacted once.
const pool = () => ({
  'http:': new HttpAgent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4, timeout: 30_000 }),
  'https:': new HttpsAgent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4, timeout: 30_000 }),
});
const agents = { public: pool(), private: pool(), publicPrivateOnly: pool(), privatePrivateOnly: pool() };

/** Resolves with the upstream response as soon as its headers are in; the body is still to be read. */
function sendUpstream(targetUrl, { method, headers, body, allowPrivate, privateOnly, signal }) {
  return new Promise((resolve, reject) => {
    const request = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      targetUrl,
      {
        method,
        headers: body ? { ...headers, 'content-length': String(body.length) } : headers,
        agent: agents[`${allowPrivate ? 'private' : 'public'}${privateOnly ? 'PrivateOnly' : ''}`][targetUrl.protocol],
        lookup: guardedLookup(allowPrivate, privateOnly),
        signal,
      },
      resolve,
    );
    req.on('error', (err) => reject(Object.assign(err, { reusedSocket: req.reusedSocket })));
    // An answer this client cannot use (a protocol upgrade) ends without either.
    req.on('close', () => reject(Object.assign(new Error('Connection closed'), { code: 'ECONNRESET' })));
    req.end(body);
  });
}

/** Servers may close idle keep-alive sockets without notice; retry once then. */
async function forward(targetUrl, options) {
  try {
    return await sendUpstream(targetUrl, options);
  } catch (err) {
    if (err?.reusedSocket && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) return sendUpstream(targetUrl, options);
    throw err;
  }
}

/**
 * Streams the upstream body to the client instead of buffering it, so a large
 * calendar costs no memory here. Rejects when the upstream fails or sends
 * more than `limit` bytes; by then part of the answer may be on its way.
 */
function relayBody(upstream, res, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    upstream.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        upstream.destroy();
        reject(Object.assign(new Error('Response too large'), { code: 'ERESPONSETOOLARGE' }));
      } else if (!res.write(chunk)) {
        upstream.pause();
      }
    });
    res.on('drain', () => upstream.resume());
    upstream.on('end', () => {
      res.end();
      resolve();
    });
    upstream.on('error', reject);
    upstream.on('close', () => reject(Object.assign(new Error('Connection closed'), { code: 'ECONNRESET' })));
  });
}

/** Error codes come from Node or from here, but they are relayed, so keep them to plain identifiers. */
function errorCode(err) {
  const code = String(err?.code ?? err?.name ?? 'error');
  return /^[A-Za-z_]{1,40}$/.test(code) ? code : 'error';
}

/**
 * Builds a proxy with its own request budgets. `defaults` are options applied
 * to every request; see `handleDavProxy` for the per-request ones.
 */
export function createDavProxy(defaults = {}) {
  const limiter = createLimiter();
  let warnedAboutForwarding = false;

  async function relay(req, res, settings, entry, state) {
    if (!hostHeaderAllowed(req.headers.host, settings.publicHosts)) {
      throw new ProxyError(421, 'misdirected', 'This server does not answer proxy requests for that host name');
    }
    if (isCrossSite(req)) throw new ProxyError(403, 'cross-site', 'Cross-site requests to the proxy are not allowed');
    if (settings.disabled) throw new ProxyError(403, 'disabled', 'The DAV proxy is switched off on this server');

    const method = entry.method;
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return null;
    }
    if (!ALLOWED_METHODS.has(method)) throw new ProxyError(405, 'method', `Method ${method} is not supported by the proxy`);

    const target = req.headers[TARGET_HEADER];
    if (typeof target !== 'string' || !target) throw new ProxyError(400, 'target', `Missing ${TARGET_HEADER} header`);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      throw new ProxyError(400, 'target', 'Invalid target URL');
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      throw new ProxyError(400, 'target', 'Only http(s) targets are supported');
    }
    if (targetUrl.username || targetUrl.password) {
      throw new ProxyError(400, 'target', 'Credentials in the target URL are not supported');
    }
    entry.host = targetUrl.host;
    // An empty port is the scheme's default, 80 or 443.
    if (targetUrl.port && BAD_PORTS.has(Number(targetUrl.port))) {
      throw new ProxyError(403, 'port-not-allowed', `Port ${targetUrl.port} belongs to other protocols than DAV`);
    }

    // URL.hostname keeps the brackets of IPv6 literals.
    const hostname = targetUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const allowList = envHosts('CALENDAR_PROXY_ALLOW');
    const privateHosts = envHosts('CALENDAR_PROXY_PRIVATE_HOSTS');
    const listed = [...allowList, ...privateHosts];
    // Without a list the proxy would relay for anybody to anywhere, so that
    // has to be asked for.
    if (!listed.length && !settings.open) {
      throw new ProxyError(
        403,
        'host-not-allowed',
        `The DAV proxy of this server is not set up to reach any host: it needs CALENDAR_PROXY_ALLOW (or CALENDAR_PROXY_OPEN=true)`,
      );
    }
    if (!hostAllowed(hostname, listed)) {
      throw new ProxyError(403, 'host-not-allowed', `Host ${hostname} is not allowed by CALENDAR_PROXY_ALLOW`);
    }
    // A host the operator named exactly is trusted wherever it lives, if the
    // name is one only the operator's network answers for. A wildcard is not:
    // whoever may add a name under the zone could point it anywhere; nor is a
    // public name, whose DNS belongs to somebody else.
    const allowPrivate =
      privateHosts.includes(hostname) ||
      (allowList.includes(hostname) && isLocalName(hostname)) ||
      (settings.allowPrivate ?? envFlag('CALENDAR_PROXY_ALLOW_PRIVATE'));
    const privateAddress = () =>
      new ProxyError(
        403,
        'private-address',
        `${hostname} is on a private or local network, which the proxy does not reach by default. ` +
          'List the exact host in CALENDAR_PROXY_PRIVATE_HOSTS (or an address or local name in CALENDAR_PROXY_ALLOW) or set CALENDAR_PROXY_ALLOW_PRIVATE=true on the server.',
      );
    if (!allowPrivate && isIP(hostname) && isPrivateAddress(hostname)) throw privateAddress();
    // Plain http: with a password only on the private network, where it does
    // not cross the internet in clear (unless the operator allows it). For a
    // name the lookup decides, on the address that is connected to. Without
    // one (a feed) there is nothing to give away that the address does not.
    const privateOnly = targetUrl.protocol === 'http:' && carriesCredentials(req) && !envFlag('CALENDAR_PROXY_ALLOW_HTTP');
    const httpsRequired = () =>
      new ProxyError(400, 'https-required', `The proxy connects to ${hostname} only over HTTPS, so that the password is not sent unencrypted. Change the server address to https://.`);
    if (privateOnly && isIP(hostname) && !isPrivateAddress(hostname)) throw httpsRequired();
    if (Number(req.headers['content-length'] ?? 0) > MAX_REQUEST_BYTES) throw new ProxyError(413, 'too-large', 'Request body too large');

    const headers = {};
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    // From here on the request costs something, so it has to fit the client's
    // budget. Whatever is waiting stops as soon as the client goes away.
    const { limits } = settings;
    const credentials = carriesCredentials(req);
    if (credentials) limiter.checkAuth(clientKey(entry.client), limits);
    const abort = new AbortController();
    const onClose = () => {
      if (res.writableFinished) return;
      state.clientGone = true;
      abort.abort();
    };
    res.on('close', onClose);
    if (res.destroyed) onClose();
    const slot = await limiter.admit(clientKey(entry.client), limits, abort.signal);

    const deadline = setTimeout(() => {
      state.timedOut = true;
      abort.abort();
    }, limits.timeoutMs);
    let heldBytes = 0;
    const hold = (bytes) => {
      limiter.holdBody(slot, bytes, limits);
      heldBytes += bytes;
    };
    try {
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req, MAX_REQUEST_BYTES, abort.signal, hold);
      let upstream;
      try {
        upstream = await forward(targetUrl, { method, headers, body: body && body.length ? body : undefined, allowPrivate, privateOnly, signal: abort.signal });
      } catch (err) {
        if (err?.code === 'EPRIVATEADDRESS') throw privateAddress();
        throw err?.code === 'EPUBLICHTTP' ? httpsRequired() : err;
      }

      const status = upstream.statusCode ?? 502;
      if (status === 401 && credentials) limiter.noteAuthFailure(slot, limits);
      const declared = Number(upstream.headers['content-length']);
      if (declared > limits.maxResponseBytes) {
        upstream.destroy();
        throw Object.assign(new Error('Response too large'), { code: 'ERESPONSETOOLARGE' });
      }

      res.statusCode = status;
      res.setHeader(PROXY_RELAY_HEADER, '1');
      for (const name of FORWARD_RESPONSE_HEADERS) {
        const value = upstream.headers[name];
        if (typeof value === 'string' && value) res.setHeader(name, value);
      }
      // Redirects are surfaced to the client instead of followed so that the
      // client keeps its credentials and re-targets the request itself.
      const location = upstream.headers.location;
      if (typeof location === 'string' && location) {
        try {
          const next = new URL(location, targetUrl);
          if (next.protocol === 'http:' || next.protocol === 'https:') res.setHeader('x-dav-location', next.toString());
        } catch {
          /* unusable Location header */
        }
      }
      // WWW-Authenticate is deliberately dropped: forwarding it would make the
      // browser show its own basic-auth dialog instead of the app's error.
      res.setHeader('cache-control', 'no-store');
      // The body comes from a third party but is served from the app's origin:
      // make sure a browser never renders or executes it.
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "default-src 'none'; sandbox");

      if (method === 'HEAD') {
        upstream.resume();
        res.end();
        return status;
      }
      // With the length announced, the client notices an answer that was cut short.
      if (Number.isInteger(declared) && declared >= 0 && status !== 204 && status !== 304) res.setHeader('content-length', String(declared));
      await relayBody(upstream, res, limits.maxResponseBytes);
      return status;
    } finally {
      clearTimeout(deadline);
      limiter.dropBody(slot, heldBytes);
      limiter.release(slot);
    }
  }

  /**
   * Node `http` style handler. Resolves to true when the request was handled.
   * Options: `allowPrivate` overrides CALENDAR_PROXY_ALLOW_PRIVATE (dev
   * server), `disabled`, `trustProxy`, `limits` and `log` override their
   * environment variables.
   */
  return async function handleDavProxy(req, res, options = {}) {
    const path = (req.url ?? '').split('?')[0];
    if (path !== PROXY_PATH && path !== `${PROXY_PATH}/`) return false;

    const settings = resolveSettings({ ...defaults, ...options });
    const started = Date.now();
    const entry = { client: clientAddress(req, settings.trustProxy), method: (req.method ?? 'GET').toUpperCase(), host: '-' };
    const state = { clientGone: false, timedOut: false };
    if (!settings.trustProxy && !warnedAboutForwarding && req.headers['x-forwarded-for'] !== undefined) {
      warnedAboutForwarding = true;
      // Said once: the most likely reason for "everybody is throttled together".
      settings.log?.(
        'dav-proxy: a request carries X-Forwarded-For but CALENDAR_TRUST_PROXY is not set; behind a reverse proxy all clients share one request budget',
      );
    }

    let status;
    let failure = '';
    try {
      status = await relay(req, res, settings, entry, state);
      if (status === null) return true;
    } catch (cause) {
      let err = cause;
      if (!(err instanceof ProxyError)) {
        err = state.timedOut
          ? new ProxyError(504, 'timeout', 'The server did not answer in time')
          : new ProxyError(502, 'upstream', `Upstream request failed: ${errorCode(cause)}`);
      }
      if (state.clientGone && !state.timedOut) {
        status = CLIENT_CLOSED_REQUEST;
      } else if (res.headersSent) {
        // Part of the answer is out already; cutting the connection is the
        // only way left to tell the client that it is incomplete.
        status = res.statusCode;
        failure = ` error=${err.code}`;
        res.destroy();
      } else {
        status = err.status;
        sendError(res, err);
      }
    }
    // One line per request, and nothing in it that could hold a secret or say
    // what somebody keeps in their calendar: no path, query, header or body.
    settings.log?.(`dav-proxy client=${entry.client} method=${entry.method} host=${entry.host} status=${status} ms=${Date.now() - started}${failure}`);
    return true;
  };
}

export const handleDavProxy = createDavProxy();
