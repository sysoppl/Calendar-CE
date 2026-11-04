import { createServer, request, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Socket, type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clientAddress,
  createDavProxy,
  handleDavProxy,
  hostAllowed,
  isLocalName,
  hostHeaderAllowed,
  isPrivateAddress,
  proxyNotices,
  publicHosts,
  type DavProxyHandler,
  type DavProxyOptions,
} from './davProxy.mjs';

/** Two made-up public names: one whose DNS answer points at this machine, one with a public answer. */
const { REBOUND, PUBLIC_NAME, dnsCalls } = vi.hoisted(() => ({
  REBOUND: 'dav.rebound.example',
  PUBLIC_NAME: 'dav.public.example',
  dnsCalls: [] as string[],
}));

vi.mock('node:dns', async (importOriginal) => {
  const dns = await importOriginal<typeof import('node:dns')>();
  const answers: Record<string, string> = { [REBOUND]: '127.0.0.1', [PUBLIC_NAME]: '8.8.8.8', 'feed.public.example': '8.8.8.8', 'plain.public.example': '8.8.8.8' };
  const lookup = (hostname: string, options: object, callback: (err: Error | null, addresses: { address: string; family: number }[]) => void) => {
    if (!(hostname in answers)) return (dns.lookup as (...args: unknown[]) => void)(hostname, options, callback);
    dnsCalls.push(hostname);
    callback(null, [{ address: answers[hostname], family: 4 }]);
  };
  return { ...dns, lookup, default: { ...dns, lookup } };
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::7f00:1',
    '2002:7f00:1::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'fec0::1',
    '100::1',
    '2001:db8::1',
    // IPv4-translated (SIIT) and other forms outside public unicast.
    '::ffff:0:7f00:1',
    '::ffff:0:a00:1',
    '::ffff:ffff:7f00:1',
    '4000::1',
    'c000::1',
    // Documentation ranges and the retired 6to4 relay.
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.88.99.1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '2001:67c:2e8:22::c100:68b', '2620:fe::fe', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('hostAllowed', () => {
  it('matches exact hosts and wildcards', () => {
    expect(hostAllowed('dav.example.com', [])).toBe(true);
    expect(hostAllowed('dav.example.com', ['dav.example.com'])).toBe(true);
    expect(hostAllowed('a.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('evilexample.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('example.com.evil.org', ['example.com'])).toBe(false);
  });
});

describe('isLocalName', () => {
  it('is true for addresses, names without a dot and local-only suffixes', () => {
    for (const host of ['192.168.1.10', '::1', 'radicale', 'nas', 'nas.local', 'dav.lan', 'dav.home.arpa', 'dav.corp.internal', 'app.localhost', 'NAS.LAN.']) {
      expect(isLocalName(host), host).toBe(true);
    }
  });

  it('is false for names in somebody else\'s public zone', () => {
    for (const host of ['caldav.fastmail.com', 'dav.mailbox.org', 'posteo.de', 'local.example.com', 'lan.example.org', 'dav.internal.example.com']) {
      expect(isLocalName(host), host).toBe(false);
    }
  });
});

describe('proxyNotices', () => {
  const app = { VITE_APP_URL: 'https://calendar.example.com' };

  it('says when the proxy reaches nothing, everything or is off, and nothing when it has a list', () => {
    expect(proxyNotices(app)).toEqual([expect.stringMatching(/refuses every target \(since 1\.2\.0; before, an empty list meant any public host\)/)]);
    expect(proxyNotices({ ...app, CALENDAR_PROXY_ALLOW: ' ' })).toEqual([expect.stringMatching(/refuses every target/)]);
    expect(proxyNotices({ ...app, CALENDAR_PROXY_OPEN: 'true' })).toEqual([expect.stringMatching(/^dav-proxy: warning: .*any public host/)]);
    expect(proxyNotices({ CALENDAR_PROXY_DISABLED: 'true', CALENDAR_PROXY_OPEN: 'true' })).toEqual(['dav-proxy: switched off (CALENDAR_PROXY_DISABLED)']);
    expect(proxyNotices({ ...app, CALENDAR_PROXY_ALLOW: '*.icloud.com,radicale,192.168.1.10,nas.lan' })).toEqual([]);
    expect(proxyNotices({ ...app, CALENDAR_PROXY_PRIVATE_HOSTS: 'dav.home.example', CALENDAR_PROXY_OPEN: 'true' })).toEqual([]);
  });

  it('names the exact dotted names of the list that no longer open a private network', () => {
    // A list of public providers' names is fine, and said once at start.
    expect(proxyNotices({ ...app, CALENDAR_PROXY_ALLOW: 'caldav.fastmail.com,*.icloud.com,dav.mailbox.org,posteo.de' })).toEqual([
      'dav-proxy: these exact names in CALENDAR_PROXY_ALLOW reach public addresses only, not a private network (since 1.2.0): caldav.fastmail.com, dav.mailbox.org, posteo.de; list a server of your own network by such a name in CALENDAR_PROXY_PRIVATE_HOSTS instead',
    ]);
    // Neither a name also listed as private, nor any when the private network is open to all.
    expect(proxyNotices({ ...app, CALENDAR_PROXY_ALLOW: 'dav.home.example', CALENDAR_PROXY_PRIVATE_HOSTS: 'dav.home.example' })).toEqual([]);
    expect(proxyNotices({ ...app, CALENDAR_PROXY_ALLOW: 'dav.home.example', CALENDAR_PROXY_ALLOW_PRIVATE: 'true' })).toEqual([]);
  });

  it('says which Host names are answered when none is configured', () => {
    expect(proxyNotices({ CALENDAR_PROXY_ALLOW: 'radicale' })).toEqual([
      'dav-proxy: neither CALENDAR_PUBLIC_HOSTS nor VITE_APP_URL is set, so the proxy answers only for localhost, IP addresses and local names; name the host this server is reached by in CALENDAR_PUBLIC_HOSTS',
    ]);
    expect(proxyNotices({ CALENDAR_PROXY_ALLOW: 'radicale', CALENDAR_PUBLIC_HOSTS: 'cal.home.example' })).toEqual([]);
  });
});

describe('Host check', () => {
  it('knows the hosts from CALENDAR_PUBLIC_HOSTS and VITE_APP_URL, or the app\'s default address', () => {
    // The Docker image's runtime may lack VITE_APP_URL: then the address the bundle defaults to, not any name.
    expect(publicHosts({})).toEqual(['localhost']);
    expect(publicHosts({ VITE_APP_URL: ' ' })).toEqual(['localhost']);
    expect(publicHosts({ CALENDAR_PUBLIC_HOSTS: 'cal.home.example' })).toEqual(['cal.home.example']);
    // A public setting the server would refuse to start with.
    expect(publicHosts({ VITE_APP_URL: 'not an address' })).toBeNull();
    expect(publicHosts({ VITE_APP_URL: 'https://calendar.example.com' })).toEqual(['calendar.example.com']);
    expect(publicHosts({ VITE_APP_URL: 'https://calendar.example.com', CALENDAR_PUBLIC_HOSTS: 'Cal.Example.com, *.example.org' })).toEqual([
      'cal.example.com',
      '*.example.org',
      'calendar.example.com',
    ]);
  });

  it('answers the app\'s own names, addresses and local names only', () => {
    const hosts = ['calendar.example.com', '*.example.org'];
    for (const host of ['calendar.example.com', 'CALENDAR.EXAMPLE.COM.', 'calendar.example.com:443', 'a.example.org', '127.0.0.1:8787', '[::1]:8787', '192.168.1.5', 'localhost:5173', 'calendar-box:8787', 'nas.lan']) {
      expect(hostHeaderAllowed(host, hosts), host).toBe(true);
    }
    for (const host of ['rebind.evil.example', 'rebind.evil.example:8787', 'calendar.example.com.evil.example', '', undefined]) {
      expect(hostHeaderAllowed(host, hosts), String(host)).toBe(false);
    }
    expect(hostHeaderAllowed('rebind.evil.example', null)).toBe(true);
  });
});

describe('clientAddress', () => {
  const from = (remoteAddress: string | undefined, forwarded?: string) =>
    ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as unknown as IncomingMessage;

  it('is the peer address unless reverse proxies are trusted', () => {
    expect(clientAddress(from('198.51.100.4', '203.0.113.9'))).toBe('198.51.100.4');
    expect(clientAddress(from('198.51.100.4', '203.0.113.9'), 0)).toBe('198.51.100.4');
    expect(clientAddress(from('::ffff:198.51.100.4'))).toBe('198.51.100.4');
    expect(clientAddress(from('2001:DB8::1%eth0'))).toBe('2001:db8::1');
    expect(clientAddress(from(undefined))).toBe('unknown');
  });

  it('counts trusted hops from the right, where a client cannot forge entries', () => {
    expect(clientAddress(from('10.0.0.1', '203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientAddress(from('10.0.0.1', '1.2.3.4, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientAddress(from('10.0.0.1', '1.2.3.4, 203.0.113.9, 10.0.0.2'), 2)).toBe('203.0.113.9');
    // Fewer entries than hops: the request skipped a proxy, take what there is.
    expect(clientAddress(from('10.0.0.1', '203.0.113.9'), 2)).toBe('203.0.113.9');
  });

  it('understands the forms proxies write and ignores everything else', () => {
    expect(clientAddress(from('10.0.0.1', '203.0.113.9:4711'), 1)).toBe('203.0.113.9');
    expect(clientAddress(from('10.0.0.1', '[2001:db8::7]:4711'), 1)).toBe('2001:db8::7');
    expect(clientAddress(from('10.0.0.1', ' ::ffff:203.0.113.9 '), 1)).toBe('203.0.113.9');
    expect(clientAddress(from('10.0.0.1', 'unknown'), 1)).toBe('10.0.0.1');
    expect(clientAddress(from('10.0.0.1', 'x\r\ny=1'), 1)).toBe('10.0.0.1');
    expect(clientAddress(from('10.0.0.1'), 1)).toBe('10.0.0.1');
  });
});

describe('handleDavProxy', () => {
  let upstream: Server;
  let proxy: Server;
  let upstreamUrl: string;
  let upstreamPort: number;
  let proxyPort: number;
  let seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }[] = [];
  /** Responses the upstream keeps open until a test lets go of them. */
  let held: ServerResponse[] = [];
  let logs: string[] = [];
  /** Requests that have reached the proxy. */
  let arrived = 0;
  let proxyOptions: DavProxyOptions = {};
  let proxyHandler: DavProxyHandler = handleDavProxy;

  const BIG = Buffer.alloc(3 * 1024 * 1024, 'calendar ');
  const log = (line: string) => logs.push(line);

  const listen = (server: Server) =>
    new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  /** A port on this machine that nothing listens on. */
  const closedPort = async () => {
    const server = createServer();
    const port = await listen(server);
    await new Promise((resolve) => server.close(resolve));
    return port;
  };

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
        const path = (req.url ?? '').split('?')[0];
        if (path === '/redirect') {
          res.writeHead(302, { location: 'file:///etc/passwd' });
          return res.end();
        }
        if (path === '/unauthorized') {
          res.writeHead(401, { 'www-authenticate': 'Basic realm="dav"' });
          return res.end();
        }
        if (path === '/hold') {
          held.push(res);
          return;
        }
        if (path === '/big') {
          res.writeHead(200, { 'content-type': 'text/calendar', 'content-length': BIG.length });
          return res.end(BIG);
        }
        if (path === '/big-chunked') {
          res.writeHead(200, { 'content-type': 'text/calendar' });
          for (let at = 0; at < BIG.length; at += 65536) res.write(BIG.subarray(at, at + 65536));
          return res.end();
        }
        if (path === '/cut') {
          // Announces more than it sends, then drops the connection.
          res.writeHead(200, { 'content-type': 'text/calendar', 'content-length': 1000 });
          res.write('BEGIN:VCALENDAR');
          setTimeout(() => res.destroy(), 20);
          return;
        }
        res.writeHead(207, { 'content-type': 'text/html', etag: '"abc"', 'set-cookie': 'a=b', 'www-authenticate': 'Basic' });
        res.end('<multistatus/>');
      });
    });
    proxy = createServer((req, res) => {
      arrived++;
      void proxyHandler(req, res, { log, ...proxyOptions }).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end('static');
        }
      });
    });
    upstreamPort = await listen(upstream);
    upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
    proxyPort = await listen(proxy);
  });

  afterAll(() => {
    upstream.closeAllConnections();
    proxy.closeAllConnections();
    upstream.close();
    proxy.close();
  });

  afterEach(() => {
    for (const res of held) res.destroy();
    held = [];
    seen = [];
    logs = [];
    arrived = 0;
    dnsCalls.length = 0;
    proxyOptions = {};
    proxyHandler = handleDavProxy;
    delete process.env.CALENDAR_PROXY_ALLOW;
    delete process.env.CALENDAR_PROXY_PRIVATE_HOSTS;
    delete process.env.CALENDAR_PROXY_OPEN;
    delete process.env.CALENDAR_PROXY_ALLOW_PRIVATE;
    delete process.env.CALENDAR_PROXY_ALLOW_HTTP;
    delete process.env.CALENDAR_PROXY_DISABLED;
    delete process.env.CALENDAR_PROXY_BURST;
    delete process.env.CALENDAR_PROXY_RATE;
  });

  interface CallOptions {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  }
  interface CallResult {
    status: number;
    headers: IncomingHttpHeaders;
    body: string;
  }

  /** Sends a request to the proxy; `result` rejects when the connection breaks. */
  function open(opts: CallOptions): { req: ClientRequest; result: Promise<CallResult> } {
    let req!: ClientRequest;
    const result = new Promise<CallResult>((resolve, reject) => {
      req = request(
        { host: '127.0.0.1', port: proxyPort, path: opts.path ?? '/dav-proxy', method: opts.method ?? 'PROPFIND', headers: opts.headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(opts.body);
    });
    return { req, result };
  }

  const call = (opts: CallOptions) => open(opts).result;
  const target = (path = '/') => ({ 'x-dav-target': `${upstreamUrl}${path}` });
  /** A request as it arrives through a reverse proxy that saw `address`. */
  const fromClient = (address: string, path = '/') => ({ ...target(path), 'x-forwarded-for': address });
  const errorOf = (res: CallResult) => JSON.parse(res.body) as { error: string; code: string };

  it('reaches no host until it is told which ones', async () => {
    const res = await call({ headers: { 'x-dav-target': 'https://dav.example.com/' } });
    expect(res.status).toBe(403);
    expect(res.headers['x-dav-proxy-error']).toBe('1');
    expect(errorOf(res).code).toBe('host-not-allowed');
    expect(errorOf(res).error).toContain('CALENDAR_PROXY_OPEN');
    // The dev server's loopback callers are trusted with everything.
    proxyOptions = { allowPrivate: true };
    expect((await call({ headers: target() })).status).toBe(207);
    proxyOptions = { allowPrivate: true, open: false };
    expect((await call({ headers: target() })).status).toBe(403);
  });

  it('answers only requests addressed to this server, not to a name rebound to it', async () => {
    proxyOptions = { allowPrivate: true, publicHosts: ['calendar.example.com'] };
    // A page on rebind.evil.example whose name now points here is same-origin with itself.
    const rebound = await call({ headers: { ...target(), host: 'rebind.evil.example:8787', 'sec-fetch-site': 'same-origin' } });
    expect(rebound.status).toBe(421);
    expect(rebound.headers['x-dav-proxy-error']).toBe('1');
    expect(errorOf(rebound).code).toBe('misdirected');
    expect(seen).toHaveLength(0);
    expect((await call({ headers: { ...target(), host: 'calendar.example.com', 'sec-fetch-site': 'same-origin' } })).status).toBe(207);
    // As the reverse proxy or a LAN browser addresses it.
    expect((await call({ headers: target() })).status).toBe(207);
    process.env.VITE_APP_URL = 'https://calendar.example.com';
    proxyOptions = { allowPrivate: true };
    try {
      expect((await call({ headers: { ...target(), host: 'rebind.evil.example' } })).status).toBe(421);
    } finally {
      delete process.env.VITE_APP_URL;
    }
    // Neither is set (the Docker image's runtime): the app's default address, not any name.
    expect(process.env.VITE_APP_URL ?? process.env.CALENDAR_PUBLIC_HOSTS).toBeUndefined();
    expect((await call({ headers: { ...target(), host: 'rebind.evil.example' } })).status).toBe(421);
    expect((await call({ headers: { ...target(), host: 'calendar.example.com' } })).status).toBe(421);
    expect((await call({ headers: { ...target(), host: 'localhost:8787' } })).status).toBe(207);
  });

  it('refuses private targets by default', async () => {
    process.env.CALENDAR_PROXY_OPEN = 'true';
    const res = await call({ headers: { 'x-dav-target': `${upstreamUrl}/` } });
    expect(res.status).toBe(403);
    expect(res.headers['x-dav-proxy-error']).toBe('1');
    expect(errorOf(res).code).toBe('private-address');
    expect(seen).toHaveLength(0);
  });

  it('refuses names that resolve to private addresses', async () => {
    process.env.CALENDAR_PROXY_OPEN = 'true';
    const port = new URL(upstreamUrl).port;
    const res = await call({ headers: { 'x-dav-target': `http://localhost:${port}/` } });
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('private-address');
    expect(seen).toHaveLength(0);
  });

  it.each(['http://[::1]:8080/', 'http://[::ffff:127.0.0.1]:8080/', 'http://169.254.169.254/latest/meta-data/', 'http://2130706433:8080/', 'http://0x7f.1:8080/'])(
    'refuses %s',
    async (target) => {
      process.env.CALENDAR_PROXY_OPEN = 'true';
      const res = await call({ headers: { 'x-dav-target': target } });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('private-address');
    },
  );

  it('does not let an exactly listed public name open the private network', async () => {
    // A provider's name whose DNS answer points into this network.
    process.env.CALENDAR_PROXY_ALLOW = `${REBOUND}, dav.example.com`;
    const res = await call({ headers: { 'x-dav-target': `https://${REBOUND}:${upstreamPort}/` } });
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('private-address');
    expect(seen).toHaveLength(0);
    // The operator can still say that this name lives on the private network.
    process.env.CALENDAR_PROXY_ALLOW = '';
    process.env.CALENDAR_PROXY_PRIVATE_HOSTS = REBOUND;
    expect((await call({ headers: { 'x-dav-target': `http://${REBOUND}:${upstreamPort}/` } })).status).toBe(207);
    expect((await call({ headers: { 'x-dav-target': 'https://dav.example.com/' } })).status).toBe(403);
  });

  it('sends a password over plain http only to the private network', async () => {
    process.env.CALENDAR_PROXY_ALLOW = `${PUBLIC_NAME},198.18.0.1,8.8.8.8`;
    for (const target of [`http://${PUBLIC_NAME}/cal/`, 'http://8.8.8.8/cal/']) {
      const res = await call({ headers: { 'x-dav-target': target, authorization: 'Basic dXNlcjpwYXNz' } });
      expect(res.status, target).toBe(400);
      expect(res.headers['x-dav-proxy-error']).toBe('1');
      expect(errorOf(res).code).toBe('https-required');
    }
    expect(dnsCalls).toEqual([PUBLIC_NAME]);
    // Private servers (here the test's own) keep working over http.
    process.env.CALENDAR_PROXY_ALLOW = '127.0.0.1';
    expect((await call({ headers: target() })).status).toBe(207);
    process.env.CALENDAR_PROXY_ALLOW = 'localhost';
    expect((await call({ headers: { 'x-dav-target': `http://localhost:${upstreamPort}/` } })).status).toBe(207);
  });

  it('lets a request without a password go over plain http to a public host (a feed)', async () => {
    // Where the request may go is decided by the lookup guard; past it, no connection
    // leaves this machine: the test notes what the guard said and closes the socket.
    const FEED = 'feed.public.example';
    const guard: string[] = [];
    const realConnect = Socket.prototype.connect;
    const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...args: unknown[]) {
      type Options = { host?: string; lookup?: (host: string, opts: object, cb: (err: (Error & { code?: string }) | null) => void) => void };
      // net.createConnection hands over its normalised arguments, [options, callback].
      const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
      const options = first && typeof first === 'object' ? (first as Options) : undefined;
      if (options?.host !== FEED) return (realConnect as (...a: unknown[]) => Socket).apply(this, args);
      // As a real connect does: what the request writes waits for the connection.
      (this as unknown as { connecting: boolean }).connecting = true;
      options.lookup!(FEED, {}, (err) => {
        guard.push(err?.code ?? 'passed');
        setImmediate(() => this.destroy(err ?? Object.assign(new Error('stopped by the test'), { code: 'ETESTSTOPPED' })));
      });
      return this;
    });
    try {
      process.env.CALENDAR_PROXY_ALLOW = FEED;
      const plain = await call({ method: 'GET', headers: { 'x-dav-target': `http://${FEED}/cal.ics` } });
      expect(plain.status).toBe(502);
      expect(errorOf(plain).code).toBe('upstream');
      expect(guard).toEqual(['passed']);
      // With a password it is refused, before a byte goes out.
      const withPassword = await call({ method: 'GET', headers: { 'x-dav-target': `http://${FEED}/cal.ics`, authorization: 'Basic dXNlcjpwYXNz' } });
      expect(withPassword.status).toBe(400);
      expect(errorOf(withPassword).code).toBe('https-required');
      expect(guard).toEqual(['passed', 'EPUBLICHTTP']);
      // An address given directly: refused with a password at once, let through without one.
      process.env.CALENDAR_PROXY_ALLOW = '8.8.8.8';
      expect(errorOf(await call({ method: 'GET', headers: { 'x-dav-target': 'http://8.8.8.8/cal.ics', authorization: 'Basic eA==' } })).code).toBe('https-required');
    } finally {
      connect.mockRestore();
    }
  });

  it('forwards to private targets when explicitly enabled', async () => {
    process.env.CALENDAR_PROXY_OPEN = 'true';
    process.env.CALENDAR_PROXY_ALLOW_PRIVATE = 'true';
    const res = await call({
      headers: { 'x-dav-target': `${upstreamUrl}/cal/`, authorization: 'Basic eA==', depth: '1', cookie: 'session=1' },
      body: '<propfind/>',
    });
    expect(res.status).toBe(207);
    expect(res.body).toBe('<multistatus/>');
    expect(res.headers.etag).toBe('"abc"');
    expect(seen[0].method).toBe('PROPFIND');
    expect(seen[0].body).toBe('<propfind/>');
    expect(seen[0].headers.authorization).toBe('Basic eA==');
    expect(seen[0].headers.depth).toBe('1');
    // Only DAV headers travel upstream, and nothing sensitive comes back.
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['www-authenticate']).toBeUndefined();
    // Third-party content must never render on the app's origin.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['cache-control']).toBe('no-store');
    // What the DAV server said is marked as such, the proxy's own answers are not.
    expect(res.headers['x-dav-proxy-relay']).toBe('1');
    expect(res.headers['x-dav-proxy-error']).toBeUndefined();
  });

  it('marks its own answers and the relayed ones apart', async () => {
    proxyOptions = { allowPrivate: true };
    const relayed = await call({ method: 'GET', headers: target('/redirect') });
    expect(relayed.headers['x-dav-proxy-relay']).toBe('1');
    const own = await call({ headers: { 'x-dav-target': `http://127.0.0.1:${await closedPort()}/` } });
    expect(own.status).toBe(502);
    expect(own.headers['x-dav-proxy-error']).toBe('1');
    expect(own.headers['x-dav-proxy-relay']).toBeUndefined();
  });

  it('lets allow-listed hosts live on a private network, and nothing else', async () => {
    process.env.CALENDAR_PROXY_ALLOW = '127.0.0.1';
    expect((await call({ headers: { 'x-dav-target': `${upstreamUrl}/` } })).status).toBe(207);
    const refused = await call({ headers: { 'x-dav-target': 'https://example.com/' } });
    expect(refused.status).toBe(403);
    expect(errorOf(refused).code).toBe('host-not-allowed');
  });

  it('opens private networks to hosts listed by name, not to a whole zone', async () => {
    const named = { 'x-dav-target': `http://localhost:${upstreamPort}/` };
    // Anybody who can add a name under a listed zone could point it at this machine.
    process.env.CALENDAR_PROXY_ALLOW = '*.localhost';
    const refused = await call({ headers: named });
    expect(refused.status).toBe(403);
    expect(errorOf(refused).code).toBe('private-address');
    expect(seen).toHaveLength(0);
    process.env.CALENDAR_PROXY_ALLOW = 'dav.example.com, localhost';
    expect((await call({ headers: named })).status).toBe(207);
  });

  it.each(['http://127.0.0.1:25/', 'http://127.0.0.1:6667/', 'https://127.0.0.1:22/', 'http://127.0.0.1:110/'])(
    'never connects to a port browsers keep for other protocols: %s',
    async (target) => {
      proxyOptions = { allowPrivate: true };
      process.env.CALENDAR_PROXY_ALLOW = '127.0.0.1';
      const res = await call({ method: 'PUT', headers: { 'x-dav-target': target }, body: 'HELO relay.example\r\nQUIT\r\n' });
      expect(res.status).toBe(403);
      expect(res.headers['x-dav-proxy-error']).toBe('1');
      expect(errorOf(res).code).toBe('port-not-allowed');
    },
  );

  it('honours the allowPrivate option of the dev server', async () => {
    proxyOptions = { allowPrivate: true };
    expect((await call({ headers: { 'x-dav-target': `${upstreamUrl}/` } })).status).toBe(207);
  });

  it('rejects cross-site callers', async () => {
    proxyOptions = { allowPrivate: true };
    const target = { 'x-dav-target': `${upstreamUrl}/` };
    expect((await call({ headers: { ...target, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call({ headers: { ...target, 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    expect((await call({ headers: { ...target, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(seen).toHaveLength(0);
    expect((await call({ headers: { ...target, 'sec-fetch-site': 'same-origin' } })).status).toBe(207);
    expect((await call({ headers: { ...target, origin: `http://127.0.0.1:${proxyPort}` } })).status).toBe(207);
  });

  it('validates method, target and path', async () => {
    proxyOptions = { allowPrivate: true };
    expect((await call({ method: 'POST', headers: { 'x-dav-target': `${upstreamUrl}/` } })).status).toBe(405);
    expect((await call({ headers: {} })).status).toBe(400);
    expect((await call({ headers: { 'x-dav-target': 'file:///etc/passwd' } })).status).toBe(400);
    expect((await call({ headers: { 'x-dav-target': 'http://user:pw@127.0.0.1/' } })).status).toBe(400);
    expect((await call({ headers: { 'x-dav-target': 'nonsense' } })).status).toBe(400);
    // Only the exact path belongs to the proxy.
    expect((await call({ path: '/dav-proxy-other', headers: { 'x-dav-target': `${upstreamUrl}/` } })).body).toBe('static');
    expect(seen).toHaveLength(0);
  });

  it('drops redirects to non-http locations', async () => {
    proxyOptions = { allowPrivate: true };
    const res = await call({ method: 'GET', headers: { 'x-dav-target': `${upstreamUrl}/redirect` } });
    expect(res.status).toBe(302);
    expect(res.headers['x-dav-location']).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
  });

  it('limits the request body size', async () => {
    proxyOptions = { allowPrivate: true };
    const res = await call({
      method: 'PUT',
      headers: { 'x-dav-target': `${upstreamUrl}/big.ics` },
      body: 'x'.repeat(10 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('reports unreachable servers without leaking details', async () => {
    proxyOptions = { allowPrivate: true };
    const res = await call({ headers: { 'x-dav-target': `http://127.0.0.1:${await closedPort()}/` } });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/^Upstream request failed: [A-Z_a-z]+$/);
  });

  it('can be switched off', async () => {
    process.env.CALENDAR_PROXY_DISABLED = '1';
    proxyOptions = { allowPrivate: true };
    const res = await call({ headers: target() });
    expect(res.status).toBe(403);
    expect(res.headers['x-dav-proxy-error']).toBe('1');
    expect(errorOf(res)).toEqual({ error: 'The DAV proxy is switched off on this server', code: 'disabled' });
    expect((await call({ method: 'OPTIONS' })).status).toBe(403);
    expect(seen).toHaveLength(0);
    // Everything else on the server keeps working.
    expect((await call({ path: '/', headers: target() })).body).toBe('static');
  });

  describe('responses', () => {
    it('relays a large answer intact, with its length', async () => {
      proxyOptions = { allowPrivate: true };
      const declared = await call({ method: 'GET', headers: target('/big') });
      expect(declared.status).toBe(200);
      expect(declared.headers['content-length']).toBe(String(BIG.length));
      expect(declared.body).toBe(BIG.toString());
      const chunked = await call({ method: 'GET', headers: target('/big-chunked') });
      expect(chunked.headers['content-length']).toBeUndefined();
      expect(chunked.body).toBe(BIG.toString());
    });

    it('answers HEAD without a body', async () => {
      proxyOptions = { allowPrivate: true };
      const res = await call({ method: 'HEAD', headers: target('/big') });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/calendar');
      expect(res.body).toBe('');
    });

    it('refuses an answer that announces more than the limit', async () => {
      proxyHandler = createDavProxy({ allowPrivate: true, limits: { maxResponseBytes: 1000 } });
      const res = await call({ method: 'GET', headers: target('/big') });
      expect(res.status).toBe(502);
      expect(errorOf(res)).toEqual({ error: 'Upstream request failed: ERESPONSETOOLARGE', code: 'upstream' });
    });

    it('cuts the connection when an answer outgrows the limit or breaks off', async () => {
      proxyHandler = createDavProxy({ allowPrivate: true, limits: { maxResponseBytes: 100_000 } });
      // The status is out by then, so a clean error is no longer possible;
      // what matters is that the client does not take the part for the whole.
      await expect(call({ method: 'GET', headers: target('/big-chunked') })).rejects.toThrow();
      await expect(call({ method: 'GET', headers: target('/cut') })).rejects.toThrow();
      await vi.waitFor(() => expect(logs).toHaveLength(2));
      expect(logs[0]).toMatch(/ status=200 ms=\d+ error=upstream$/);
      expect(logs[1]).toMatch(/ status=200 ms=\d+ error=upstream$/);
      // The proxy is still in working order.
      expect((await call({ headers: target() })).status).toBe(207);
    });

    it('gives up on a server that does not answer in time', async () => {
      proxyHandler = createDavProxy({ allowPrivate: true, limits: { timeoutMs: 80 } });
      const res = await call({ headers: target('/hold') });
      expect(res.status).toBe(504);
      expect(errorOf(res).code).toBe('timeout');
    });
  });

  describe('socket pools', () => {
    it('never hands a socket opened for a privileged caller to anyone else', async () => {
      // A name, not a literal address: the name is only checked when a socket
      // connects, so a pooled socket would skip the check.
      const named = { 'x-dav-target': `http://localhost:${upstreamPort}/` };
      proxyOptions = { allowPrivate: true };
      expect((await call({ headers: named })).status).toBe(207);
      expect((await call({ headers: named })).status).toBe(207);
      proxyOptions = {};
      process.env.CALENDAR_PROXY_OPEN = 'true';
      const res = await call({ headers: named });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('private-address');
      expect(seen).toHaveLength(2);
    });

    it('never lets a password over plain http ride a socket a feed request opened to a public address', async () => {
      // The name answers with a public address, which the lookup guard sees;
      // the socket itself is connected to the test's server.
      const PLAIN = 'plain.public.example';
      const guard: string[] = [];
      const realConnect = Socket.prototype.connect;
      const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...args: unknown[]) {
        type Options = { host?: string; port?: number; lookup?: (host: string, opts: object, cb: (err: (Error & { code?: string }) | null) => void) => void };
        const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
        const options = first && typeof first === 'object' ? (first as Options) : undefined;
        if (options?.host !== PLAIN) return (realConnect as (...a: unknown[]) => Socket).apply(this, args);
        (this as unknown as { connecting: boolean }).connecting = true;
        options.lookup!(PLAIN, {}, (err) => {
          guard.push(err?.code ?? 'passed');
          setImmediate(() => {
            if (err) this.destroy(err);
            else (realConnect as (...a: unknown[]) => Socket).call(this, { port: upstreamPort, host: '127.0.0.1' });
          });
        });
        return this;
      });
      try {
        process.env.CALENDAR_PROXY_ALLOW = PLAIN;
        const url = `http://${PLAIN}:${upstreamPort}/cal.ics`;
        expect((await call({ method: 'GET', headers: { 'x-dav-target': url } })).status).toBe(207);
        expect((await call({ method: 'GET', headers: { 'x-dav-target': url } })).status).toBe(207);
        expect(guard).toEqual(['passed']);
        // The kept-alive socket of the feed requests is not reused: a new one is checked, and refused.
        const withPassword = await call({ method: 'GET', headers: { 'x-dav-target': url, authorization: 'Basic dXNlcjpwYXNz' } });
        expect(withPassword.status).toBe(400);
        expect(errorOf(withPassword).code).toBe('https-required');
        expect(guard).toEqual(['passed', 'EPUBLICHTTP']);
        expect(seen).toHaveLength(2);
        expect(seen.every((r) => r.headers.authorization === undefined)).toBe(true);
      } finally {
        connect.mockRestore();
      }
    });
  });

  describe('request budgets', () => {
    const limited = (limits: DavProxyOptions['limits'], options: DavProxyOptions = {}) =>
      createDavProxy({ allowPrivate: true, trustProxy: 1, ...options, limits: { maxWaitMs: 0, ...limits } });

    it('turns a client away once its bucket is empty', async () => {
      proxyHandler = limited({ burst: 2, ratePerMinute: 1 });
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
      const res = await call({ headers: fromClient('203.0.113.1') });
      expect(res.status).toBe(429);
      expect(res.headers['x-dav-proxy-error']).toBe('1');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(errorOf(res).code).toBe('rate-limited');
      expect(seen).toHaveLength(2);
      // Other clients have their own bucket.
      expect((await call({ headers: fromClient('203.0.113.2') })).status).toBe(207);
    });

    it('turns away the passwords of a client that got too many answers 401, before they reach the server', async () => {
      proxyHandler = limited({ ratePerMinute: 0, authFailures: 3, authWindowMs: 60_000 });
      const wrong = (address: string) => ({ ...fromClient(address, '/unauthorized'), authorization: 'Basic eDp5' });
      for (let i = 0; i < 3; i++) expect((await call({ headers: wrong('203.0.113.1') })).status).toBe(401);
      const res = await call({ headers: wrong('203.0.113.1') });
      expect(res.status).toBe(429);
      expect(res.headers['x-dav-proxy-error']).toBe('1');
      expect(errorOf(res).code).toBe('rate-limited');
      // One of the three comes back after a third of the window.
      expect(Number(res.headers['retry-after'])).toBe(20);
      expect(seen).toHaveLength(3);
      // Without a password (a feed) the client goes on, and other clients have their own budget.
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
      expect((await call({ headers: wrong('203.0.113.2') })).status).toBe(401);
      // Answers other than 401 cost nothing.
      proxyHandler = limited({ ratePerMinute: 0, authFailures: 1 });
      for (let i = 0; i < 3; i++) expect((await call({ headers: { ...fromClient('203.0.113.3'), authorization: 'Basic eDp5' } })).status).toBe(207);
    });

    it('counts answers 401 to 20 in 10 minutes by default, or as the environment says', async () => {
      proxyHandler = limited({ ratePerMinute: 0 });
      const wrong = { ...fromClient('203.0.113.1', '/unauthorized'), authorization: 'Basic eDp5' };
      for (let i = 0; i < 20; i++) expect((await call({ headers: wrong })).status).toBe(401);
      const res = await call({ headers: wrong });
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBe(30);
      process.env.CALENDAR_PROXY_AUTH_FAILURES = '0';
      try {
        proxyHandler = limited({ ratePerMinute: 0 });
        for (let i = 0; i < 25; i++) expect((await call({ headers: wrong })).status).toBe(401);
      } finally {
        delete process.env.CALENDAR_PROXY_AUTH_FAILURES;
      }
    });

    it('reads the limits from the environment', async () => {
      process.env.CALENDAR_PROXY_BURST = '1';
      process.env.CALENDAR_PROXY_RATE = '1';
      proxyHandler = createDavProxy({ allowPrivate: true, limits: { maxWaitMs: 0 } });
      expect((await call({ headers: target() })).status).toBe(207);
      expect((await call({ headers: target() })).status).toBe(429);
      process.env.CALENDAR_PROXY_RATE = '0';
      expect((await call({ headers: target() })).status).toBe(207);
    });

    it('treats an IPv6 /64 as one client', async () => {
      proxyHandler = limited({ burst: 1, ratePerMinute: 1 });
      expect((await call({ headers: fromClient('2001:db8:1:2::1') })).status).toBe(207);
      expect((await call({ headers: fromClient('2001:db8:1:2:ffff::9') })).status).toBe(429);
      expect((await call({ headers: fromClient('2001:db8:1:3::1') })).status).toBe(207);
    });

    it('does not believe X-Forwarded-For unless told to', async () => {
      proxyHandler = limited({ burst: 1, ratePerMinute: 1 }, { trustProxy: 0 });
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
      // A made-up address does not buy a fresh bucket...
      expect((await call({ headers: fromClient('203.0.113.2') })).status).toBe(429);
      // ...and the operator is told once why everybody shares one.
      expect(logs.filter((line) => line.includes('CALENDAR_TRUST_PROXY'))).toHaveLength(1);
      expect(logs.filter((line) => line.includes('client=127.0.0.1 '))).toHaveLength(2);
    });

    it('makes a client wait for its next token instead of failing', async () => {
      // One token every 100 ms.
      proxyHandler = limited({ burst: 1, ratePerMinute: 600, maxWaitMs: 5000 });
      const started = Date.now();
      const all = await Promise.all([1, 2, 3].map(() => call({ headers: fromClient('203.0.113.1') })));
      expect(all.map((res) => res.status)).toEqual([207, 207, 207]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    });

    it('runs one request per client at a time when capped so', async () => {
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 1, maxWaitMs: 5000 });
      const first = call({ headers: fromClient('203.0.113.1', '/hold') });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const second = call({ headers: fromClient('203.0.113.1', '/second') });
      // Another client is not held up by the first one's queue.
      expect((await call({ headers: fromClient('203.0.113.2', '/other') })).status).toBe(207);
      expect(seen.map((r) => r.url)).toEqual(['/hold', '/other']);
      held[0].end('late');
      expect((await first).body).toBe('late');
      expect((await second).status).toBe(207);
      expect(seen.map((r) => r.url)).toEqual(['/hold', '/other', '/second']);
    });

    it('turns a client away when its own requests block it for too long', async () => {
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 1, maxWaitMs: 40 });
      const first = call({ headers: fromClient('203.0.113.1', '/hold') });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const res = await call({ headers: fromClient('203.0.113.1') });
      expect(res.status).toBe(429);
      expect(errorOf(res).code).toBe('rate-limited');
      held[0].end();
      expect((await first).status).toBe(200);
      // The slot is free again.
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
    });

    it('turns a client away when too many of its requests wait already', async () => {
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 1, maxWaitMs: 20_000 });
      const first = call({ headers: fromClient('203.0.113.1', '/hold') });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      // Eight per request it may run stand in line behind the one that is running.
      const inLine = Array.from({ length: 8 }, () => call({ headers: fromClient('203.0.113.1') }));
      await vi.waitFor(() => expect(arrived).toBe(9));
      const started = Date.now();
      const res = await call({ headers: fromClient('203.0.113.1') });
      expect(res.status).toBe(429);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(seen).toHaveLength(1);
      // Somebody else still gets through, and so does the line once it moves.
      expect((await call({ headers: fromClient('203.0.113.2') })).status).toBe(207);
      held[0].end();
      await first;
      expect((await Promise.all(inLine)).every((r) => r.status === 207)).toBe(true);
    });

    it('gives each client a smaller share of the line once it fills, so a few cannot take all of it', async () => {
      // Room for 16 waiting requests: from 4 on, a client may have 2 (a quarter of its 8) waiting.
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 1, concurrency: 1, maxWaitMs: 20_000, maxParked: 16 });
      const first = call({ headers: fromClient('203.0.113.1', '/hold') });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const waiting = Array.from({ length: 4 }, () => call({ headers: fromClient('203.0.113.1') }));
      await vi.waitFor(() => expect(arrived).toBe(5));
      // The line is a quarter full: the busy client is told to slow down...
      const own = await call({ headers: fromClient('203.0.113.1') });
      expect(own.status).toBe(429);
      expect(errorOf(own).code).toBe('rate-limited');
      // ...while everybody else still gets a place, until they have their smaller share too.
      for (const address of ['203.0.113.2', '203.0.113.3']) {
        waiting.push(call({ headers: fromClient(address) }), call({ headers: fromClient(address) }));
      }
      await vi.waitFor(() => expect(arrived).toBe(10));
      expect((await call({ headers: fromClient('203.0.113.2') })).status).toBe(429);
      expect(seen).toHaveLength(1);
      held[0].end();
      await first;
      expect((await Promise.all(waiting)).every((r) => r.status === 207)).toBe(true);
    });

    it('caps the request bodies held in memory overall', async () => {
      const MiB = 1024 * 1024;
      proxyHandler = limited({ ratePerMinute: 0, maxBodyBytes: 3 * MiB });
      const put = (address: string, path: string, size: number, headers: Record<string, string> = {}) =>
        call({ method: 'PUT', headers: { ...fromClient(address, path), ...headers }, body: 'x'.repeat(size) });
      const first = put('203.0.113.1', '/hold', 2 * MiB);
      await vi.waitFor(() => expect(held).toHaveLength(1));
      // Another 2 MiB do not fit beside the first, with or without a length...
      for (const headers of [{}, { 'transfer-encoding': 'chunked' }] as Record<string, string>[]) {
        const res = await put('203.0.113.2', '/two', 2 * MiB, headers);
        expect(res.status).toBe(503);
        expect(errorOf(res).code).toBe('busy');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      }
      // ...but a calendar object of a few KiB does.
      expect((await put('203.0.113.2', '/small', 4096)).status).toBe(207);
      held[0].end();
      await first;
      // Released with the request that held it.
      expect((await put('203.0.113.2', '/two', 2 * MiB)).status).toBe(207);
      expect(seen.map((r) => r.url)).toEqual(['/hold', '/small', '/two']);
      expect(seen[2].body).toHaveLength(2 * MiB);
    });

    it('gives one client a quarter of the body budget', async () => {
      const MiB = 1024 * 1024;
      proxyHandler = limited({ ratePerMinute: 0, maxBodyBytes: 48 * MiB });
      const put = (address: string, path: string) => call({ method: 'PUT', headers: fromClient(address, path), body: 'x'.repeat(8 * MiB) });
      const first = put('203.0.113.1', '/hold');
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const own = await put('203.0.113.1', '/again');
      expect(own.status).toBe(429);
      expect(errorOf(own).code).toBe('rate-limited');
      expect((await put('203.0.113.2', '/other')).status).toBe(207);
      held[0].end();
      await first;
    });

    it('caps the requests in flight overall', async () => {
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 4, concurrency: 1, maxWaitMs: 40 });
      const first = call({ headers: fromClient('203.0.113.1', '/hold') });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const res = await call({ headers: fromClient('203.0.113.2') });
      expect(res.status).toBe(503);
      expect(errorOf(res).code).toBe('busy');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(seen).toHaveLength(1);
      held[0].end();
      await first;
    });

    it('frees the slot of a client that hangs up', async () => {
      proxyHandler = limited({ ratePerMinute: 0, clientConcurrency: 1, maxWaitMs: 5000 });
      const gone = open({ headers: fromClient('203.0.113.1', '/hold') });
      gone.result.catch(() => {});
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const waiting = open({ headers: fromClient('203.0.113.1', '/hold') });
      waiting.result.catch(() => {});
      await vi.waitFor(() => expect(arrived).toBe(2));
      const hangUps = () => logs.filter((line) => line.includes('status=499'));
      // One is upstream, one waits in line; both go away, the waiting one first.
      waiting.req.destroy();
      await vi.waitFor(() => expect(hangUps()).toHaveLength(1));
      gone.req.destroy();
      await vi.waitFor(() => expect(hangUps()).toHaveLength(2));
      // The one in line never went upstream.
      expect(held).toHaveLength(1);
      expect((await call({ headers: fromClient('203.0.113.1') })).status).toBe(207);
    });
  });

  describe('log', () => {
    it('writes one line per request with client, host and status only', async () => {
      proxyOptions = { allowPrivate: true };
      await call({
        method: 'REPORT',
        headers: { 'x-dav-target': `${upstreamUrl}/private/calendar-name/?token=s3cret`, authorization: 'Basic dXNlcjpwYXNz' },
        body: '<calendar-query>birthday</calendar-query>',
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(new RegExp(`^dav-proxy client=127\\.0\\.0\\.1 method=REPORT host=127\\.0\\.0\\.1:${upstreamPort} status=207 ms=\\d+$`));
    });

    it('covers refused requests too', async () => {
      await call({ headers: { 'x-dav-target': 'http://169.254.169.254/latest/meta-data/?x=1' } });
      await call({ headers: { 'x-dav-target': 'not a url' } });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatch(/^dav-proxy client=127\.0\.0\.1 method=PROPFIND host=169\.254\.169\.254 status=403 ms=\d+$/);
      expect(logs[1]).toMatch(/^dav-proxy client=127\.0\.0\.1 method=PROPFIND host=- status=400 ms=\d+$/);
    });

    it('names the forwarded client when the reverse proxy is trusted', async () => {
      proxyOptions = { allowPrivate: true, trustProxy: 1 };
      await call({ headers: fromClient('198.51.100.7, 203.0.113.9') });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain(' client=203.0.113.9 ');
    });

    it('can be silenced', async () => {
      proxyOptions = { allowPrivate: true, log: false };
      expect((await call({ headers: target() })).status).toBe(207);
      expect(logs).toHaveLength(0);
    });
  });
});
