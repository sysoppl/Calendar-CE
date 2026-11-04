// Ids that themes and fonts had in earlier versions. Settings saved by an
// earlier version still hold them, so they have to keep resolving.

import type { ThemeId } from './themes';

/** Settings version 3 (app 1.0) renamed the themes: the ids before that, with their 1.0 id. */
const RENAMED_THEME_IDS: ReadonlyMap<string, string> = new Map([
  ['snow', 'daylight'],
  ['carbon', 'graphite'],
  ['classic', 'ink'],
  ['legacy', 'harbor'],
  ['monokai', 'retro'],
  ['contrast', 'high-contrast'],
]);

/**
 * Settings version 4 (app 1.1) kept five themes of the app's own. Each 1.0
 * theme that went resolves to the nearest one of the same lightness, so a
 * light choice stays light and a dark one dark.
 */
const RETIRED_THEME_IDS: ReadonlyMap<string, ThemeId> = new Map<string, ThemeId>([
  ['ink', 'daylight'],
  ['harbor', 'daylight'],
  ['dusk', 'daylight'],
  ['azure', 'daylight'],
  ['paper', 'linen'],
  ['retro', 'graphite'],
  ['pine', 'graphite'],
  ['midnight', 'graphite'],
]);

/** The 1.0 id of a theme, given its id from any version before. Other values pass through. */
export function renamedThemeId(id: string): string {
  return RENAMED_THEME_IDS.get(id) ?? id;
}

/** Today's id of a theme, given its id from any version. Other values pass through. */
export function currentThemeId(id: string): string {
  const renamed = renamedThemeId(id);
  return RETIRED_THEME_IDS.get(renamed) ?? renamed;
}

/** Every theme id of an earlier version, with the theme it resolves to today. */
export const LEGACY_THEME_IDS: ReadonlyMap<string, ThemeId> = new Map(
  [...RENAMED_THEME_IDS.keys(), ...RETIRED_THEME_IDS.keys()].map((id) => [id, currentThemeId(id) as ThemeId]),
);

/** Fonts that are no longer bundled map to the closest family that is. */
export const LEGACY_FONT_IDS: ReadonlyMap<string, string> = new Map([
  ['lexend', 'outfit'],
  ['ibm-plex-sans', 'inter'],
  ['source-sans-3', 'open-sans'],
]);

/** Today's id of a font, given its id from any version. Other values pass through. */
export function currentFontId(id: string): string {
  return LEGACY_FONT_IDS.get(id) ?? id;
}
