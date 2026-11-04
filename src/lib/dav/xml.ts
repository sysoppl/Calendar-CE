// Namespace-aware helpers for WebDAV multistatus XML.
import { t } from '@/i18n';

export const NS = {
  DAV: 'DAV:',
  CALDAV: 'urn:ietf:params:xml:ns:caldav',
  CS: 'http://calendarserver.org/ns/',
  APPLE: 'http://apple.com/ns/ical/',
} as const;

/** Clark notation key, e.g. `{DAV:}displayname`. */
export type PropKey = string;

export const key = (ns: string, local: string): PropKey => `{${ns}}${local}`;

export interface DavPropstat {
  status: number;
  props: Map<PropKey, Element>;
}

export interface DavResponse {
  href: string;
  /** Status for responses that carry no propstat (e.g. 404 in sync reports). */
  status?: number;
  propstats: DavPropstat[];
}

export interface Multistatus {
  responses: DavResponse[];
  syncToken?: string;
}

export function parseStatus(line: string | null | undefined): number {
  const m = /HTTP\/[\d.]+\s+(\d{3})/i.exec(line ?? '');
  return m ? Number(m[1]) : 0;
}

function children(el: Element, ns: string, local: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

export function child(el: Element | undefined | null, ns: string, local: string): Element | undefined {
  if (!el) return undefined;
  return children(el, ns, local)[0];
}

export function text(el: Element | undefined | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(t('dav.xml.invalid', { detail: err.textContent?.slice(0, 200) ?? '' }));
  return doc;
}

export function parseMultistatus(xml: string): Multistatus {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (!(root.namespaceURI === NS.DAV && root.localName === 'multistatus')) {
    throw new Error(t('dav.xml.unexpected', { detail: root.localName.slice(0, 100) }));
  }
  const responses: DavResponse[] = [];
  for (const r of children(root, NS.DAV, 'response')) {
    const href = text(child(r, NS.DAV, 'href'));
    if (!href) continue;
    const propstats: DavPropstat[] = [];
    for (const ps of children(r, NS.DAV, 'propstat')) {
      const status = parseStatus(text(child(ps, NS.DAV, 'status')));
      const props = new Map<PropKey, Element>();
      const prop = child(ps, NS.DAV, 'prop');
      if (prop) {
        for (const p of Array.from(prop.children)) {
          props.set(key(p.namespaceURI ?? '', p.localName), p);
        }
      }
      propstats.push({ status, props });
    }
    const statusEl = child(r, NS.DAV, 'status');
    responses.push({
      href: canonicalHref(href),
      status: statusEl ? parseStatus(text(statusEl)) : undefined,
      propstats,
    });
  }
  return { responses, syncToken: text(child(root, NS.DAV, 'sync-token')) };
}

/** Returns the property element from the first 2xx propstat. */
export function okProp(r: DavResponse, k: PropKey): Element | undefined {
  for (const ps of r.propstats) {
    if (ps.status >= 200 && ps.status < 300) {
      const el = ps.props.get(k);
      if (el) return el;
    }
  }
  return undefined;
}

/** Characters that are legal unescaped in a path segment (RFC 3986 pchar). */
const KEEP_UNESCAPED = /%(40|3A|21|24|26|27|28|29|2A|2B|2C|3B|3D)/gi;

/**
 * Servers differ in whether hrefs are percent-encoded ("a@b.ics" vs
 * "a%40b.ics"). Every URL used as a key goes through this function so that
 * PROPFIND results, REPORT results and locally built URLs compare equal.
 * Only the path is rewritten: the scheme and host of an absolute URL are not
 * path segments (an IPv6 host such as [::1] would not survive the encoding).
 */
export function canonicalHref(href: string): string {
  const absolute = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/is.exec(href);
  const [origin, path] = absolute ? [absolute[1], absolute[2]] : ['', href];
  try {
    return (
      origin +
      path
        .split('/')
        .map((seg) => encodeURIComponent(decodeURIComponent(seg)).replace(KEEP_UNESCAPED, (m) => decodeURIComponent(m)))
        .join('/')
    );
  } catch {
    return href;
  }
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}
