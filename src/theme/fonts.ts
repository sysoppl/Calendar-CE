// Interface fonts. Bundled families ship with the app (no requests to a font
// CDN) and their CSS is loaded on demand; device fonts cost nothing but only
// render where the operating system has them.

import { currentFontId } from './legacy';

export interface FontDef {
  id: string;
  name: string;
  /** Full CSS font-family value. */
  stack: string;
  group: 'bundled' | 'device';
  /** Loads the @font-face rules of a bundled family. */
  load?: () => Promise<unknown>;
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'Cascadia Code', Consolas, Menlo, monospace";

export const FONTS: FontDef[] = [
  // Inter is the default and is imported statically in main.tsx.
  { id: 'inter', name: 'Inter', stack: `'Inter Variable', 'Inter', ${SANS}`, group: 'bundled' },
  { id: 'roboto', name: 'Roboto', stack: `'Roboto Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/roboto/index.css') },
  { id: 'outfit', name: 'Outfit', stack: `'Outfit Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/outfit/index.css') },
  { id: 'open-sans', name: 'Open Sans', stack: `'Open Sans Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/open-sans/index.css') },
  { id: 'noto-sans', name: 'Noto Sans', stack: `'Noto Sans Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/noto-sans/index.css') },
  { id: 'dm-sans', name: 'DM Sans', stack: `'DM Sans Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/dm-sans/index.css') },
  { id: 'figtree', name: 'Figtree', stack: `'Figtree Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/figtree/index.css') },
  { id: 'manrope', name: 'Manrope', stack: `'Manrope Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/manrope/index.css') },
  { id: 'nunito', name: 'Nunito', stack: `'Nunito Variable', ${SANS}`, group: 'bundled', load: () => import('@fontsource-variable/nunito/index.css') },
  {
    id: 'atkinson',
    name: 'Atkinson Hyperlegible',
    stack: `'Atkinson Hyperlegible Next Variable', ${SANS}`,
    group: 'bundled',
    load: () => import('@fontsource-variable/atkinson-hyperlegible-next/index.css'),
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    stack: `'Source Serif 4 Variable', ${SERIF}`,
    group: 'bundled',
    load: () => import('@fontsource-variable/source-serif-4/index.css'),
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    stack: `'JetBrains Mono Variable', ${MONO}`,
    group: 'bundled',
    load: () => import('@fontsource-variable/jetbrains-mono/index.css'),
  },

  { id: 'system', name: 'System default', stack: SANS, group: 'device' },
  { id: 'arial', name: 'Arial', stack: `Arial, Helvetica, ${SANS}`, group: 'device' },
  { id: 'verdana', name: 'Verdana', stack: `Verdana, Geneva, ${SANS}`, group: 'device' },
  { id: 'tahoma', name: 'Tahoma', stack: `Tahoma, ${SANS}`, group: 'device' },
  { id: 'trebuchet', name: 'Trebuchet MS', stack: `'Trebuchet MS', ${SANS}`, group: 'device' },
  { id: 'georgia', name: 'Georgia', stack: SERIF, group: 'device' },
  { id: 'times', name: 'Times New Roman', stack: `'Times New Roman', Times, serif`, group: 'device' },
];

/** The font with this id. Ids of families that were renamed or dropped still work; anything unknown gives the default. */
export function fontById(id: string): FontDef {
  const current = currentFontId(id);
  return FONTS.find((f) => f.id === current) ?? FONTS[0];
}

/** Loads a font's faces (if it is bundled) and makes it the interface font. */
export function applyFont(font: FontDef) {
  // A failed load leaves the stack's fallbacks in charge, which is fine.
  void font.load?.().catch(() => {});
  document.documentElement.style.setProperty('--app-font', font.stack);
}

/** Loads every bundled family so the picker can preview each in its own face. */
export function loadAllFonts() {
  for (const f of FONTS) void f.load?.().catch(() => {});
}
