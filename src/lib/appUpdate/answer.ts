// What the site says about the newest version (`/version.json`, written by
// the build: scripts/version-file.mjs), read so that a broken or hostile
// answer can at worst say "unknown". Nothing of it is ever rendered as markup,
// followed as an address or run: only one version number is taken, a plain
// "major.minor.patch" (`parseVersion`).

import { parseVersion } from './version';

/** The site's word on the newest version. */
export interface VersionAnswer {
  /**
   * The version the site itself runs: what the browser's app updates to, and
   * what the Android app built with VITE_UPDATE_URL compares itself with.
   */
  version: string;
}

/** Longer answers are not read: the real one is some 40 characters. */
export const MAX_ANSWER_CHARS = 1024;

/**
 * The answer in `text`, or null when it is not one: not JSON (a login page of
 * a public Wi-Fi, an error page), not an object, no plain `version`, or too
 * long. Other keys are left alone, for later.
 */
export function readVersionAnswer(text: unknown): VersionAnswer | null {
  if (typeof text !== 'string' || text.length > MAX_ANSWER_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  const version = parseVersion(answer.version);
  return version ? { version } : null;
}

export interface FetchVersionOptions {
  fetch?: typeof fetch;
  /** How long the answer may take before it counts as none. */
  timeoutMs?: number;
}

/** The default wait for the answer. */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * Asks `url` for the answer. Nothing identifying goes with the request: no
 * cookies or other credentials, no referrer, no cache (neither the browser's
 * nor, since the service worker leaves this file alone, the app's), no
 * redirect followed. Resolves to null on any failure, never rejects.
 */
export async function fetchVersionAnswer(url: string, options: FetchVersionOptions = {}): Promise<VersionAnswer | null> {
  const get = options.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!get) return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => abort?.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const res = await get(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
      signal: abort?.signal,
    });
    if (!res.ok || res.status !== 200 || res.redirected) return null;
    const length = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAX_ANSWER_CHARS) return null;
    // The time limit covers the body as well.
    return readVersionAnswer(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
