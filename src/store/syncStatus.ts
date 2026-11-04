// What the app knows about its connection, for the status line and for the
// automatic sync (lib/autoSync.ts): whether the browser says it is online.
// Kept in memory only: every start begins from what the browser says now.
import { create } from 'zustand';

export interface SyncStatus {
  /** The browser's view of the network. A `true` here does not mean a server can be reached. */
  online: boolean;
  setOnline: (online: boolean) => void;
}

/** What the browser says now; an environment that cannot tell counts as online. */
export function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  online: browserOnline(),
  setOnline: (online) => set((s) => (s.online === online ? s : { online })),
}));
let watching: (() => void) | undefined;

/**
 * Follows the browser's online and offline events. Safe to call more than
 * once; returns a function that stops following (for tests).
 */
export function watchConnectivity(): () => void {
  if (watching) return watching;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  // The event says which way it went; `navigator.onLine` may lag behind it.
  const update = (event?: Event) => useSyncStatus.getState().setOnline(event ? event.type === 'online' : browserOnline());
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  const stop = () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
    if (watching === stop) watching = undefined;
  };
  watching = stop;
  return stop;
}
