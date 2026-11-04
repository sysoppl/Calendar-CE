// Floating panels (menus, pickers, the event's card, quick create) are placed
// by floating-ui after they mount. Two things put them at the top-left corner
// of the page first:
// - until the first placement their style is left 0, top 0, so they stay
//   unseen until then. Unseen, not hidden: a panel's field can take the focus
//   and its size can be measured meanwhile;
// - floating-ui places by `transform: translate(…)` by default, which the
//   pop-in animation's own `transform` overrides while it runs: the panel
//   popped in at the corner and jumped into place when the animation ended.
//   Every panel is therefore placed by left/top (`transform: false`).
import type { CSSProperties } from 'react';

/** The panel's style: its placement once there is one, and unseen before. */
export function placedStyle(styles: CSSProperties, isPositioned: boolean): CSSProperties {
  return isPositioned ? styles : { ...styles, opacity: 0 };
}

/** The pop-in animation, started once the panel is where it belongs. */
export function popIn(isPositioned: boolean): string {
  return isPositioned ? 'animate-pop' : '';
}
