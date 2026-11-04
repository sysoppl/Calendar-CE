// Addresses set when the app is built (server/publicConfig.mjs, `resolveLinks`):
// the operator's privacy policy, terms of service and contact page. Each one
// is empty until it is set, and an empty one is not shown anywhere.

export interface AppLinks {
  privacy: string;
  terms: string;
  contact: string;
}

export const APP_LINKS: AppLinks = __APP_LINKS__;

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
