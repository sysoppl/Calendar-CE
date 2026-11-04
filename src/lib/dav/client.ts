// A small, dependency-free CalDAV client (RFC 4791 / RFC 6578 subset).
import { t } from '@/i18n';
import { assertHttpUrl, basicAuth, crossOriginRedirect, DavHttpError, DavNetworkError, keepsCredentials, resolveRedirect, SUMMARY_SOURCE, type DavResponseRaw, type Transport } from './transport';
import { child, escapeXml, key, NS, okProp, parseMultistatus, text, type DavResponse } from './xml';

export type ComponentType = 'VEVENT' | 'VTODO' | 'VJOURNAL';

export interface DavCredentials {
  username: string;
  password: string;
}

export interface DiscoveryResult {
  principalUrl: string;
  homeUrl: string;
  displayName?: string;
  email?: string;
}

export interface RemoteCalendar {
  url: string;
  displayName: string;
  description?: string;
  color?: string;
  order?: number;
  components: ComponentType[];
  ctag?: string;
  syncToken?: string;
  readOnly: boolean;
}

export interface RemoteObjectRef {
  url: string;
  etag: string;
}

export interface RemoteObject extends RemoteObjectRef {
  data: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const MAX_REDIRECTS = 5;

const CALENDAR_PROPS = `
  <d:resourcetype/>
  <d:displayname/>
  <d:current-user-privilege-set/>
  <d:sync-token/>
  <cs:getctag/>
  <c:supported-calendar-component-set/>
  <c:calendar-description/>
  <ic:calendar-color/>
  <ic:calendar-order/>`;

const NSDECL = `xmlns:d="DAV:" xmlns:c="${NS.CALDAV}" xmlns:cs="${NS.CS}" xmlns:ic="${NS.APPLE}"`;

/** A server named an address the password must not go to. Trying elsewhere on that server does not help. */
export class DavAddressRefused extends DavNetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'DavAddressRefused';
  }
}

/**
 * Second-level labels under which a country's top-level domain takes
 * registrations (co.uk, com.pl, com.br): a domain registered there has three
 * labels. A stand-in for the public suffix list, which the app does not carry.
 */
const SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'gob', 'ltd', 'mil', 'net', 'ne', 'nom', 'or', 'org', 'plc', 'sch']);

/**
 * The registrable domain of a host, roughly: its last two labels, or three
 * under a country's second level (`SECOND_LEVEL_SUFFIXES`). An IP address or
 * a name of one label is itself.
 */
export function siteOf(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.includes(':') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return host;
  const labels = host.split('.');
  const country = labels.length > 2 && labels[labels.length - 1].length === 2 && SECOND_LEVEL_SUFFIXES.has(labels[labels.length - 2]);
  return labels.slice(-(country ? 3 : 2)).join('.');
}

/**
 * An address from a server's answer, resolved against the request it answers.
 * Every request carries the password, so what a server names gets the checks
 * a redirect gets: http(s) only, and never down from https to http. With
 * `typed`, the address the user entered, it may be on another host only of
 * the same site (the registrable domain, `siteOf`), as a provider's principal
 * or home on a host of its own is (pXX-caldav.icloud.com from caldav.icloud.com);
 * a server naming one elsewhere does not get the password sent there.
 */
function resolveHref(href: string, base: string, typed?: URL): URL {
  const from = new URL(base);
  let url: URL | undefined;
  try {
    url = new URL(href, from);
  } catch {
    // Reported below.
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new DavAddressRefused(t('dav.href.unsupported', { host: from.host }));
  if (from.protocol === 'https:' && url.protocol === 'http:') throw new DavAddressRefused(t('dav.href.downgrade', { host: from.host }));
  if (typed && url.hostname !== from.hostname && url.hostname !== typed.hostname && siteOf(url.hostname) !== siteOf(typed.hostname)) {
    throw new DavAddressRefused(t('dav.redirect.crossOrigin', { from: from.host, to: url.host }));
  }
  return url;
}

/**
 * The same for something inside a collection. One at another server than the
 * collection is left out: the password goes only where the user pointed the
 * app (discovery may move to another host once, as some providers' homes do).
 */
function hrefWithin(href: string, base: string): string | undefined {
  const url = resolveHref(href, base).toString();
  if (keepsCredentials(base, url)) return url;
  console.warn('Ignoring an address on another server', url);
  return undefined;
}

export function normalizeColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw.trim());
  return m ? `#${m[1].toLowerCase()}` : undefined;
}

