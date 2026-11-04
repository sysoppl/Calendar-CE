// The operator's privacy policy, terms of service and contact page: set when
// the app is built (server/publicConfig.mjs, `resolveLinks`) or, for a
// ready-made image, when the server starts, which writes them into the page
// (server/server.mjs, `linksInjector`). Each one is empty until it is set, and
// an empty one is not shown anywhere.

export interface AppLinks {
  privacy: string;
  terms: string;
  contact: string;
}

/** The meta tag the server writes its links into (LINKS_META in server/server.mjs). */
const LINKS_META = 'calendar-links';

/** The links the server wrote into the page; only http(s) and mailto: addresses count. */
export function servedLinks(doc: Pick<Document, 'querySelector'> | undefined = globalThis.document): Partial<AppLinks> {
  const content = doc?.querySelector(`meta[name="${LINKS_META}"]`)?.getAttribute('content');
  if (!content) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  const links: Partial<AppLinks> = {};
  if (!parsed || typeof parsed !== 'object') return links;
  for (const key of ['privacy', 'terms', 'contact'] as const) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value)) links[key] = value;
  }
  return links;
}

export const APP_LINKS: AppLinks = { ...__APP_LINKS__, ...servedLinks() };

/** Home of the app and of its maker, named in the copyright line. */
export const HOME_URL = 'https://patryk.pro';

/** The source code of this edition. */
export const SOURCE_URL = 'https://github.com/sysoppl/Calendar-CE';

/**
 * E2EE Calendar, the hosted edition by the same author: the same app with an
 * end-to-end encrypted cloud that syncs every device. Only ever linked to.
 */
export const CLOUD_URL = 'https://calendar.patryk.pro/?utm_source=calendar-community&utm_medium=app';

/** The legal links that are set, in the order they are shown. */
export function legalLinks(links: AppLinks = APP_LINKS): { key: 'privacy' | 'terms' | 'contact'; href: string }[] {
  return (['privacy', 'terms', 'contact'] as const).filter((key) => links[key]).map((key) => ({ key, href: links[key] }));
}
