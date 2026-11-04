// The dimmed backdrop behind a sheet, a drawer or a panel closes it when it
// is tapped. Only a tap that began on the backdrop counts: the browser sends
// the click of a tap after the tap itself, and when that tap opened the sheet
// (on its pointerup), the click lands on the backdrop that has just appeared
// and would close the sheet at once. A press that starts inside the sheet and
// ends on the backdrop (selecting text, a drag that slipped) does not count
// either.
import { useRef, type MouseEvent, type PointerEvent } from 'react';

export interface BackdropDismiss {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}

/** Handlers for the backdrop element (spread on it): `close` runs on a tap that began and ended on the backdrop itself. */
export function useBackdropDismiss(close: () => void): BackdropDismiss {
  const down = useRef(false);
  return {
    onPointerDown: (e) => {
      down.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      const began = down.current;
      down.current = false;
      if (began && e.target === e.currentTarget) close();
    },
  };
}
