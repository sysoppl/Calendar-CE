// Colour themes. Every theme defines the same set of tokens; they are
// applied as CSS custom properties on <html> and consumed via Tailwind.
//
// The "frame" is the app chrome (sidebar + top bar); the content area is
// the rounded panel holding the calendar grid.
//
// The themes and the calendar colours are the app's own, built around its
// ink: the brand colour #1E2227 (icon, splash, notifications) is also the
// colour of buttons and links in the light themes; the dark themes use a warm
// white with ink labels. The greys are neutral, the light ones a touch warm.

import { contrastRatio, isHexColor, mixHex, readableText } from '@/lib/color';
import { currentThemeId } from './legacy';

export interface ThemeTokens {
  frameBg: string;
  frameText: string;
  frameTextWeak: string;
  frameHover: string;
  frameActive: string;
  frameBorder: string;
  bg: string;
  bgWeak: string;
  bgStrong: string;
  bgElevated: string;
  text: string;
  textWeak: string;
  textHint: string;
  border: string;
  borderWeak: string;
  /** The outline of form fields: 3:1 against the page, so a field can be found (WCAG 1.4.11). */
  fieldBorder: string;
  primary: string;
  primaryHover: string;
  primaryContrast: string;
  primaryWeak: string;
  danger: string;
  /** Text on a `danger` background. */
  dangerContrast: string;
  success: string;
  warning: string;
  nowLine: string;
  shadow: string;
  backdrop: string;
}

export type ThemeId = 'daylight' | 'linen' | 'graphite' | 'night' | 'high-contrast';

export interface ThemeDef {
  /** Stored in the settings. The name shown is the message `theme.<id>`. */
  id: ThemeId;
  dark: boolean;
  tokens: ThemeTokens;
}

/** The light theme everything starts with, and the dark one "Follow the system" pairs it with. */
export const DEFAULT_LIGHT_THEME: ThemeId = 'daylight';
export const DEFAULT_DARK_THEME: ThemeId = 'graphite';

// What the light themes share: the ink, and the status colours.
const LIGHT_ACCENTS = {
  primary: '#1e2227',
  primaryHover: '#3a4048',
  primaryContrast: '#ffffff',
  primaryWeak: 'rgba(30, 34, 39, 0.1)',
  danger: '#c62828',
  dangerContrast: '#ffffff',
  success: '#1e7d4f',
  warning: '#b86e00',
  nowLine: '#d93033',
} as const;

// What the dark themes share: a warm white with ink labels, lighter status colours.
const DARK_ACCENTS = {
  primary: '#ece7de',
  primaryHover: '#f8f5ef',
  primaryContrast: '#16191c',
  primaryWeak: 'rgba(236, 231, 222, 0.14)',
  danger: '#ff8a80',
  dangerContrast: '#3b0905',
  success: '#5cd69a',
  warning: '#ffb84d',
  nowLine: '#ff6b6b',
} as const;

