// The app keeps its calendars up to date by itself; there is nothing to press.
//
// - A CalDAV server cannot tell: it is asked every 30 seconds while the app is
//   on screen. One cheap request per account when nothing changed.
// - Feeds are fetched again when their copy is older than 15 minutes
//   (`refreshSubscription` decides).
// - The moment the app comes back on screen, gets the focus, is resumed or the
//   connection returns, whatever was not asked for in the last 10 seconds is
//   asked for at once.
//
// Nothing runs while the app is hidden or the browser says it is offline.
// Failures that more requests would not mend (a wrong password, a refused or
// locked account) stop the asking until the account changes (a new password,
// another server), so that a server that counts failed sign-ins is never
// pushed into locking the user out; other failures make the account wait
// longer, up to 15 minutes, until one goes through or the connection returns.
import { App as CapApp } from '@capacitor/app';
import { isBackendError, type BackendErrorCode } from '@/lib/backend/types';
import { isNative } from '@/lib/platform';
import { useData, type Account } from '@/store/data';
import { useSyncStatus, watchConnectivity } from '@/store/syncStatus';

/** A CalDAV account is asked this often while the app is on screen. */
export const CALDAV_POLL_MS = 30_000;
/** An immediate trigger skips what was asked for less than this long ago. */
export const TRIGGER_GAP_MS = 10_000;
/** The longest wait after failures. */
export const BACKOFF_MAX_MS = 900_000;
/** A feed whose fetch failed is tried again after this, doubled per further failure. */
export const FEED_RETRY_MS = 60_000;
/** How often the schedule is looked at. */
export const TICK_MS = 5_000;

/** Failures that more requests would not mend; asking stops until the account changes. */
const STOP: BackendErrorCode[] = ['auth', 'forbidden', 'locked'];

interface Track {
  /** When it was last asked for. */
  lastAttempt: number;
  /** Failures in a row; each one doubles the wait. */
  failures: number;
  /** Set when a failure of `STOP` stopped the asking: what the account was then. */
  stoppedAt?: string;
}

const accounts = new Map<string, Track>();
const feeds = new Map<string, Track>();
let stopRunning: (() => void) | undefined;

const codeOf = (err: unknown): BackendErrorCode => (isBackendError(err) ? err.code : 'other');

/** What makes an account another one for the server: where, as whom, with which password. */
function fingerprint(a: Account): string {
  return JSON.stringify([a.kind, a.serverUrl, a.username, a.homeUrl, a.principalUrl, a.email, a.useProxy, a.passwordBox, a.password !== undefined]);
}

function remoteAccounts(): Account[] {
  return useData.getState().accounts.filter((a) => a.kind !== 'local');
}

function track(map: Map<string, Track>, id: string): Track {
  let t = map.get(id);
  if (!t) map.set(id, (t = { lastAttempt: -Infinity, failures: 0 }));
  return t;
}

/** Stopped by a failure that more requests would not mend, and nothing changed since. */
function stopped(a: Account): boolean {
  const t = accounts.get(a.id);
  return !!t?.stoppedAt && !!a.errorCode && STOP.includes(a.errorCode) && t.stoppedAt === fingerprint(a);
}

/** The wait between two syncs of an account, after `failures` failures in a row. */
function interval(failures: number): number {
  const base = CALDAV_POLL_MS;
  return Math.min(base * 2 ** Math.min(failures, 16), Math.max(base, BACKOFF_MAX_MS));
}

/** Whether anything should run now: on screen and, as far as the browser knows, online. */
function active(): boolean {
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return visible && useSyncStatus.getState().online;
}

/** Syncs one account and keeps count of how that went. Rejects with its failure. */
function attempt(a: Account, now: number): Promise<void> {
  const t = track(accounts, a.id);
  t.lastAttempt = now;
  const before = fingerprint(a);
  return useData
    .getState()
    .syncAccount(a.id)
    .then(
      () => {
        t.failures = 0;
        t.stoppedAt = undefined;
      },
      (err: unknown) => {
        const code = codeOf(err);
        if (STOP.includes(code)) t.stoppedAt = before;
        else t.failures++;
        throw err;
      },
    );
}

