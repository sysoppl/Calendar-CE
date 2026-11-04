import { describe, expect, it, vi } from 'vitest';
import { THEMES } from '@/theme/themes';
import { clampSystemTextScale, effectiveTextScale, hardwareKeyboard, systemFontScale, tellBackground } from './display';

/** Every call made to the native `Display` plugin, which a browser does not have. */
const calls = vi.hoisted(() => [] as string[]);
vi.mock('@capacitor/core', async (original) => {
  const core = await original<typeof import('@capacitor/core')>();
  const recorder = new Proxy({}, { get: (_, method) => async () => void calls.push(String(method)) });
  return { ...core, registerPlugin: (name: string) => (name === 'Display' ? recorder : core.registerPlugin(name)) };
});

describe('the text scale', () => {
  it('follows the system within 0.85 and 1.3', () => {
    expect(effectiveTextScale('system', 1)).toBe(1);
    expect(effectiveTextScale('system', 1.15)).toBe(1.15);
    expect(effectiveTextScale('system', 2)).toBe(1.3);
    expect(effectiveTextScale('system', 0.8)).toBe(0.85);
    expect(effectiveTextScale('system', 1.3)).toBe(1.3);
    expect(effectiveTextScale('system', 0.85)).toBe(0.85);
  });

  it('takes a size chosen by hand as it is', () => {
    expect(effectiveTextScale(1.1, 2)).toBe(1.1);
    expect(effectiveTextScale(0.85, 1.3)).toBe(0.85);
    expect(effectiveTextScale(1.5, 1)).toBe(1.5);
  });

  it('falls back to 1 on what is not a scale', () => {
    for (const odd of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(clampSystemTextScale(odd), String(odd)).toBe(1);
      expect(effectiveTextScale('system', odd), String(odd)).toBe(1);
      expect(effectiveTextScale(odd, 1.2), String(odd)).toBe(1);
    }
  });
});

describe('in a browser', () => {
  it('knows no system font scale and no hardware keyboard', async () => {
    expect(await systemFontScale()).toBe(1);
    expect(await hardwareKeyboard()).toBe(false);
  });

  it('asks nothing to be painted behind the page, which is the page itself', () => {
    for (const theme of THEMES) tellBackground(theme.tokens.frameBg);
    expect(calls).toEqual([]);
  });
});

describe('the background behind the page', () => {
  it('is a colour the apps can paint (#rrggbb) in every theme', () => {
    for (const theme of THEMES) expect(theme.tokens.frameBg, theme.id).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
