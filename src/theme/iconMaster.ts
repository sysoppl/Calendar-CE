// The app icon's master drawing, on the 108 × 108 grid of an Android adaptive
// icon: a month as it really falls, October 2026 (Monday first: it starts on a
// Thursday and has 31 days, which gives the grid its ragged outline), with the
// 29th, the day the icon was drawn, marked. Every icon is made from it: the web
// tile and favicon (theme/logo.ts), the installed-app and Android rasters
// (scripts/render-icons.mjs), the adaptive, monochrome and notification
// drawables in android/app/src/main/res.
//
// Two palettes: Paper (the ink days and a red day on the paper of the Daylight
// frame), which is the icon everywhere, and Ink (paper days and an amber day on
// the brand ink), which only the logo in the app uses, in the dark themes.
//
// Two drawings: the month, 31 days of 5.2 with a pitch of 7.1, spanning x
// 30.1..77.9 and y 37.2..70.8 (centred both ways; the farthest corner is 29.2
// from the centre, inside the safe circle of radius 33); and for 48 px and
// less (the favicon, the small logo, the notification icon), four weeks of four
// days of 10 with a pitch of 12, spanning 31..77 both ways, with the same
// ragged start.
//
// Plain string constants and nothing else, so a Node script can read them
// too: `node --experimental-strip-types`, or by the pattern
// /export const (\w+) = '([^']*)';/g.

/** The brand ink: the days on Paper, the ground of Ink, the notification accent. */
export const ICON_BRAND = '#1E2227';

/** The paper: the ground of the icon (the Daylight frame), the days on Ink. */
export const ICON_PAPER = '#F5F5F3';

/** The marked day on Paper. */
export const ICON_TODAY = '#D93033';

/** The marked day on Ink. */
export const ICON_TODAY_INK = '#F2B134';

/** The month's days but the marked one: rounded squares, on the 108 grid. */
export const ICON_DAYS_PATH = 'M52.6 37.2h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM59.7 37.2h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM66.8 37.2h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM73.9 37.2h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM31.3 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM38.4 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM45.5 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM52.6 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM59.7 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM66.8 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM73.9 44.3h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM31.3 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM38.4 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM45.5 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM52.6 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM59.7 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM66.8 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM73.9 51.4h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM31.3 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM38.4 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM45.5 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM52.6 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM59.7 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM66.8 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM73.9 58.5h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM31.3 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM38.4 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM45.5 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM59.7 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2zM66.8 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2z';

/** The month's marked day, the 29th (a Thursday, in the last week). */
export const ICON_TODAY_PATH = 'M52.6 65.6h2.8a1.2 1.2 0 0 1 1.2 1.2v2.8a1.2 1.2 0 0 1 -1.2 1.2h-2.8a1.2 1.2 0 0 1 -1.2 -1.2v-2.8a1.2 1.2 0 0 1 1.2 -1.2z';

/** The small drawing's days but the marked one: two, four, four and two, on the 108 grid. */
export const ICON_SMALL_DAYS_PATH = 'M57 31h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM69 31h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM33 43h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM45 43h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM57 43h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM69 43h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM33 55h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM45 55h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM57 55h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM69 55h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM33 67h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z';

/** The small drawing's marked day: the second of the last row. */
export const ICON_SMALL_TODAY_PATH = 'M45 67h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z';
