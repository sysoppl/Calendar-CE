// Colour utilities for event chips.

// Colours the app picks itself: for the first calendar (red), the first task
// list (blue) and a holiday calendar (green). Each is a swatch of the palette
// in theme/themes.ts, so the colour picker shows it as selected.
export const DEFAULT_CALENDAR_COLOR = '#d12e2c';
export const DEFAULT_TASK_COLOR = '#1d6cd6';
export const DEFAULT_HOLIDAY_COLOR = '#1b8037';

/** The dark text on a light block of colour: the text colour of the light themes. */
export const DARK_TEXT = '#141619';

function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function isHexColor(c: string | undefined): c is string {
  return !!c && !!parseHex(c);
}

/** The colour keywords of CSS Color Level 3, which RFC 7986 names for COLOR, with their values. */
const CSS_COLORS = new Map(
  (
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
    'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
    'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
    'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b ' +
    'darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a ' +
    'darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 ' +
    'darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff ' +
    'firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 ' +
    'goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 ' +
    'indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 ' +
    'lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 ' +
    'lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa ' +
    'lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 ' +
    'linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 ' +
    'mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc ' +
    'mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead ' +
    'navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 ' +
    'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 ' +
    'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 ' +
    'saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 ' +
    'skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 ' +
    'tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff ' +
    'whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'
  )
    .split(' ')
    .map((pair) => pair.split(':') as [string, string]),
);

/** The keyword names of CSS Color Level 3, for checking them against a browser. */
export const CSS_COLOR_NAMES: readonly string[] = [...CSS_COLORS.keys()];

/** Red, green, blue (0-255) and alpha (0-1) of a colour `normalizeItemColor` keeps. */
function parseColor(color: string): { rgb: [number, number, number]; alpha: number } | undefined {
  const c = color.trim().toLowerCase();
  const named = CSS_COLORS.get(c);
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(named ? `#${named}` : c);
  if (!m) return undefined;
  let h = m[1];
  if (h.length <= 4) h = h.replace(/./g, (d) => d + d);
  const at = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { rgb: [at(0), at(2), at(4)], alpha: h.length === 8 ? at(6) / 255 : 1 };
}

/**
 * An item's own COLOR as read from calendar data: a hex colour (#rgb, #rgba,
 * #rrggbb or #rrggbbaa) or a CSS colour keyword, else nothing. It comes from
 * servers, imported files and invitations, and is applied at parse time so
 * that no consumer ever holds anything else.
 */
export function normalizeItemColor(raw: string | undefined): string | undefined {
  // Longer than any keyword: not worth looking at.
  if (!raw || raw.length > 40) return undefined;
  const c = raw.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
  const name = c.toLowerCase();
  return CSS_COLORS.has(name) ? name : undefined;
}

/**
 * Colour for an event. An event's own COLOR comes straight from (possibly
 * third-party) calendar data and ends up in CSS, so it is checked again here
 * by the same rule as when it was read - never anything like `url(...)`. So
 * is the calendar's, which another app of the account may have written.
 */
export function eventColor(own: string | undefined, calendar: string | undefined, fallback = DEFAULT_CALENDAR_COLOR): string {
  return normalizeItemColor(own) ?? calendarColor(calendar, fallback);
}

/** A calendar's or task list's colour where it reaches CSS, by the same rule as an event's. */
export function calendarColor(color: string | undefined, fallback = DEFAULT_CALENDAR_COLOR): string {
  return normalizeItemColor(color) ?? fallback;
}

/**
 * A colour `normalizeItemColor` keeps as plain `#rrggbb`, its alpha left out:
 * for places that take nothing else (the Android home screen widgets).
 */
export function opaqueHex(color: string): string | undefined {
  const parsed = parseColor(color);
  return parsed ? `#${parsed.rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}` : undefined;
}

/**
 * A colour as it shows over the page: one with an alpha channel mixed into
 * the background (`var(--bg)`), the way a dot of it looks there. For a block
 * of colour, which would otherwise let grid lines and text behind it through.
 */
export function solidColor(color: string): string {
  const parsed = parseColor(color);
  if (!parsed || parsed.alpha >= 1) return color;
  const [r, g, b] = parsed.rgb;
  return `color-mix(in srgb, rgb(${r}, ${g}, ${b}) ${Math.round(parsed.alpha * 100)}%, var(--bg))`;
}

/**
 * Text colour for a block of `bg` as `solidColor` draws it. A colour with an
 * alpha channel looks different over a light page and a dark one: where white
 * or near-black reads on both, that; where not, the page's own text colour,
 * which is dark on a light page and light on a dark one.
 */
export function readableTextOn(bg: string): string {
  const parsed = parseColor(bg);
  if (!parsed || parsed.alpha >= 1) return readableText(bg);
  const over = (page: number) => parsed.rgb.map((v) => Math.round(v * parsed.alpha + page * (1 - parsed.alpha))) as [number, number, number];
  const light = textFor(over(255));
  return light === textFor(over(0)) ? light : 'var(--text)';
}

function luminance([r, g, b]: [number, number, number]) {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The WCAG contrast ratio of two colours (their alpha channels left aside); 1 when either is not a colour. */
export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a)?.rgb;
  const y = parseColor(b)?.rgb;
  return x && y ? ratio(luminance(x), luminance(y)) : 1;
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** `a` moved towards `b` by `amount` (0 is `a`, 1 is `b`), mixed in sRGB like CSS color-mix: a #rrggbb colour. */
export function mixHex(a: string, b: string, amount: number): string {
  const x = parseColor(a)?.rgb ?? [0, 0, 0];
  const y = parseColor(b)?.rgb ?? [0, 0, 0];
  const t = Math.min(1, Math.max(0, amount));
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** White or near-black, whichever reads better on `bg` (its alpha channel left aside). */
export function readableText(bg: string): string {
  const rgb = parseColor(bg)?.rgb;
  return rgb ? textFor(rgb) : '#ffffff';
}

const DARK_TEXT_LUMINANCE = luminance(parseColor(DARK_TEXT)!.rgb);

function textFor(rgb: [number, number, number]): string {
  const L = luminance(rgb);
  const white = ratio(L, 1);
  // White wherever it meets WCAG AA for normal text; on the mid tones where
  // it does not, whichever of the two reads better.
  return white >= 4.5 || white >= ratio(L, DARK_TEXT_LUMINANCE) ? '#ffffff' : DARK_TEXT;
}

/** `color` at `alpha`; a colour that has an alpha channel of its own gets both. */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const [r, g, b] = parsed.rgb;
  return `rgba(${r}, ${g}, ${b}, ${+(alpha * parsed.alpha).toFixed(3)})`;
}
