import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` (default: each minute). */
export function useNow(intervalMs = 60000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // Align the first tick with the next minute boundary.
    const first = setTimeout(
      () => {
        tick();
        timer = setInterval(tick, intervalMs);
      },
      intervalMs - (Date.now() % intervalMs),
    );
    let timer: ReturnType<typeof setInterval> | undefined;
    return () => {
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
