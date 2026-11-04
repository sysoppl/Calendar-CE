// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/color';
import { CALENDAR_COLORS, THEMES, applyTheme, themeById } from './themes';

const root = document.documentElement;
const token = (name: string) => root.style.getPropertyValue(`--${name}`);

afterEach(() => {
  root.removeAttribute('style');
  delete root.dataset.theme;
  document.head.innerHTML = '';
});

describe('applyTheme', () => {
  it('sets every token of the theme, its scheme, and the colour of the browser bar', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
    applyTheme(themeById('graphite'));
    expect(token('frame-bg')).toBe('#121417');
    expect(token('field-border')).toBe('#737578');
    expect(token('primary')).toBe('#ece7de');
    expect(root.dataset.theme).toBe('graphite');
    expect(root.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#121417');
  });

  it('puts in the accent colour as it reads in the theme, for every swatch and theme', () => {
    for (const theme of THEMES) {
      for (const { id, value } of CALENDAR_COLORS) {
        applyTheme(theme, value);
        const primary = token('primary');
        for (const surface of [theme.tokens.bg, theme.tokens.bgElevated, theme.tokens.frameBg]) {
          expect(contrastRatio(primary, surface), `${id} in ${theme.id}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(token('primary-contrast'), primary), `${id} label in ${theme.id}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(token('primary-contrast'), token('primary-hover')), `${id} label on hover in ${theme.id}`).toBeGreaterThanOrEqual(4.5);
        expect(token('primary-weak')).toContain(primary);
      }
    }
  });

  it("goes back to the theme's own colours without an accent", () => {
    applyTheme(themeById('daylight'), '#d12e2c');
    expect(token('primary')).not.toBe('#1e2227');
    applyTheme(themeById('daylight'), '');
    expect(token('primary')).toBe('#1e2227');
    expect(token('primary-weak')).toBe('rgba(30, 34, 39, 0.1)');
    // Not a colour: ignored.
    applyTheme(themeById('daylight'), 'url(x)');
    expect(token('primary')).toBe('#1e2227');
  });
});
