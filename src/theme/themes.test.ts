import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { pl } from '@/i18n/pl';
import { DEFAULT_CALENDAR_COLOR, DEFAULT_HOLIDAY_COLOR, DEFAULT_TASK_COLOR, contrastRatio as contrast, isHexColor, mixHex, readableText } from '@/lib/color';
import { FONTS, fontById } from './fonts';
import { LEGACY_FONT_IDS, LEGACY_THEME_IDS, currentFontId, currentThemeId, renamedThemeId } from './legacy';
import { CALENDAR_COLORS, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, THEMES, accentTokens, isSwatch, randomCalendarColor, swatchColor, themeById } from './themes';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const messages = (dictionary: Record<string, string>, keys: string[]) => keys.map((key) => dictionary[key]);

/** The colour `c` at `alpha` over `bg`, as CSS draws a tint. */
const over = (bg: string, c: string, alpha: number) => mixHex(bg, c, alpha);

describe('themes', () => {
  const ids = THEMES.map((t) => t.id);

  it('are the five of our own, with the documented defaults', () => {
    expect(ids).toEqual(['daylight', 'linen', 'graphite', 'night', 'high-contrast']);
    expect(THEMES.filter((t) => !t.dark).map((t) => t.id)).toEqual(['daylight', 'linen']);
    expect(themeById(DEFAULT_LIGHT_THEME)).toMatchObject({ id: 'daylight', dark: false });
    expect(themeById(DEFAULT_DARK_THEME)).toMatchObject({ id: 'graphite', dark: true });
    // The style presets went with the themes they put together.
    expect(existsSync(join(root, 'src/theme/presets.ts'))).toBe(false);
  });

  it('are named in both languages', () => {
    const keys = ids.map((id) => `theme.${id}`);
    for (const dictionary of [en, pl]) {
      const found = messages(dictionary, keys);
      expect(found.every(Boolean)).toBe(true);
      expect(new Set(found).size).toBe(ids.length);
    }
    expect(messages(en, keys)).toEqual(['Daylight', 'Linen', 'Graphite', 'Night', 'High contrast']);
    expect(messages(pl, keys)).toEqual(['Dzień', 'Len', 'Grafit', 'Noc', 'Wysoki kontrast']);
  });

  /** Every theme id of every earlier version, with whether that theme was dark, and where it goes now. */
  const OLD_THEMES: [id: string, dark: boolean, now: string][] = [
    // 1.0
    ['ink', false, 'daylight'],
    ['harbor', false, 'daylight'],
    ['dusk', false, 'daylight'],
    ['azure', false, 'daylight'],
    ['paper', false, 'linen'],
    ['retro', true, 'graphite'],
    ['pine', true, 'graphite'],
    ['midnight', true, 'graphite'],
    // Before 1.0
    ['snow', false, 'daylight'],
    ['classic', false, 'daylight'],
    ['legacy', false, 'daylight'],
    ['carbon', true, 'graphite'],
    ['monokai', true, 'graphite'],
    ['contrast', true, 'high-contrast'],
  ];

  it('resolve the ids of every earlier version to the nearest theme of the same lightness', () => {
    for (const [old, dark, now] of OLD_THEMES) {
      expect(themeById(old), old).toMatchObject({ id: now, dark });
      expect(currentThemeId(old)).toBe(now);
      expect(LEGACY_THEME_IDS.get(old)).toBe(now);
    }
    expect(LEGACY_THEME_IDS.size).toBe(OLD_THEMES.length);
    for (const [old, now] of LEGACY_THEME_IDS) {
      expect(ids).not.toContain(old);
      expect(ids).toContain(now);
      expect(themeById(old).id).toBe(now);
    }
    expect([...LEGACY_THEME_IDS.values()].filter((now) => now === 'linen')).toHaveLength(1);
    expect([...LEGACY_THEME_IDS.values()].filter((now) => now === 'graphite')).toHaveLength(5);
    // The ids of today stay as they are.
    for (const id of ids) expect(currentThemeId(id)).toBe(id);
  });

  it('tell the renaming of 1.0 apart from the retirement of 1.1', () => {
    // The step of settings version 3 only renames, so version 4 can still tell an untouched look.
    expect(renamedThemeId('classic')).toBe('ink');
    expect(renamedThemeId('snow')).toBe('daylight');
    expect(renamedThemeId('pine')).toBe('pine');
    expect(renamedThemeId('nope')).toBe('nope');
  });

  it('fall back to the default for an unknown id', () => {
    for (const id of ['', 'nope', 'constructor', '__proto__', 'toString']) expect(themeById(id).id).toBe('daylight');
    expect(currentThemeId('nope')).toBe('nope');
  });

  it('keep text readable (WCAG AA) in every theme', () => {
    for (const { id, tokens } of THEMES) {
      expect(contrast(tokens.text, tokens.bg), `${id} text`).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens.text, tokens.bgElevated), `${id} text on elevated`).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens.frameText, tokens.frameBg), `${id} frame text`).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens.textWeak, tokens.bg), `${id} weak text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.frameTextWeak, tokens.frameBg), `${id} weak frame text`).toBeGreaterThanOrEqual(4.5);
      for (const surface of [tokens.bg, tokens.bgWeak]) expect(contrast(tokens.textHint, surface), `${id} hint on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.primaryContrast, tokens.primary), `${id} label on primary`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.primaryContrast, tokens.primaryHover), `${id} label on hover`).toBeGreaterThanOrEqual(4.5);
      for (const surface of [tokens.bg, tokens.bgElevated, tokens.frameBg]) {
        expect(contrast(tokens.primary, surface), `${id} primary as text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens.dangerContrast, tokens.danger), `${id} label on danger`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.danger, tokens.bg), `${id} danger as text`).toBeGreaterThanOrEqual(4.5);
      // A selected item in the sidebar.
      if (isHexColor(tokens.frameActive)) expect(contrast(tokens.frameText, tokens.frameActive), `${id} frame text on active`).toBeGreaterThanOrEqual(7);
    }
  });

  it('keep the primary readable on its own tint', () => {
    for (const { id, dark, tokens } of THEMES) {
      const [, r, g, b, a] = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(tokens.primaryWeak)!;
      const weak = `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
      expect(contrast(tokens.primary, over(tokens.bg, weak, Number(a))), `${id} primary on primaryWeak`).toBeGreaterThanOrEqual(dark ? 4.5 : 4.9);
    }
  });

  it('outline form fields at 3:1 against the page (WCAG 1.4.11)', () => {
    for (const { id, tokens } of THEMES) {
      for (const surface of [tokens.bg, tokens.bgElevated]) expect(contrast(tokens.fieldBorder, surface), `${id} field border`).toBeGreaterThanOrEqual(3);
    }
  });

  it('use the ink of the brand, and no violet', () => {
    expect(themeById('daylight').tokens).toMatchObject({ primary: '#1e2227', primaryHover: '#3a4048', primaryContrast: '#ffffff' });
    expect(themeById('graphite').tokens).toMatchObject({ primary: '#ece7de', primaryContrast: '#16191c' });
    for (const { id, tokens } of THEMES) {
      for (const value of Object.values(tokens)) {
        for (const hex of value.match(/#[0-9a-f]{6}/g) ?? []) {
          const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          // Violet: blue and red both well above green.
          expect(b > g + 40 && r > g + 30, `${id} ${hex}`).toBe(false);
        }
      }
    }
  });

  it('match the first-paint tokens in the stylesheet', () => {
    const css = read('src/styles/index.css');
    const block = css.slice(css.indexOf(':root {'), css.indexOf('--app-font'));
    const declared = Object.fromEntries([...block.matchAll(/--([a-z-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]));
    const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const expected = Object.fromEntries(Object.entries(themeById('daylight').tokens).map(([k, v]) => [kebab(k), v]));
    expect(declared).toEqual(expected);
    // Form fields are drawn with their own outline token.
    expect(css).toMatch(/\.field \{[^}]*border: 1px solid var\(--field-border\);/);
  });

  it('size the text from the browser default, times the text size', () => {
    expect(read('src/styles/index.css')).toMatch(/html \{\s*(?:\/\*[\s\S]*?\*\/\s*)?font-size: calc\(100% \* var\(--font-scale\)\);/);
  });

  it('match the colours of the page and the installed app, light from the first frame', () => {
    const { primary, frameBg } = themeById('daylight').tokens;
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${frameBg}" />`);
    for (const file of ['public/manifest.webmanifest', 'public/manifest.pl.webmanifest']) {
      const manifest = JSON.parse(read(file)) as { theme_color: string; background_color: string };
      expect(manifest.theme_color, file).toBe(frameBg);
      expect(manifest.background_color, file).toBe(frameBg);
    }
    const colors = read('android/app/src/main/res/values/colors.xml').toLowerCase();
    expect(primary).toBe('#1e2227');
    expect(colors).toContain(`<color name="colorprimary">${primary}</color>`);
    expect(colors).toContain(`<color name="coloraccent">${primary}</color>`);
    expect(colors).toContain(`<color name="colorprimarydark">${themeById('daylight').tokens.primaryHover}</color>`);
    expect(colors).toContain('<color name="brand">#1e2227</color>');
    expect(colors).toContain(`<color name="surface">${frameBg}</color>`);
  });
});

describe('the accent colour', () => {
  it('is moved until it reads, as text and as a button, in every theme', () => {
    for (const theme of THEMES) {
      const { bg, bgElevated, frameBg } = theme.tokens;
      for (const swatch of [...CALENDAR_COLORS.map((c) => c.value), '#ffff00', '#000000', '#ffffff', '#808080', '#0e8a7e', '#1e2227']) {
        const t = accentTokens(swatch, theme);
        const where = `${swatch} in ${theme.id}`;
        for (const surface of [bg, bgElevated, frameBg]) expect(contrast(t.primary, surface), `${where} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primaryContrast, t.primary), `${where} label`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primaryContrast, t.primaryHover), `${where} label on hover`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primary, over(bg, t.primary, theme.dark ? 0.16 : 0.12)), `${where} on its tint`).toBeGreaterThanOrEqual(4.5);
        expect(t.primaryContrast).toBe(readableText(t.primary));
        expect(t.primaryWeak).toBe(`color-mix(in srgb, ${t.primary} ${theme.dark ? 16 : 12}%, transparent)`);
      }
    }
  });

  it('stays as picked where it reads already, and moves the least it must', () => {
    expect(accentTokens('#0a7268', themeById('daylight')).primary).toBe('#0a7268');
    expect(accentTokens('#4fd1bf', themeById('graphite')).primary).toBe('#4fd1bf');
    // Too light for a light page: darker. Too dark for a dark page: lighter.
    const gold = accentTokens('#af8700', themeById('daylight')).primary;
    expect(contrast(gold, '#ffffff')).toBeGreaterThan(contrast('#af8700', '#ffffff'));
    expect(contrast(mixHex('#af8700', '#000000', 0), '#f5f5f3')).toBeLessThan(4.5);
    const blue = accentTokens('#1d6cd6', themeById('graphite')).primary;
    expect(contrast(blue, '#1a1c1f')).toBeGreaterThan(contrast('#1d6cd6', '#1a1c1f'));
  });
});

describe('the calendar palette', () => {
  const values = CALENDAR_COLORS.map((c) => c.value);

  it('is one set of sixteen unique, well-formed colours in hue order', () => {
    expect(CALENDAR_COLORS.map((c) => c.id)).toEqual(['red', 'orange', 'gold', 'lime', 'green', 'mint', 'teal', 'sky', 'blue', 'indigo', 'lavender', 'purple', 'magenta', 'pink', 'brown', 'gray']);
    expect(new Set(values).size).toBe(16);
    for (const c of CALENDAR_COLORS) expect(c.value, c.id).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('carries readable text on every swatch, white where white reads', () => {
    const dark = ['gold', 'lime', 'mint', 'sky', 'lavender', 'pink'];
    for (const c of CALENDAR_COLORS) {
      const text = readableText(c.value);
      expect(contrast(text, c.value), c.id).toBeGreaterThanOrEqual(5);
      expect(text, c.id).toBe(dark.includes(c.id) ? '#141619' : '#ffffff');
    }
  });

  it('stands out as a dot on the page of every theme', () => {
    for (const { id, tokens } of THEMES) {
      for (const c of CALENDAR_COLORS) expect(contrast(c.value, tokens.bg), `${c.id} on ${id}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('is named in both languages', () => {
    const keys = CALENDAR_COLORS.map((c) => `color.${c.id}`);
    for (const dictionary of [en, pl]) {
      const found = messages(dictionary, [...keys, 'color.custom']);
      expect(found.every(Boolean)).toBe(true);
      expect(new Set(found).size).toBe(keys.length + 1);
    }
    expect(messages(en, keys).slice(0, 3)).toEqual(['Red', 'Orange', 'Gold']);
    expect(messages(pl, keys).slice(0, 3)).toEqual(['Czerwony', 'Pomarańczowy', 'Złoty']);
  });

  it('contains the colours the app picks itself, red for calendars, blue for tasks, green for holidays', () => {
    expect([DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR, DEFAULT_HOLIDAY_COLOR]).toEqual([swatchColor('red'), swatchColor('blue'), swatchColor('green')]);
    for (const color of [DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR, DEFAULT_HOLIDAY_COLOR]) expect(isSwatch(color)).toBe(true);
    expect(isSwatch('#9171f0')).toBe(false);
    expect(isSwatch(undefined)).toBe(false);
  });

  it('hands a new calendar a lively colour, never gray or brown', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(randomCalendarColor());
    expect(seen.has(swatchColor('gray'))).toBe(false);
    expect(seen.has(swatchColor('brown'))).toBe(false);
    for (const color of seen) expect(values).toContain(color);
    expect(seen.size).toBe(14);
  });
});

describe('fonts', () => {
  const ids = FONTS.map((f) => f.id);

  it('have unique ids and fall back to the default', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(fontById('nope').id).toBe('inter');
    expect(fontById('constructor').id).toBe('inter');
    expect(fontById('outfit').stack).toContain("'Outfit Variable'");
  });

  it('resolve the ids of families that were renamed or dropped', () => {
    expect(fontById('lexend').id).toBe('outfit');
    expect(fontById('ibm-plex-sans').id).toBe('inter');
    expect(fontById('source-sans-3').id).toBe('open-sans');
    expect(LEGACY_FONT_IDS.size).toBe(3);
    for (const [old, now] of LEGACY_FONT_IDS) {
      expect(ids).not.toContain(old);
      expect(ids).toContain(now);
      expect(currentFontId(old)).toBe(now);
      expect(fontById(old).id).toBe(now);
    }
  });

  it('bundle exactly the font packages the app depends on', () => {
    const source = read('src/theme/fonts.ts');
    const used = [...source.matchAll(/import\('(@fontsource-variable\/[a-z0-9-]+)\/index\.css'\)/g)].map((m) => m[1]);
    const dependencies = Object.keys((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies).filter((d) => d.startsWith('@fontsource-variable/'));
    // Inter is the default and is imported statically, not through the list.
    expect([...used, '@fontsource-variable/inter'].sort()).toEqual(dependencies.sort());
    expect(used).toHaveLength(FONTS.filter((f) => f.load).length);
  });
});