export class CalDavClient {
  private readonly auth: string;

  constructor(
    private readonly transport: Transport,
    credentials: DavCredentials,
  ) {
    this.auth = basicAuth(credentials.username, credentials.password);
  }

  // ---------------------------------------------------------------------------
  // Low level

  async request(
    method: string,
    url: string,
    opts: { body?: string; headers?: Record<string, string>; depth?: '0' | '1' | 'infinity' } = {},
  ): Promise<DavResponseRaw & { url: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = { Authorization: this.auth, ...opts.headers };
      if (opts.depth) headers.Depth = opts.depth;
      if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/xml; charset=utf-8';
      const res = await this.transport({ method, url: current, headers, body: opts.body });
      if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
        const next = resolveRedirect(current, res.location);
        // Every request carries the password, so it stays where the user sent it.
        if (!keepsCredentials(current, next)) throw crossOriginRedirect(current, next);
        current = next;
        continue;
      }
      if (res.status === 401) throw new DavHttpError(401, t('dav.http.auth'), res.body);
      if (res.status === 403) throw new DavHttpError(403, t('dav.http.forbidden', { method, url: shownUrl(current) }), res.body);
      return { ...res, url: current };
    }
    throw new DavHttpError(310, t('dav.http.redirects'));
  }

  private async multistatus(method: string, url: string, body: string, depth: '0' | '1') {
    const res = await this.request(method, url, { body, depth });
    if (res.status !== 207) {
      throw new DavHttpError(res.status, t('dav.http.failed', { method, url: shownUrl(url), status: res.status }), res.body);
    }
    return { ...parseMultistatus(res.body), url: res.url };
  }

  // ---------------------------------------------------------------------------
  // Discovery

  /**
   * Finds the principal and calendar home starting from whatever URL the user
   * typed: a bare host, the server root, a principal or a calendar home.
   */
  async discover(serverUrl: string): Promise<DiscoveryResult> {
    const base = new URL(assertHttpUrl(serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`));
    const candidates = [
      base.toString(),
      new URL('/.well-known/caldav', base).toString(),
      new URL('/', base).toString(),
    ];

    let lastError: unknown;
    for (const candidate of [...new Set(candidates)]) {
      try {
        const principalUrl = await this.findPrincipal(candidate, base);
        if (!principalUrl) continue;
        const info = await this.principalInfo(principalUrl, base);
        if (info) return info;
      } catch (err) {
        if ((err instanceof DavHttpError && err.status === 401) || err instanceof DavAddressRefused) throw err;
        lastError = err;
      }
    }
    // The URL may itself be a calendar home (e.g. Radicale user collection).
    try {
      const cals = await this.listCalendars(base.toString());
      if (cals.length) return { principalUrl: base.toString(), homeUrl: base.toString() };
    } catch (err) {
      if ((err instanceof DavHttpError && err.status === 401) || err instanceof DavAddressRefused) throw err;
      lastError = err;
    }
    throw lastError instanceof Error ? lastError : new Error(t('dav.noService'));
  }

  private async findPrincipal(url: string, typed: URL): Promise<string | undefined> {
    const body = `${XML_HEADER}<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
    const ms = await this.multistatus('PROPFIND', url, body, '0');
    for (const r of ms.responses) {
      const href = text(child(okProp(r, key(NS.DAV, 'current-user-principal')), NS.DAV, 'href'));
      if (href) return resolveHref(href, ms.url, typed).toString();
    }
    return undefined;
  }

  private async principalInfo(principalUrl: string, typed: URL): Promise<DiscoveryResult | undefined> {
    const body = `${XML_HEADER}<d:propfind ${NSDECL}><d:prop>
      <c:calendar-home-set/><d:displayname/><c:calendar-user-address-set/>
    </d:prop></d:propfind>`;
    const ms = await this.multistatus('PROPFIND', principalUrl, body, '0');
    const r = ms.responses[0];
    if (!r) return undefined;
    const homeHref = text(child(okProp(r, key(NS.CALDAV, 'calendar-home-set')), NS.DAV, 'href'));
    if (!homeHref) return undefined;
    const addresses = Array.from(okProp(r, key(NS.CALDAV, 'calendar-user-address-set'))?.children ?? [])
      .map((el) => el.textContent?.trim() ?? '')
      .filter((s) => s.toLowerCase().startsWith('mailto:'));
    return {
      principalUrl: ms.url,
      homeUrl: resolveHref(homeHref, ms.url, typed).toString(),
      displayName: text(okProp(r, key(NS.DAV, 'displayname'))),
      email: addresses[0]?.slice(7),
    };
  }

  // ---------------------------------------------------------------------------
  // Calendars

  async listCalendars(homeUrl: string): Promise<RemoteCalendar[]> {
    const body = `${XML_HEADER}<d:propfind ${NSDECL}><d:prop>${CALENDAR_PROPS}</d:prop></d:propfind>`;
    const ms = await this.multistatus('PROPFIND', homeUrl, body, '1');
    return ms.responses
      .map((r) => toCalendar(r, ms.url))
      .filter((c): c is RemoteCalendar => !!c);
  }

  async getCalendar(url: string): Promise<RemoteCalendar | undefined> {
    const body = `${XML_HEADER}<d:propfind ${NSDECL}><d:prop>${CALENDAR_PROPS}</d:prop></d:propfind>`;
    const ms = await this.multistatus('PROPFIND', url, body, '0');
    return ms.responses.map((r) => toCalendar(r, ms.url)).find(Boolean);
  }

  async createCalendar(
    homeUrl: string,
    opts: { displayName: string; color?: string; components: ComponentType[]; description?: string },
  ): Promise<string> {
    const slug = `${crypto.randomUUID()}/`;
    const url = new URL(slug, homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`).toString();
    const comps = opts.components.map((c) => `<c:comp name="${c}"/>`).join('');
    const body = `${XML_HEADER}<c:mkcalendar ${NSDECL}><d:set><d:prop>
      <d:displayname>${escapeXml(opts.displayName)}</d:displayname>
      ${opts.color ? `<ic:calendar-color>${escapeXml(opts.color)}</ic:calendar-color>` : ''}
      ${opts.description ? `<c:calendar-description>${escapeXml(opts.description)}</c:calendar-description>` : ''}
      <c:supported-calendar-component-set>${comps}</c:supported-calendar-component-set>
    </d:prop></d:set></c:mkcalendar>`;
    const res = await this.request('MKCALENDAR', url, { body });
    if (res.status !== 201 && res.status !== 200) {
      throw new DavHttpError(res.status, t('dav.calendar.create', { status: res.status }), res.body);
    }
    return url;
  }

  async updateCalendar(url: string, patch: { displayName?: string; color?: string; description?: string }) {
    const props: string[] = [];
    if (patch.displayName !== undefined) props.push(`<d:displayname>${escapeXml(patch.displayName)}</d:displayname>`);
    if (patch.color !== undefined) props.push(`<ic:calendar-color>${escapeXml(patch.color)}</ic:calendar-color>`);
    if (patch.description !== undefined) {
      props.push(`<c:calendar-description>${escapeXml(patch.description)}</c:calendar-description>`);
    }
    if (!props.length) return;
    const body = `${XML_HEADER}<d:propertyupdate ${NSDECL}><d:set><d:prop>${props.join('')}</d:prop></d:set></d:propertyupdate>`;
    const res = await this.request('PROPPATCH', url, { body });
    if (res.status !== 207 && res.status !== 200) {
      throw new DavHttpError(res.status, t('dav.calendar.update', { status: res.status }), res.body);
    }
    if (res.status === 207) {
      const failed = parseMultistatus(res.body).responses.some((r) => r.propstats.some((p) => p.status >= 400));
      if (failed) throw new DavHttpError(res.status, t('dav.calendar.rejected'));
    }
  }

  async deleteCalendar(url: string) {
    const res = await this.request('DELETE', url);
    if (res.status >= 300 && res.status !== 404) {
      throw new DavHttpError(res.status, t('dav.calendar.delete', { status: res.status }), res.body);
    }
  }

  // ---------------------------------------------------------------------------
  // Objects

  /** Lists the href and etag of every calendar object in a collection. */
  async listObjects(calendarUrl: string): Promise<RemoteObjectRef[]> {
    const body = `${XML_HEADER}<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`;
    const ms = await this.multistatus('PROPFIND', calendarUrl, body, '1');
    const self = new URL(ms.url).pathname.replace(/\/?$/, '/');
    const out: RemoteObjectRef[] = [];
    for (const r of ms.responses) {
      const href = hrefWithin(r.href, ms.url);
      if (!href) continue;
      const url = new URL(href);
      if (url.pathname.replace(/\/?$/, '/') === self) continue;
      if (okProp(r, key(NS.DAV, 'resourcetype'))?.children.length) continue; // sub-collection
      const etag = text(okProp(r, key(NS.DAV, 'getetag')));
      if (etag) out.push({ url: url.toString(), etag });
    }
    return out;
  }

  /**
   * Incremental sync (RFC 6578). Returns changed objects and deleted hrefs, or
   * `null` when the token is no longer valid and a full resync is required.
   */
  async syncCollection(
    calendarUrl: string,
    syncToken: string,
  ): Promise<{ changed: RemoteObjectRef[]; deleted: string[]; syncToken?: string } | null> {
    const body = `${XML_HEADER}<d:sync-collection xmlns:d="DAV:">
      <d:sync-token>${escapeXml(syncToken)}</d:sync-token>
      <d:sync-level>1</d:sync-level>
      <d:prop><d:getetag/></d:prop>
    </d:sync-collection>`;
    const res = await this.request('REPORT', calendarUrl, { body, depth: '1' });
    if (res.status === 403 || res.status === 409 || res.status === 400 || res.status === 412) return null;
    if (res.status !== 207) throw new DavHttpError(res.status, t('dav.sync.failed', { status: res.status }), res.body);
    const ms = parseMultistatus(res.body);
    const changed: RemoteObjectRef[] = [];
    const deleted: string[] = [];
    for (const r of ms.responses) {
      const url = hrefWithin(r.href, res.url);
      if (!url) continue;
      if (r.status === 404 || r.propstats.every((p) => p.status === 404)) {
        deleted.push(url);
        continue;
      }
      const etag = text(okProp(r, key(NS.DAV, 'getetag')));
      if (etag) changed.push({ url, etag });
    }
    return { changed, deleted, syncToken: ms.syncToken };
  }

  /** Downloads calendar data for the given object URLs, in batches. */
  async multiget(calendarUrl: string, urls: string[], batchSize = 50): Promise<RemoteObject[]> {
    const out: RemoteObject[] = [];
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const hrefs = batch.map((u) => `<d:href>${escapeXml(new URL(u).pathname)}</d:href>`).join('');
      const body = `${XML_HEADER}<c:calendar-multiget xmlns:d="DAV:" xmlns:c="${NS.CALDAV}">
        <d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs}</c:calendar-multiget>`;
      try {
        const ms = await this.multistatus('REPORT', calendarUrl, body, '1');
        for (const r of ms.responses) {
          const data = text(okProp(r, key(NS.CALDAV, 'calendar-data')));
          const etag = text(okProp(r, key(NS.DAV, 'getetag')));
          const url = hrefWithin(r.href, ms.url);
          if (data && url) out.push({ url, etag: etag ?? '', data });
        }
      } catch (err) {
        if ((err instanceof DavHttpError && err.status === 401) || err instanceof DavAddressRefused) throw err;
        // Some servers lack multiget - fall back to plain GETs.
        for (const u of batch) {
          const obj = await this.getObject(u);
          if (obj) out.push(obj);
        }
      }
    }
    return out;
  }

  async getObject(url: string): Promise<RemoteObject | undefined> {
    const res = await this.request('GET', url, { headers: { Accept: 'text/calendar' } });
    if (res.status === 404) return undefined;
    if (res.status >= 300) throw new DavHttpError(res.status, t('dav.http.failed', { method: 'GET', url: shownUrl(url), status: res.status }), res.body);
    return { url: res.url, etag: res.headers.get('etag') ?? '', data: res.body };
  }

  /**
   * Stores an object and returns the new etag when the server sends one.
   * A create must not replace anything. An update checks the etag when there
   * is one; some servers never send etags, and their objects are overwritten
   * unconditionally rather than being impossible to change.
   */
  async putObject(url: string, data: string, mode: 'create' | 'update' = 'create', etag?: string): Promise<string | undefined> {
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
    if (mode === 'create') headers['If-None-Match'] = '*';
    else if (etag) headers['If-Match'] = etag;
    const res = await this.request('PUT', url, { body: data, headers });
    if (res.status === 412) throw new DavHttpError(412, t('dav.item.changed'), res.body);
    if (res.status >= 300) {
      throw new DavHttpError(res.status, t('dav.item.save', { status: res.status, detail: summarizeError(res.body) }), res.body);
    }
    return res.headers.get('etag') ?? undefined;
  }

  async deleteObject(url: string, etag?: string) {
    const headers: Record<string, string> = {};
    if (etag) headers['If-Match'] = etag;
    const res = await this.request('DELETE', url, { headers });
    if (res.status === 412) throw new DavHttpError(412, t('dav.item.changed'), res.body);
    if (res.status >= 300 && res.status !== 404) {
      throw new DavHttpError(res.status, t('dav.item.delete', { status: res.status }), res.body);
    }
  }
}

/**
 * A refused save's answer as one short line. Only its start is read: tags
 * are stripped with a pattern that is quadratic on a long run of '<' without
 * '>', and a server decides how long the answer is.
 */
export function summarizeError(body: string): string {
  const stripped = body.slice(0, SUMMARY_SOURCE).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 160) || t('dav.item.noDetails');
}

/** An address as an error message shows it: without a user name or password someone may have typed into it. */
function shownUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** The last part of a calendar's address, as a name for one that has none. */
function nameFromUrl(url: string): string {
  const last = url.split('/').filter(Boolean).pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    // A malformed escape is shown as it is, rather than failing the whole listing.
    return last;
  }
}

function toCalendar(r: DavResponse, base: string): RemoteCalendar | undefined {
  const rt = okProp(r, key(NS.DAV, 'resourcetype'));
  if (!rt || !child(rt, NS.CALDAV, 'calendar')) return undefined;

  const compSet = okProp(r, key(NS.CALDAV, 'supported-calendar-component-set'));
  let components: ComponentType[] = ['VEVENT', 'VTODO'];
  if (compSet) {
    const names = Array.from(compSet.children)
      .map((el) => el.getAttribute('name')?.toUpperCase())
      .filter((n): n is ComponentType => n === 'VEVENT' || n === 'VTODO' || n === 'VJOURNAL');
    if (names.length) components = names;
  }

  const privs = okProp(r, key(NS.DAV, 'current-user-privilege-set'));
  let readOnly = false;
  if (privs) {
    const granted = new Set(
      Array.from(privs.getElementsByTagNameNS(NS.DAV, 'privilege')).flatMap((p) =>
        Array.from(p.children).map((c) => c.localName),
      ),
    );
    readOnly = !(granted.has('all') || granted.has('write') || granted.has('write-content') || granted.has('bind'));
  }

  const url = hrefWithin(r.href, base);
  if (!url) return undefined;
  const order = Number(text(okProp(r, key(NS.APPLE, 'calendar-order'))));
  return {
    url,
    displayName: text(okProp(r, key(NS.DAV, 'displayname'))) ?? nameFromUrl(url),
    description: text(okProp(r, key(NS.CALDAV, 'calendar-description'))),
    color: normalizeColor(text(okProp(r, key(NS.APPLE, 'calendar-color')))),
    order: Number.isFinite(order) ? order : undefined,
    components,
    ctag: text(okProp(r, key(NS.CS, 'getctag'))),
    syncToken: text(okProp(r, key(NS.DAV, 'sync-token'))),
    readOnly,
  };
}
