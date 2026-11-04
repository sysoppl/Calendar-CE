// The Android back button outside dialogs. Dialogs are closed through the
// Modal stack (closeTopModal); what is left is the screen underneath, and
// screens nest: the shell, the welcome steps.
// The deepest layer answers first; when nobody takes the press, the app is
// minimised.
import { useEffect, useRef } from 'react';

/** Answers true when it did something with the press. */
type Handler = () => boolean;

interface Entry {
  depth: number;
  handler: Handler;
}

const entries: Entry[] = [];

/**
 * Offers `handler` the back button while the component is mounted and
 * `active`. A higher `depth` is asked first (children mount their effects
 * before their parents, so the order of registration cannot say which layer
 * is on top); among equal depths the latest wins.
 */
export function useBackButtonLayer(depth: number, handler: Handler, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { depth, handler: () => ref.current() };
    entries.push(entry);
    return () => {
      entries.splice(entries.indexOf(entry), 1);
    };
  }, [depth, active]);
}

/** Lets the layers answer the press, deepest first. False when none did. */
export function handleBackButton(): boolean {
  const ordered = entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.depth - a.entry.depth || b.index - a.index);
  return ordered.some(({ entry }) => entry.handler());
}

/**
 * Depths of the layers this app has. `history` is the calendar's way back
 * through the views and dates it showed (store/ui.ts navBack): asked only
 * when nothing in the shell is left to close.
 */
export const BACK_DEPTH = { history: -1, shell: 0, onboarding: 1 } as const;
