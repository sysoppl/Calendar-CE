// Every icon of the app drawn from one master (src/theme/iconMaster.ts): the
// SVGs that scripts/render-icons.mjs turns into rasters or writes as they are
// (the favicon and the installed web app's scalable icon), and the Android
// vector drawables (the adaptive icon's foreground, which is the splash icon
// too, its monochrome layer, and the notification icon). Pure functions, so a
// test can check that the files in the repository are the ones this master
// gives.
import { readFileSync } from 'node:fs';

/** How src/theme/iconMaster.ts writes its constants, the pattern it documents for scripts. */
const CONSTANT = /export const (\w+) = '([^']*)';/g;

const NAMES = ['ICON_BRAND', 'ICON_PAPER', 'ICON_TODAY', 'ICON_TODAY_INK', 'ICON_DAYS_PATH', 'ICON_TODAY_PATH', 'ICON_SMALL_DAYS_PATH', 'ICON_SMALL_TODAY_PATH'];

/** The master's constants, read from the TypeScript source without compiling it. */
export function readMaster(file = 'src/theme/iconMaster.ts') {
  const source = readFileSync(file, 'utf8');
  const master = Object.fromEntries([...source.matchAll(CONSTANT)].map(([, name, value]) => [name, value]));
  for (const name of NAMES) {
    if (!master[name]) throw new Error(`${file} has no ${name}`);
  }
  return master;
}

/** The window of the 108 grid a launcher shows; the tile fills it. */
export const LAUNCHER_WINDOW = { x: 18, size: 72 };
/** Corner radius of the tile, on the 108 grid (as the favicon's 14 of 64). */
export const TILE_RADIUS = 16;
/** Pictures this many pixels wide or less get the small drawing, whose days stay apart. */
export const SMALL_UP_TO = 48;

/** Paper (the icon) or Ink (the logo in a dark theme): the ground, the days, the marked day. */
export function colors(master, palette = 'paper') {
  return palette === 'ink'
    ? { ground: master.ICON_BRAND, days: master.ICON_PAPER, today: master.ICON_TODAY_INK }
    : { ground: master.ICON_PAPER, days: master.ICON_BRAND, today: master.ICON_TODAY };
}

/** The days and the marked day on the 108 grid, in the palette's colours or all in `color` (a silhouette). */
export function drawing(master, { small = false, palette = 'paper', color } = {}) {
  const c = colors(master, palette);
  return (
    `<path d="${small ? master.ICON_SMALL_DAYS_PATH : master.ICON_DAYS_PATH}" fill="${color ?? c.days}"/>` +
    `<path d="${small ? master.ICON_SMALL_TODAY_PATH : master.ICON_TODAY_PATH}" fill="${color ?? c.today}"/>`
  );
}

const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

/** A square view of the 108 grid: `size` units centred on (54, 54). */
export function centredViewBox(size) {
  const at = 54 - size / 2;
  return `${at} ${at} ${size} ${size}`;
}

/**
 * The tile with rounded corners on a transparent ground, drawn at `fill` of
 * the picture's width (1 = edge to edge): web icons, legacy launcher icons.
 */
export function tileSvg(master, { fill = 1, small = false } = {}) {
  const { x, size } = LAUNCHER_WINDOW;
  return svg(centredViewBox(size / fill), `<rect x="${x}" y="${x}" width="${size}" height="${size}" rx="${TILE_RADIUS}" fill="${master.ICON_PAPER}"/>${drawing(master, { small })}`);
}

/** A paper disc of the tile's width with the drawing, at `fill` of the picture's width: the legacy round launcher icon. */
export function roundSvg(master, { fill = 1, small = false } = {}) {
  const { size } = LAUNCHER_WINDOW;
  return svg(centredViewBox(size / fill), `<circle cx="54" cy="54" r="${size / 2}" fill="${master.ICON_PAPER}"/>${drawing(master, { small })}`);
}

/** The ground edge to edge, no corners, with `size` units of the grid in view: maskable, Apple touch and store icons. */
export function fullBleedSvg(master, { size = LAUNCHER_WINDOW.size, palette = 'paper' } = {}) {
  return svg(centredViewBox(size), `<rect width="108" height="108" fill="${colors(master, palette).ground}"/>${drawing(master, { palette })}`);
}

