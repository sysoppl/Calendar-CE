// One copy of the app per browser profile at a time.
//
// Every copy keeps its stores in memory and writes them back whole whenever
// something changes: the calendar list (`calendar.data`), the settings, all
// items of a calendar at once (IndexedDB). Nothing reads back what another
// copy wrote. Two copies side by side would write each other's changes away:
// a calendar made in one tab, or moved there from another place, would be
// gone after the other tab's next save, and so would items added to the same
// calendar. (`./tabs` keeps a tab from putting back an account that another
// one removed; this keeps a second copy from running at all.)
//
// So a page runs the app only while it holds the lock named here. Any other
// page of the same site says that the app is open elsewhere, starts by itself
// once the copy before it is gone, and can ask that copy to give way. The
// copy asked loads again, and from then on waits like any other page. It
// holds the lock until it is gone, so its last write lands before the next
// copy reads anything. A copy that does not answer (the browser froze it)
// has the lock taken from it after a few seconds, and loads again as soon as
// it runs.
//
// This module loads nothing else of the app: a page that waits must not have
// read what the copy that runs is still changing.

const LOCK = 'calendar-app';
const CHANNEL = 'calendar-app';
const GIVE_WAY = 'give-way';

/** How long the copy that runs has to give way before the lock is taken from it. */
export const TAKE_OVER_MS = 5000;

export interface InstanceOptions {
  /** Another page runs the app. Shown until `ready` resolves, with a way to `takeOver`. */
  onWaiting: () => void;
  /** This page ran the app and another one took over: it must stop at once. Loads the page again unless given. */
  onReplaced?: () => void;
  /** The browser's lock manager; null where there is none to use (the Android app is one copy by itself). */
  locks?: LockManager | null;
}

export interface Instance {
  /** Resolves once this page may run the app, and from then on it holds it. */
  ready: Promise<void>;
  /** Asks the page that runs the app to give way to this one. */
  takeOver: () => void;
}

function browserLocks(): LockManager | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

/**
 * Claims the app for this page. Without Web Locks or a BroadcastChannel
 * (older browsers) every page runs, as before there was this.
 */
export function claimInstance(options: InstanceOptions): Instance {
  const locks = options.locks === undefined ? browserLocks() : options.locks;
  if (!locks || typeof BroadcastChannel === 'undefined') return { ready: Promise.resolve(), takeOver: () => {} };
  const replaced = options.onReplaced ?? (() => window.location.reload());

  let granted = false;
  let asked = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));

  /** Holds the lock for as long as the page is there, and listens for a page that wants it. */
  const hold = (lock: Lock | null): Promise<void> | undefined => {
    if (!lock || granted) return undefined;
    granted = true;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if ((event.data as { type?: unknown } | null)?.type !== GIVE_WAY) return;
      channel.close();
      replaced();
    };
    resolveReady();
    return new Promise<void>(() => {});
  };

  /** The lock was taken from this page (`steal`): what runs here must stop. */
  const lost = () => {
    if (granted) replaced();
  };

  void locks
    .request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock) return hold(lock);
      options.onWaiting();
      // Waits its turn: starts by itself once the copy before it is gone.
      void locks.request(LOCK, hold).catch(lost);
      return undefined;
    })
    .catch(lost);

  const takeOver = () => {
    if (granted || asked) return;
    asked = true;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: GIVE_WAY });
    channel.close();
    setTimeout(() => {
      if (!granted) void locks.request(LOCK, { steal: true }, hold).catch(lost);
    }, TAKE_OVER_MS);
  };

  return { ready, takeOver };
}
