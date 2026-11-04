/**
 * Larger controls for fingers. Put on a container (a page, a dialog, the
 * settings): on a touch screen its form fields, buttons and small controls
 * inside grow to 44 px, the size a fingertip can hit reliably. Controls of
 * the kit read `--touch` as their least height (and width, for icons), so
 * the calendar's own dense toolbar, which sets nothing, keeps its sizes.
 */
export const TOUCH_AREA = 'pointer-coarse:[--field-h:2.75rem] pointer-coarse:[--touch:2.75rem]';

/** A control's least height inside a `TOUCH_AREA`; nothing elsewhere. */
export const TOUCH_MIN_H = 'min-h-[var(--touch,0px)]';

/** Least height and width, for square icon buttons. */
export const TOUCH_MIN = 'min-h-[var(--touch,0px)] min-w-[var(--touch,0px)]';

/**
 * A 44 px tall hit area on a touch screen around a control that keeps its
 * drawn size, for one with a border or a fill whose growing would show. The
 * control must not clip its content.
 */
export const TOUCH_HIT = 'relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2';