/** The small drawing alone, in white on nothing: the badge of a web notification. */
export function badgeSvg(master, size = 56) {
  return svg(centredViewBox(size), drawing(master, { small: true, color: '#ffffff' }));
}

/**
 * The icon on the 64 tile, the text of src/theme/logo.ts logoSvg(): the
 * favicon (the small drawing) and the installed web app's scalable icon (the
 * month).
 */
export function faviconSvg(master, { small = true } = {}) {
  const c = colors(master);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" rx="14" fill="${c.ground}"/>` +
    `<g transform="matrix(.8889 0 0 .8889 -16 -16)">${drawing(master, { small })}</g>` +
    '</svg>'
  );
}

const header = (what) => `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${what}\n     Drawn from src/theme/iconMaster.ts by scripts/render-icons.mjs; edit the master, not this file. -->\n`;

/** An opaque Android colour (#AARRGGBB) of a #RRGGBB one. */
const argb = (hex) => `#FF${hex.slice(1).toUpperCase()}`;

const vectorPaths = (indent, paths) =>
  paths.map(([data, color]) => [`${indent}<path`, `${indent}    android:pathData="${data}"`, `${indent}    android:fillColor="${color}" />`].join('\n')).join('\n');

const vector108 = (body) =>
  '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
  '    android:width="108dp"\n' +
  '    android:height="108dp"\n' +
  '    android:viewportWidth="108"\n' +
  '    android:viewportHeight="108">\n' +
  `${body}\n` +
  '</vector>\n';

/**
 * res/drawable/ic_launcher_foreground.xml: the month in the ink, the marked
 * day in red, on the 108 grid. The adaptive icon's foreground over the paper
 * background, and the splash icon.
 */
export function foregroundXml(master) {
  return (
    header("The app icon's drawing on the 108 grid, ink days and the red day: the adaptive icon's foreground and the splash icon.") +
    vector108(
      vectorPaths('    ', [
        [master.ICON_DAYS_PATH, argb(master.ICON_BRAND)],
        [master.ICON_TODAY_PATH, argb(master.ICON_TODAY)],
      ]),
    )
  );
}

/**
 * res/drawable/ic_launcher_monochrome.xml: the same month in one colour, the
 * themed icon's layer (the system keeps only its shape and tints it).
 */
export function monochromeXml(master) {
  return (
    header("The app icon's drawing in one colour on the 108 grid: the themed icon's monochrome layer, which the system tints.") +
    vector108(
      vectorPaths('    ', [
        [master.ICON_DAYS_PATH, '#FFFFFFFF'],
        [master.ICON_TODAY_PATH, '#FFFFFFFF'],
      ]),
    )
  );
}

/**
 * res/drawable/ic_stat_calendar.xml: the notification's small icon, the small
 * drawing as a white silhouette, 56 units of the grid around its middle in
 * 24dp (the drawing is 19.7dp across).
 */
export function statusIconXml(master) {
  return (
    header("The notification icon: the app icon's small drawing as a white silhouette, the system tints it.") +
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
    '    android:width="24dp"\n' +
    '    android:height="24dp"\n' +
    '    android:viewportWidth="56"\n' +
    '    android:viewportHeight="56">\n' +
    '    <group\n' +
    '        android:translateX="-26"\n' +
    '        android:translateY="-26">\n' +
    `${vectorPaths('        ', [
      [master.ICON_SMALL_DAYS_PATH, '#FFFFFFFF'],
      [master.ICON_SMALL_TODAY_PATH, '#FFFFFFFF'],
    ])}\n` +
    '    </group>\n' +
    '</vector>\n'
  );
}

/** Where the drawables above live, and what each holds. */
export function drawables(master) {
  return {
    'android/app/src/main/res/drawable/ic_launcher_foreground.xml': foregroundXml(master),
    'android/app/src/main/res/drawable/ic_launcher_monochrome.xml': monochromeXml(master),
    'android/app/src/main/res/drawable/ic_stat_calendar.xml': statusIconXml(master),
  };
}

/** Legacy launcher icons (Android 7.x, which has no adaptive icons): density folder and size in pixels. */
export const LEGACY_LAUNCHER = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** The part of a legacy launcher icon the tile takes: 44 of 48, as the platform's own icons. */
export const LEGACY_FILL = 44 / 48;

/** Sizes of the installed web app's icons. */
export const WEB_SIZES = [48, 72, 96, 128, 192, 256, 512];
