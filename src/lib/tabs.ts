// One browser can have the app open in several tabs and windows. They share
// localStorage and IndexedDB, but each keeps its own stores in memory and
// writes them back whole, so the tab that writes last wins. That must never
// be a tab still showing an account that another one has removed: its next
// write would bring the account back with its address, its calendar names and
// its feed addresses (which may carry access tokens).
//
// So the accounts of the device have a generation: a random mark in
// localStorage that changes whenever a tab removes an account. A tab writes
// only while the mark is the one it read at start or set itself. Once it is
// not, what the tab holds is out of date: it stores and sends nothing more
// and loads again, to show what the device holds now. The check is made at
// every write, not only when the `storage` event comes: a tab that slept in
// the background may run its timers first.
//
// While a tab is in the middle of such a change, the mark says so. A tab
// that loads during it reads a state that is half old and half new, and
// writes nothing until the change is over (and then loads again).
const KEY = 'calendar.accountGen';
const BUSY = /^busy:(\d+):/;
/** A change that has not ended after this long was cut off (the tab was closed): its mark holds nobody up any more. */
const BUSY_MS = 60_000;

// Taken once: the same place for the whole life of the page.
const store = (() => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
})();

function read(): string | null {
  try {
    return store?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function randomMark(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Read while this module loads, which the stores that keep anything import:
// before any of them reads what it keeps.
let seen = read();
let outdated = false;
let reloading = false;
/** Changes of this tab under way; the mark says "busy" while there are any. */
let changing = 0;
/** The last busy mark this tab set: one whose end could not be stored holds up the other tabs only. */
let ownBusy: string | null = null;

let whenOutdated = (): void => {
  try {
    window.location.reload();
  } catch {
    // Not in a browser: there is nothing to load again.
  }
};

function setMark(mark: string): void {
  try {
    store?.setItem(KEY, mark);
  } catch {
    // Storage that takes nothing keeps no state for other tabs to undo either.
  }
  // What could be stored: a storage that takes nothing must not make the tab look outdated to itself.
  seen = read();
}

/**
 * False when this tab must not store or send anything: another tab changed
 * the device's accounts since this one loaded (this tab then loads again),
 * or is in the middle of doing so.
 */
export function tabIsCurrent(): boolean {
  const mark = read();
  if (mark !== seen) outdated = true;
  const busy = BUSY.exec(mark ?? '');
  const held = !!busy && changing === 0 && mark !== ownBusy && Date.now() - Number(busy[1]) <= BUSY_MS;
  if (!outdated) return !held;
  // Loaded again once the other tab is done, so as to load what it leaves.
  if (!held && !reloading) {
    reloading = true;
    whenOutdated();
  }
  return false;
}

/**
 * Runs `work`, which removes an account: every other tab stops writing from
 * now on and loads again once it is over.
 */
export async function changeAccounts<T>(work: () => Promise<T>): Promise<T> {
  if (changing++ === 0) setMark((ownBusy = `busy:${Date.now()}:${randomMark()}`));
  try {
    return await work();
  } finally {
    if (--changing === 0) setMark(randomMark());
  }
}

/** What this tab does once it is outdated, in place of loading again. For tests. */
export function onOutdated(handler: () => void): void {
  whenOutdated = handler;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // A tab that is not doing anything learns of the change at once. `null`: the storage was cleared.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) tabIsCurrent();
  });
}