export const THEMES: ThemeDef[] = [
  {
    // Plain white with a warm grey frame.
    id: 'daylight',
    dark: false,
    tokens: {
      frameBg: '#f5f5f3',
      frameText: '#141619',
      frameTextWeak: '#535558',
      frameHover: 'rgba(20, 22, 25, 0.06)',
      frameActive: '#e4e4e0',
      frameBorder: '#e6e6e4',
      bg: '#ffffff',
      bgWeak: '#f5f5f3',
      bgStrong: '#e9e9e7',
      bgElevated: '#ffffff',
      text: '#141619',
      textWeak: '#535558',
      textHint: '#696967',
      border: '#cdcdcb',
      borderWeak: '#e6e6e4',
      fieldBorder: '#929290',
      ...LIGHT_ACCENTS,
      shadow: '0 8px 24px rgba(20, 22, 25, 0.14), 0 2px 6px rgba(20, 22, 25, 0.06)',
      backdrop: 'rgba(20, 22, 25, 0.45)',
    },
  },
  {
    // Warm paper tones.
    id: 'linen',
    dark: false,
    tokens: {
      frameBg: '#f4f1ec',
      frameText: '#1c1a17',
      frameTextWeak: '#57524a',
      frameHover: 'rgba(28, 26, 23, 0.06)',
      frameActive: '#e8e3d9',
      frameBorder: '#e4ded4',
      bg: '#fffefb',
      bgWeak: '#f4f1ec',
      bgStrong: '#e9e4db',
      bgElevated: '#ffffff',
      text: '#1c1a17',
      textWeak: '#57524a',
      textHint: '#6b655c',
      border: '#cfc7ba',
      borderWeak: '#e4ded4',
      fieldBorder: '#93908a',
      ...LIGHT_ACCENTS,
      shadow: '0 8px 24px rgba(28, 26, 23, 0.14), 0 2px 6px rgba(28, 26, 23, 0.06)',
      backdrop: 'rgba(28, 26, 23, 0.45)',
    },
  },
  {
    // Neutral charcoal, leaning towards the ink.
    id: 'graphite',
    dark: true,
    tokens: {
      frameBg: '#121417',
      frameText: '#ededeb',
      frameTextWeak: '#adadab',
      frameHover: 'rgba(237, 237, 235, 0.06)',
      frameActive: '#2f3134',
      frameBorder: '#27292c',
      bg: '#1a1c1f',
      bgWeak: '#15171a',
      bgStrong: '#282a2d',
      bgElevated: '#222427',
      text: '#ededeb',
      textWeak: '#adadab',
      textHint: '#979795',
      border: '#434548',
      borderWeak: '#2e3033',
      fieldBorder: '#737578',
      ...DARK_ACCENTS,
      shadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)',
      backdrop: 'rgba(0, 0, 0, 0.6)',
    },
  },
  {
    // True black, for OLED screens.
    id: 'night',
    dark: true,
    tokens: {
      frameBg: '#000000',
      frameText: '#ededeb',
      frameTextWeak: '#adadab',
      frameHover: 'rgba(237, 237, 235, 0.07)',
      frameActive: '#2a2c2f',
      frameBorder: '#1e2023',
      bg: '#0a0c0f',
      bgWeak: '#000000',
      bgStrong: '#1e2023',
      bgElevated: '#15171a',
      text: '#ededeb',
      textWeak: '#adadab',
      textHint: '#979795',
      border: '#37393c',
      borderWeak: '#1e2023',
      fieldBorder: '#737578',
      ...DARK_ACCENTS,
      shadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px #1e2023',
      backdrop: 'rgba(0, 0, 0, 0.7)',
    },
  },
  {
    id: 'high-contrast',
    dark: true,
    tokens: {
      frameBg: '#000000',
      frameText: '#ffffff',
      frameTextWeak: '#d6d6d6',
      frameHover: 'rgba(255, 255, 255, 0.14)',
      frameActive: 'rgba(255, 255, 255, 0.24)',
      frameBorder: '#ffffff',
      bg: '#0c0c0c',
      bgWeak: '#000000',
      bgStrong: '#2b2b2b',
      bgElevated: '#141414',
      text: '#ffffff',
      textWeak: '#e0e0e0',
      textHint: '#bdbdbd',
      border: '#9e9e9e',
      borderWeak: '#5e5e5e',
      fieldBorder: '#9e9e9e',
      primary: '#ffd866',
      primaryHover: '#ffe699',
      primaryContrast: '#000000',
      primaryWeak: 'rgba(255, 216, 102, 0.28)',
      danger: '#fd8080',
      dangerContrast: '#000000',
      success: '#6ee09e',
      warning: '#f7c964',
      nowLine: '#fd8080',
      shadow: '0 0 0 1px #ffffff',
      backdrop: 'rgba(0, 0, 0, 0.75)',
    },
  },
];