const quietly = (promise: Promise<unknown> | undefined) => void promise?.catch(() => {});

/** Fetches the feeds that are due: none tried within `gap`, or within their wait after failures. */
function refreshFeeds(now: number, gap?: number): Promise<void>[] {
  const { calendars, refreshSubscription } = useData.getState();
  const listed = calendars.filter((c) => c.subscriptionUrl);
  for (const id of feeds.keys()) if (!listed.some((c) => c.id === id)) feeds.delete(id);
  const jobs: Promise<void>[] = [];
  for (const cal of listed) {
    const t = track(feeds, cal.id);
    const wait = gap ?? Math.min(FEED_RETRY_MS * 2 ** Math.min(Math.max(t.failures - 1, 0), 16), BACKOFF_MAX_MS);
    if (now - t.lastAttempt < wait) continue;
    t.lastAttempt = now;
    jobs.push(
      refreshSubscription(cal.id).then(
        () => {
          t.failures = 0;
        },
        (err: unknown) => {
          t.failures++;
          throw err;
        },
      ),
    );
  }
  return jobs;
}

/** One look at the schedule: starts what is due. */
function tick(now = Date.now()): void {
  if (!active()) return;
  const { syncing } = useData.getState();
  for (const a of remoteAccounts()) {
    if (stopped(a) || syncing[a.id]) continue;
    const t = accounts.get(a.id);
    if (t && now - t.lastAttempt < interval(t.failures)) continue;
    quietly(attempt(a, now));
  }
  for (const job of refreshFeeds(now)) quietly(job);
}

/**
 * Back on screen, focused, resumed or online again: asks at once for what was
 * not asked for in the last `TRIGGER_GAP_MS`. `fresh` (the connection came
 * back) also forgets the failures that made accounts wait.
 */
function catchUp(fresh = false, now = Date.now()): void {
  if (fresh) {
    for (const t of accounts.values()) t.failures = 0;
    for (const t of feeds.values()) t.failures = 0;
  }
  if (!active()) return;
  for (const a of remoteAccounts()) {
    if (stopped(a)) continue;
    const t = accounts.get(a.id);
    if (t && now - t.lastAttempt < TRIGGER_GAP_MS) continue;
    quietly(attempt(a, now));
  }
  for (const job of refreshFeeds(now, TRIGGER_GAP_MS)) quietly(job);
}

/**
 * Starts the automatic sync, with a first round at once. Returns a function
 * that stops it. Starting again replaces the running one.
 */
export function startAutoSync(): () => void {
  stopRunning?.();
  accounts.clear();
  feeds.clear();
  const offConnectivity = watchConnectivity();
  const timer = setInterval(() => tick(), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState !== 'hidden') catchUp();
  };
  const onFocus = () => catchUp();
  const onOnline = () => {
    useSyncStatus.getState().setOnline(true);
    catchUp(true);
  };
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  const hasDocument = typeof document !== 'undefined' && typeof document.addEventListener === 'function';
  if (hasDocument) document.addEventListener('visibilitychange', onVisible);
  if (hasWindow) {
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
  }
  const resume = isNative ? CapApp.addListener('resume', onFocus) : undefined;
  catchUp();
  const stop = () => {
    clearInterval(timer);
    offConnectivity();
    if (hasDocument) document.removeEventListener('visibilitychange', onVisible);
    if (hasWindow) {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    }
    void resume?.then((handle) => handle.remove()).catch(() => {});
    if (stopRunning === stop) stopRunning = undefined;
  };
  stopRunning = stop;
  return stop;
}

/**
 * Brings every account and feed up to date now, whatever the schedule says
 * (the R key, "Try again"); an account stopped by a failure is asked again
 * too. Resolves quietly when everything went through; rejects with the first
 * failure otherwise.
 */
export async function refreshNow(): Promise<void> {
  const now = Date.now();
  const jobs: Promise<void>[] = [];
  for (const a of remoteAccounts()) {
    const t = track(accounts, a.id);
    t.failures = 0;
    t.stoppedAt = undefined;
    jobs.push(attempt(a, now));
  }
  jobs.push(...refreshFeeds(now, 0));
  const failed = (await Promise.allSettled(jobs)).find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
