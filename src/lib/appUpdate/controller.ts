// Keeps every copy of the app on the newest version: once a newer one is
// known, the whole app is locked until it is updated
// (src/components/update/AppUpdateLock.tsx). What "known" means depends on
// the channel (./channel.ts):
// - the browser asks its own server's /version.json and loads the page again,
//   by itself where nothing would be lost (./reload.ts), else from the lock;
// - the Android app, only when it was built with VITE_UPDATE_URL and
//   VITE_ANDROID_URL, asks that server's /version.json and links the download.
// It asks when it starts, when the app comes back to the front or the
// connection returns (at most once a `gapMs`), and every `intervalMs`.
// Without an answer nothing changes: a device that is offline, or a server
// that answers with something else than a version, never locks, and a lock
// stays until a well-formed answer says that this is the newest version.
//
// The lock never costs what the person is in the middle of. While something
// is open that can hold input, or work runs that must not be cut off
// (`safeToReload`), the app is not locked: a small notice says that the new
// version follows once that is saved or closed (`waiting`), and the moment
// it is (`watchSafety`, no polling) the app locks and, in the browser, loads
// the new version. So that the lock cannot be put off for good, it comes
// anyway after `graceMs` (10 minutes) of waiting: covered by the lock, what
// is open stays as it was and work under way goes on; only the lock's
// button loads the page again, and it does so by itself once that is safe.
// Reminders the Android app has scheduled keep firing; only the screen is locked.

import { create } from 'zustand';
import type { VersionAnswer } from './answer';
import type { UpdateChannel } from './channel';
import { dropAppShell, readReloadMark, refreshWorker, settleReloadMark, webDecision, writeReloadMark, type ShellPlatform } from './reload';
import { isNewer } from './version';

export interface AppUpdateState {
  channel: UpdateChannel;
  /** A newer version is known: the whole app is locked until it is updated. */
  locked: boolean;
  /** A newer version is known and waits until nothing open would be lost: a notice says so, the app is not locked yet. */
  waiting: boolean;
  /** The newer version's number. */
  latest: string | null;
  /** The page is being loaded again. */
  busy: boolean;
}

export const INITIAL_APP_UPDATE: Readonly<AppUpdateState> = Object.freeze({
  channel: 'none',
  locked: false,
  waiting: false,
  latest: null,
  busy: false,
});

export const useAppUpdate = create<AppUpdateState>(() => ({ ...INITIAL_APP_UPDATE }));

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AppUpdateEnvironment {
  channel: UpdateChannel;
  /** This copy's version (`__APP_VERSION__`). */
  current: string;
  /** Where the server's answer is (the browser: its own `/version.json`; the Android app: `<VITE_UPDATE_URL>/version.json`). */
  versionUrl: string;
  fetchAnswer: (url: string) => Promise<VersionAnswer | null>;
  /**
   * Whether nothing would be lost by locking and loading the page again: no
   * input open, no work under way that must not be cut off (./reload.ts `safeToReload`).
   */
  safeToReload: () => boolean;
  /**
   * Calls `changed` whenever what `safeToReload` reads may have changed
   * (src/components/update/reloadProbe.ts); returns what stops that. Without
   * it the app only looks again at the next ask and when the grace time ends.
   */
  watchSafety?: (changed: () => void) => () => void;
  /** This tab's sessionStorage, for the guard against loading again in a loop; null where there is none. */
  session: SessionLike | null;
  reload: () => void;
  shell: ShellPlatform;
  online: () => boolean;
  /** Calls `wake` when the app comes back to the front or online; returns what stops that. */
  listen: (wake: () => void) => () => void;
  /** Between two asks on waking (ms). */
  gapMs?: number;
  /** Between two asks while the app runs (ms). */
  intervalMs?: number;
  /** Before the page loads again by itself, for writes under way to land (ms). */
  settleMs?: number;
  /** How long a newer version waits for a safe moment before it locks anyway (ms). */
  graceMs?: number;
}

/**
 * `graceMs`: the longest a newer version waits while something is open that
 * could hold input (an editor, a dialog, a field with text) or work runs that
 * must not be cut off, before the lock comes anyway (README, "Newest version
 * only").
 */
export const APP_UPDATE_TIMING = Object.freeze({ gapMs: 60_000, intervalMs: 15 * 60_000, settleMs: 1500, graceMs: 10 * 60_000 });

export interface AppUpdateController {
  /** Asks now (one ask at a time; the one under way is returned). */
  check(): Promise<void>;
  /** The lock's button in the browser: loads the new version. */
  update(): Promise<void>;
  stop(): void;
}