/** The theme with this id. Ids of earlier versions resolve to the nearest theme of today; anything unknown gives the default. */
export function themeById(id: string): ThemeDef {
  const current = currentThemeId(id);
  return THEMES.find((t) => t.id === current) ?? THEMES[0];
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The least contrast of the accent as text and of the text on it (WCAG AA for normal text). */
const AA = 4.5;
/** How far the accent moves towards black (light themes) or white (dark ones) per try. */
const ACCENT_STEP = 0.04;

/**
 * The accent colour as a theme uses it. The colour as picked may be too light
 * for a light page or too dark for a dark one, as button, link and focus
 * colour; it is moved towards black or white, in small steps, until it reads
 * as text on the page, the panels and the frame, and on its own tint, and
 * its label reads on it. The hover colour is two steps further.
 */
export function accentTokens(accent: string, theme: ThemeDef): Pick<ThemeTokens, 'primary' | 'primaryHover' | 'primaryContrast' | 'primaryWeak'> {
  const { bg, bgElevated, frameBg } = theme.tokens;
  const towards = theme.dark ? '#ffffff' : '#000000';
  const tint = theme.dark ? 0.16 : 0.12;
  const readable = (c: string) =>
    contrastRatio(readableText(c), c) >= AA && [bg, bgElevated, frameBg, mixHex(bg, c, tint)].every((surface) => contrastRatio(c, surface) >= AA);
  let amount = 0;
  let primary = mixHex(accent, towards, 0);
  while (!readable(primary) && amount < 1) {
    amount = Math.min(1, +(amount + ACCENT_STEP).toFixed(2));
    primary = mixHex(accent, towards, amount);
  }
  return {
    primary,
    primaryHover: mixHex(accent, towards, amount + 2 * ACCENT_STEP),
    primaryContrast: readableText(primary),
    primaryWeak: `color-mix(in srgb, ${primary} ${Math.round(tint * 100)}%, transparent)`,
  };
}

/** Applies a theme; `accent` (a hex colour) replaces its primary colour and what derives from it. */
export function applyTheme(theme: ThemeDef, accent = '') {
  const root = document.documentElement;
  const tokens: ThemeTokens = isHexColor(accent) ? { ...theme.tokens, ...accentTokens(accent, theme) } : theme.tokens;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${kebab(k)}`, v);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.frameBg);
}

// Calendar and event colours: one palette of the app's own, in hue order. A
// swatch is named by the message `color.<id>`. Each was solved for its
// lightness so that its text (white, or dark on gold, lime, mint, sky,
// lavender and pink) reads at 5:1 or more, and so that it stands out at 3:1
// or more as a dot on both the light and the dark page.

export const CALENDAR_COLORS = [
  { id: 'red', value: '#d12e2c' },
  { id: 'orange', value: '#b05500' },
  { id: 'gold', value: '#af8700' },
  { id: 'lime', value: '#6c9a00' },
  { id: 'green', value: '#1b8037' },
  { id: 'mint', value: '#1e9f7b' },
  { id: 'teal', value: '#007c73' },
  { id: 'sky', value: '#2396c7' },
  { id: 'blue', value: '#1d6cd6' },
  { id: 'indigo', value: '#6660d2' },
  { id: 'lavender', value: '#9d7dd4' },
  { id: 'purple', value: '#9550bb' },
  { id: 'magenta', value: '#ba3d8d' },
  { id: 'pink', value: '#d86a82' },
  { id: 'brown', value: '#8b674d' },
  { id: 'gray', value: '#686f78' },
] as const;

export type SwatchId = (typeof CALENDAR_COLORS)[number]['id'];

export interface ColorSwatch {
  id: SwatchId;
  value: string;
}

/** The colour of a swatch. */
export function swatchColor(id: SwatchId): string {
  return CALENDAR_COLORS.find((c) => c.id === id)!.value;
}

/** Whether `color` is one of the palette's, written as the palette writes it. */
export function isSwatch(color: string | undefined): boolean {
  return CALENDAR_COLORS.some((c) => c.value === color);
}

// The two muted swatches are there to be chosen, not handed out.
const LIVELY: readonly string[] = CALENDAR_COLORS.filter((c) => c.id !== 'gray' && c.id !== 'brown').map((c) => c.value);

/** A colour for a new calendar: any swatch but the muted ones. */
export function randomCalendarColor(): string {
  return LIVELY[Math.floor(Math.random() * LIVELY.length)];
}
