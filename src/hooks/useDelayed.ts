import { useEffect, useState } from 'react';

/** How long work runs before a loader shows: what ends sooner never flickers one. */
export const LOADER_DELAY_MS = 250;

/**
 * True once `active` has stayed true for `delay` ms, false again as soon as
 * it is false: a loader for work that is quick most of the time.
 */
export function useDelayed(active: boolean, delay = LOADER_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && shown;
}