/** Starts following the newest version on `env.channel`. Nothing at all happens on 'none': no request, no timer, no listener. */
export function createAppUpdate(env: AppUpdateEnvironment): AppUpdateController {
  const { channel, current } = env;
  const gapMs = env.gapMs ?? APP_UPDATE_TIMING.gapMs;
  const intervalMs = env.intervalMs ?? APP_UPDATE_TIMING.intervalMs;
  const settleMs = env.settleMs ?? APP_UPDATE_TIMING.settleMs;
  const graceMs = env.graceMs ?? APP_UPDATE_TIMING.graceMs;
  useAppUpdate.setState({ ...INITIAL_APP_UPDATE, channel }, true);
  if (channel === 'none') return { check: async () => {}, update: async () => {}, stop() {} };

  let stopped = false;
  let checking: Promise<void> | null = null;
  let lastAsked = -Infinity;
  /** The newer version known, or null. */
  let known: string | null = null;
  /** The newer version has waited `graceMs` for a safe moment: it locks now, safe or not. */
  let graceOver = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | null = null;
  /** Only patches that change something are set (the watch sees every keystroke). */
  const set = (patch: Partial<AppUpdateState>) => {
    if (stopped) return;
    const now = useAppUpdate.getState();
    if ((Object.keys(patch) as (keyof AppUpdateState)[]).some((key) => now[key] !== patch[key])) useAppUpdate.setState(patch);
  };
  const state = () => useAppUpdate.getState();

  function watch(): void {
    if (!unwatch && env.watchSafety) unwatch = env.watchSafety(() => void settle());
  }

  function unwatchSafety(): void {
    unwatch?.();
    unwatch = null;
  }

  /** No newer version (any more): everything waiting for one ends. */
  function forget(): void {
    known = null;
    graceOver = false;
    clearTimeout(graceTimer);
    graceTimer = undefined;
    unwatchSafety();
  }

  /** Not locked yet, and something is open or under way: the notice, and a lock at the latest when the grace time is over. */
  function wait(latest: string): void {
    graceTimer ??= setTimeout(() => {
      graceOver = true;
      void settle();
    }, graceMs);
    watch();
    set({ waiting: true, latest });
  }

  /**
   * Does what the newer version calls for now: wait while it is not safe
   * (until the grace time is over), else lock; and in the browser, load the
   * new version once it is safe.
   */
  async function settle(): Promise<void> {
    if (stopped || known === null || state().busy) return;
    const safe = env.safeToReload();
    const latest = known;
    if (!state().locked && !safe && !graceOver) return wait(latest);
    if (channel === 'android') {
      // Nothing more to wait for: the lock links the download.
      unwatchSafety();
      return set({ locked: true, waiting: false, latest });
    }
    // The browser.
    const decision = safe ? webDecision({ latest, mark: readReloadMark(env.session), safe, canMark: env.session !== null }) : 'lock';
    set({ locked: true, waiting: false, latest, busy: decision === 'reload' });
    if (decision !== 'reload') {
      // Locked while something is open: it loads by itself once that is safe. Locked for another reason: the button.
      if (safe) unwatchSafety();
      else watch();
      return;
    }
    unwatchSafety();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    if (stopped) return;
    // Noted before it goes: should the load bring this version again, the lock waits for the button.
    if (!writeReloadMark(env.session, latest)) return set({ busy: false });
    await refreshWorker(env.shell);
    if (!stopped) env.reload();
  }

  async function checkServer(): Promise<void> {
    const answer = await env.fetchAnswer(env.versionUrl);
    if (stopped || !answer) return;
    const latest = answer.version;
    if (!isNewer(latest, current)) {
      if (channel === 'web') settleReloadMark(env.session, current);
      forget();
      set({ locked: false, waiting: false, latest: null, busy: false });
      return;
    }
    // A load already under way goes on.
    if (state().busy) return;
    known = latest;
    await settle();
  }

  function check(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (checking) return checking;
    if (!env.online()) return Promise.resolve();
    lastAsked = Date.now();
    const work = checkServer().catch(() => {});
    checking = work.finally(() => {
      checking = null;
    });
    return checking;
  }

  async function update(): Promise<void> {
    const now = state();
    if (stopped || !now.locked || now.busy) return;
    // The Android app's lock is a download link; nothing to run here.
    if (channel !== 'web' || !now.latest) return;
    // Asked for by hand: the caches of the app shell and the worker go first, so the load really comes from the server.
    unwatchSafety();
    writeReloadMark(env.session, now.latest);
    set({ busy: true });
    await dropAppShell(env.shell);
    if (!stopped) env.reload();
  }

  const unlisten = env.listen(() => {
    if (Date.now() - lastAsked >= gapMs) void check();
  });
  const timer = setInterval(() => void check(), intervalMs);
  void check();

  return {
    check,
    update,
    stop() {
      stopped = true;
      unlisten();
      clearInterval(timer);
      forget();
    },
  };
}
