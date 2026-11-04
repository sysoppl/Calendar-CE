import { describe, expect, it } from 'vitest';
import { DARK_TEXT, DEFAULT_CALENDAR_COLOR, contrastRatio, eventColor, mixHex } from '@/lib/color';
import type { EventStyle } from '@/store/settings';
import { CALENDAR_COLORS, themeById } from '@/theme/themes';
import { chipColors, type ChipState } from './chipColors';

const STYLES: EventStyle[] = ['filled', 'tonal', 'soft', 'outline'];

/** Every colour a style puts into CSS, as one text. */
const css = (color: string, style: EventStyle, tentative = false) => JSON.stringify(chipColors(color, style, { tentative }).style);

/** The value of a CSS colour the chip styles use, in a theme: hex, a token, or a color-mix of those. */
function resolve(value: string, theme: string): string {
  const tokens = themeById(theme).tokens as unknown as Record<string, string>;
  const token = /^var\(--([a-z-]+)\)$/.exec(value);
  if (token) return tokens[token[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
  const mix = /^color-mix\(in srgb, (.+) (\d+)%, (var\(--[a-z-]+\))\)$/.exec(value);
  if (mix) return mixHex(resolve(mix[3], theme), resolve(mix[1], theme), Number(mix[2]) / 100);
  return value;
}

describe('chipColors', () => {
  it('shows the named colours an event dot shows, instead of the default colour', () => {
    // The dot and the popover show eventColor(...); the chip has to show the same.
    const color = eventColor('turquoise', '#123456');
    expect(color).toBe('turquoise');
    expect(chipColors(color, 'filled').style).toMatchObject({ background: 'turquoise', color: DARK_TEXT });
    expect(chipColors('navy', 'filled').style).toMatchObject({ background: 'navy', color: '#ffffff' });
    expect(chipColors('turquoise', 'soft').style).toMatchObject({ background: 'rgba(64, 224, 208, 0.18)', boxShadow: 'inset 3px 0 0 turquoise' });
    expect(chipColors('turquoise', 'outline').style.boxShadow).toBe('inset 0 0 0 1.5px turquoise');
    for (const style of STYLES) expect(css('turquoise', style), style).not.toContain(DEFAULT_CALENDAR_COLOR);
  });

  it('shows a colour with an alpha channel as it looks over the page', () => {
    const color = eventColor('#ff000080', '#123456');
    expect(color).toBe('#ff000080');
    const solid = 'color-mix(in srgb, rgb(255, 0, 0) 50%, var(--bg))';
    // Pink over a light page, dark red over a dark one: the page's own text colour reads on both.
    expect(chipColors(color, 'filled').style).toMatchObject({ background: solid, color: 'var(--text)' });
    expect(chipColors('#ff000040', 'filled').style.color).toBe('var(--text)');
    // Dark over either page: white.
    expect(chipColors('#000080cc', 'filled').style.color).toBe('#ffffff');
    expect(chipColors(color, 'soft').style.background).toBe('rgba(255, 0, 0, 0.09)');
    expect(chipColors(color, 'tonal').style.background).toBe(`color-mix(in srgb, ${solid} 30%, var(--bg))`);
    for (const style of STYLES) expect(css(color, style, true), style).not.toContain(DEFAULT_CALENDAR_COLOR);
    // Without an alpha below one, the colour is used as it is.
    expect(chipColors('#3a7f', 'filled').style.background).toBe('#3a7f');
  });

  it('still keeps anything that is not a colour out of CSS', () => {
    for (const bad of ['url(https://tracker.example/x)', 'red;background:url(x)', 'var(--primary)', '']) {
      for (const style of STYLES) {
        const text = css(bad, style, true);
        expect(text, `${style} ${bad}`).toContain(DEFAULT_CALENDAR_COLOR);
        expect(text).not.toMatch(/url\(|var\(--primary\)/);
      }
    }
  });
});

describe('past and declined events', () => {
  const STATES: ChipState[] = [{}, { past: true }, { reply: 'DECLINED' }, { past: true, tentative: true }, { reply: 'TENTATIVE' }, { reply: 'NEEDS-ACTION', past: true }, { cancelled: true, past: true }];

  it('are never made transparent: their text keeps its contrast', () => {
    for (const style of STYLES) for (const state of STATES) expect(chipColors('#1d6cd6', style, state).style.opacity, `${style} ${JSON.stringify(state)}`).toBeUndefined();
  });

  it('turn a filled block into a 45% tint with the page text', () => {
    expect(chipColors('#1d6cd6', 'filled', { past: true })).toEqual({
      style: { background: 'color-mix(in srgb, #1d6cd6 45%, var(--bg))', color: 'var(--text)' },
      textClass: '',
      subClass: 'opacity-85',
    });
    // Striped for "maybe", with the same tint.
    expect(String(chipColors('#1d6cd6', 'filled', { past: true, tentative: true }).style.background)).toMatch(/^repeating-linear-gradient\(135deg, color-mix\(in srgb, #1d6cd6 45%, var\(--bg\)\)/);
  });

  it('turn a tonal or soft block into an 18% tint with the page text', () => {
    expect(chipColors('#1d6cd6', 'tonal', { past: true }).style).toEqual({ background: 'color-mix(in srgb, #1d6cd6 18%, var(--bg))', color: 'var(--text)' });
    expect(chipColors('#1d6cd6', 'soft', { past: true }).style).toMatchObject({ background: 'color-mix(in srgb, #1d6cd6 18%, var(--bg))', color: 'var(--text)', boxShadow: 'inset 3px 0 0 rgba(29, 108, 214, 0.5)' });
  });

  it('fade an outline to half its colour, with the weaker text', () => {
    expect(chipColors('#1d6cd6', 'outline', { past: true }).style).toEqual({ background: 'var(--bg)', color: 'var(--text-weak)', boxShadow: 'inset 0 0 0 1.5px rgba(29, 108, 214, 0.5)' });
    expect(chipColors('#1d6cd6', 'outline', { past: true, tentative: true }).style).toMatchObject({ outline: '1.5px dashed rgba(29, 108, 214, 0.5)' });
    expect(chipColors('#1d6cd6', 'outline').style).toMatchObject({ color: 'var(--text)', boxShadow: 'inset 0 0 0 1.5px #1d6cd6' });
  });

  it('show a declined invitation struck through and faded, in every style, past or not', () => {
    for (const style of STYLES) {
      const chip = chipColors('#1d6cd6', style, { reply: 'DECLINED' });
      expect(chip.textClass, style).toBe('line-through');
      expect(chip.style, style).toEqual(chipColors('#1d6cd6', 'outline', { past: true }).style);
    }
  });
});

describe('chip text on the palette', () => {
  const themes = ['daylight', 'linen', 'graphite', 'night', 'high-contrast'];

  it('reads at 4.5:1 or more on every swatch, in every style, past or not, in every theme', () => {
    for (const theme of themes) {
      for (const { id, value } of CALENDAR_COLORS) {
        for (const style of STYLES) {
          for (const state of [{}, { past: true }, { reply: 'DECLINED' as const }]) {
            const { style: s } = chipColors(value, style, state);
            const bg = resolve(String(s.background), theme);
            // The soft style's tint is translucent: as it shows over the page.
            const solid = /^rgba/.test(bg) ? mixHex(resolve('var(--bg)', theme), value, Number(/([\d.]+)\)$/.exec(bg)![1])) : bg;
            const text = resolve(String(s.color), theme);
            expect(contrastRatio(text, solid), `${id} ${style} ${JSON.stringify(state)} in ${theme}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('keeps the filled text of every swatch at 5:1 in the default themes', () => {
    for (const { id, value } of CALENDAR_COLORS) {
      const { style } = chipColors(value, 'filled');
      expect(contrastRatio(String(style.color), value), id).toBeGreaterThanOrEqual(5);
    }
  });
});
