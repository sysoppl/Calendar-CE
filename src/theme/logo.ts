// The app icon as the web uses it: the master drawing (theme/iconMaster.ts)
// on a rounded tile, 64 × 64. The small drawing on Paper is the favicon
// (public/favicon.svg is this text), the month on Paper the installed web
// app's scalable icon (public/icons/icon.svg); the logo in the app takes Paper,
// or Ink in a dark theme (components/layout/Logo.tsx). One static icon
// everywhere: it shows no date.

import { ICON_BRAND, ICON_DAYS_PATH, ICON_PAPER, ICON_SMALL_DAYS_PATH, ICON_SMALL_TODAY_PATH, ICON_TODAY, ICON_TODAY_INK, ICON_TODAY_PATH } from './iconMaster';

/** Paper: ink days and a red day on the paper. Ink: paper days and an amber day on the ink. */
export type LogoPalette = 'paper' | 'ink';

export const LOGO_COLORS: Record<LogoPalette, { ground: string; days: string; today: string }> = {
  paper: { ground: ICON_PAPER, days: ICON_BRAND, today: ICON_TODAY },
  ink: { ground: ICON_BRAND, days: ICON_PAPER, today: ICON_TODAY_INK },
};

/**
 * The 108 grid's launcher window (18..90) scaled onto the 64 tile:
 * x64 = (x108 − 18) × 64 / 72, so the tile has the launcher icon's proportions.
 */
const TO_TILE = 'matrix(.8889 0 0 .8889 -16 -16)';

/** The days and the marked day, on the 108 grid: the month, or the small drawing for 48 px and less. */
export function dayPaths(days: string, today: string, small = false): string {
  return `<path d="${small ? ICON_SMALL_DAYS_PATH : ICON_DAYS_PATH}" fill="${days}"/><path d="${small ? ICON_SMALL_TODAY_PATH : ICON_TODAY_PATH}" fill="${today}"/>`;
}

/** The icon: the days on the tile with rounded corners. The favicon by default. */
export function logoSvg({ palette = 'paper', small = true }: { palette?: LogoPalette; small?: boolean } = {}): string {
  const c = LOGO_COLORS[palette];
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" rx="14" fill="${c.ground}"/>` +
    `<g transform="${TO_TILE}">${dayPaths(c.days, c.today, small)}</g>` +
    '</svg>'
  );
}

export function logoDataUri(options?: { palette?: LogoPalette; small?: boolean }): string {
  return `data:image/svg+xml,${encodeURIComponent(logoSvg(options))}`;
}
