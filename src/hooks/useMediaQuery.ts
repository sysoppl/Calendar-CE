import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Phones and narrow windows: drawer sidebar, bar of views at the bottom, FAB. */
export const useIsMobile = () => useMediaQuery('(max-width: 760px)');
/** Tablets: sidebar becomes a drawer but views stay full. */
export const useIsNarrow = () => useMediaQuery('(max-width: 1100px)');
