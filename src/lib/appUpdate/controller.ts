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
  /** The newer version's number. */
  latest: string | null;
  /** The page is being loaded again. */
  busy: boolean;
}

export const INITIAL_APP_UPDATE: Readonly<AppUpdateState> = Object.freeze({
  channel: 'none',
  locked: false,
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
  /** Whether the page may be loaded again without a word (./reload.ts `safeToReload`). */
  safeToReload: () => boolean;
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
}

export const APP_UPDATE_TIMING = Object.freeze({ gapMs: 60_000, intervalMs: 15 * 60_000, settleMs: 1500 });

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
  useAppUpdate.setState({ ...INITIAL_APP_UPDATE, channel }, true);
  if (channel === 'none') return { check: async () => {}, update: async () => {}, stop() {} };

  let stopped = false;
  let checking: Promise<void> | null = null;
  let lastAsked = -Infinity;
  const set = (patch: Partial<AppUpdateState>) => {
    if (!stopped) useAppUpdate.setState(patch);
  };
  const state = () => useAppUpdate.getState();

  async function checkServer(): Promise<void> {
    const answer = await env.fetchAnswer(env.versionUrl);
    if (stopped || !answer) return;
    const latest = answer.version;
    if (!isNewer(latest, current)) {
      if (channel === 'web') settleReloadMark(env.session, current);
      set({ locked: false, latest: null, busy: false });
      return;
    }
    if (channel === 'android') return set({ locked: true, latest });
    // The browser. A load already under way goes on.
    if (state().busy) return;
    const decision = webDecision({ latest, mark: readReloadMark(env.session), safe: env.safeToReload(), canMark: env.session !== null });
    set({ locked: true, latest, busy: decision === 'reload' });
    if (decision !== 'reload') return;
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    if (stopped) return;
    // Noted before it goes: should the load bring this version again, the lock waits for the button.
    if (!writeReloadMark(env.session, latest)) return set({ busy: false });
    await refreshWorker(env.shell);
    if (!stopped) env.reload();
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
    },
  };
}
