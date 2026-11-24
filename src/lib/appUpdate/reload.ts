// The browser's app moving onto a newer version: when it may load the page
// again by itself, and the guard that keeps it from doing so in a loop.
//
// The page loads again by itself only once per newer version and tab. Should
// the new load still bring the old bundle (a cache between the browser and
// the site, a worker that hangs on), the lock stays with a button instead,
// which also clears the app shell's caches and takes the service worker away
// before it loads again. Nothing here touches what the app keeps of the
// user's (IndexedDB, localStorage): only the caches named `calendar-shell-*`
// and a mark in this tab's sessionStorage.

import { compareVersions } from './version';

/** What is open on the page, for deciding whether it may be loaded again without a word. */
export interface ReloadProbe {
  /** A dialog is open (an editor, a prompt, any `Modal`). */
  modalOpen: boolean;
  /** Something of the calendar that can hold unsaved input is open (editors, Settings, search, the event card…). */
  overlayOpen: boolean;
  /** The focus is in a field that takes text. */
  typing: boolean;
  /** A text field on the page holds something typed. */
  filled: boolean;
}

/** Whether nothing the user may be in the middle of would be lost by loading the page again. */
export function safeToReload(probe: ReloadProbe): boolean {
  return !probe.modalOpen && !probe.overlayOpen &&!probe.typing && !probe.filled;
}

/** Where this tab notes the version it loaded the page again for. */
export const RELOAD_MARK_KEY = 'calendar.appUpdate.reloadedFor';

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The version this tab loaded itself again for, if any. */
export function readReloadMark(session: SessionLike | null): string | null {
  try {
    const value = session?.getItem(RELOAD_MARK_KEY) ?? null;
    return typeof value === 'string' && value.length <= 20 ? value : null;
  } catch {
    return null;
  }
}

/** Notes that the page is being loaded again for `version`; false when it cannot be noted (then it must not load again by itself). */
export function writeReloadMark(session: SessionLike | null, version: string): boolean {
  try {
    if (!session) return false;
    session.setItem(RELOAD_MARK_KEY, version);
    return session.getItem(RELOAD_MARK_KEY) === version;
  } catch {
    return false;
  }
}

/** Forgets the mark once this copy is at least the version it was for. */
export function settleReloadMark(session: SessionLike | null, current: string): void {
  const mark = readReloadMark(session);
  if (mark === null || compareVersions(current, mark) < 0) return;
  try {
    session?.removeItem(RELOAD_MARK_KEY);
  } catch {
    // Harmless: it only ever holds a version this copy has reached.
  }
}

/**
 * What the browser's app does about a newer `latest`:
 * - 'reload': load the page again now, by itself;
 * - 'lock': show the lock, whose button loads it again.
 * It loads by itself only when nothing would be lost (`safe`), when this tab
 * did not do so for this version already (`mark`), and when it can note that
 * it did (`canMark`).
 */
export function webDecision(input: { latest: string; mark: string | null; safe: boolean; canMark: boolean }): 'reload' | 'lock' {
  if (input.mark === input.latest || !input.canMark || !input.safe) return 'lock';
  return 'reload';
}

/** The service worker's cache of the app shell (public/sw.js): `calendar-shell-<build>`. */
export const SHELL_CACHE_PREFIX = 'calendar-shell-';

export interface ShellPlatform {
  caches?: Pick<CacheStorage, 'keys' | 'delete'>;
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>;
}

/**
 * Takes the service worker and its app-shell caches away, so that the next
 * load comes from the site and nothing else. Other caches and every store of
 * the user's data stay. Never rejects.
 */
export async function dropAppShell(platform: ShellPlatform): Promise<void> {
  await Promise.all([
    (async () => {
      const keys = (await platform.caches?.keys()) ?? [];
      await Promise.all(keys.filter((key) => key.startsWith(SHELL_CACHE_PREFIX)).map((key) => platform.caches!.delete(key)));
    })().catch(() => {}),
    (async () => {
      const registrations = (await platform.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
    })().catch(() => {}),
  ]);
}

/** Asks the service worker to look for the newer one (it installs and takes over by itself: skipWaiting, clients.claim). Never rejects. */
export async function refreshWorker(platform: Pick<ShellPlatform, 'serviceWorker'>, timeoutMs = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  const work = (async () => {
    const registrations = (await platform.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.update()));
  })().catch(() => {});
  await Promise.race([work, waited]);
  clearTimeout(timer);
}
