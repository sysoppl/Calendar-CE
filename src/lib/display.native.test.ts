// The display on Android, with the native `Display` plugin stood in for.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hardwareKeyboard, systemFontScale, tellBackground } from './display';

const native = vi.hoisted(() => ({
  /** What the stand-in plugin answers next; a function that throws stands for a failed call. */
  fontScale: (): unknown => 1,
  hardware: (): unknown => false,
  asked: [] as string[],
  /** The colours the app was told to paint behind the page. */
  painted: [] as unknown[],
  /** Whether `setBackground` fails. */
  paintFails: false,
}));

vi.mock('@/lib/platform', async (original) => ({ ...(await original<typeof import('@/lib/platform')>()), isNative: true }));
vi.mock('@capacitor/core', async (original) => {
  const core = await original<typeof import('@capacitor/core')>();
  const display = {
    getFontScale: async () => {
      native.asked.push('getFontScale');
      return { fontScale: native.fontScale() };
    },
    getKeyboard: async () => {
      native.asked.push('getKeyboard');
      return { hardware: native.hardware() };
    },
    setBackground: async ({ color }: { color: unknown }) => {
      native.painted.push(color);
      if (native.paintFails) throw new Error('not implemented');
    },
  };
  return { ...core, registerPlugin: (name: string) => (name === 'Display' ? display : core.registerPlugin(name)) };
});

beforeEach(() => {
  native.fontScale = () => 1;
  native.hardware = () => false;
  native.asked = [];
  native.painted = [];
  native.paintFails = false;
});

describe('on Android', () => {
  it('reads the font scale from the system, unbounded (the bounds are the text scale’s)', async () => {
    for (const scale of [1, 1.15, 1.3, 2, 0.8]) {
      native.fontScale = () => scale;
      expect(await systemFontScale()).toBe(scale);
    }
    expect(native.asked).toEqual(Array(5).fill('getFontScale'));
  });

  it('takes 1 for an answer that is not a scale', async () => {
    for (const odd of [0, -1, Number.NaN, '1.2', null, undefined]) {
      native.fontScale = () => odd;
      expect(await systemFontScale(), String(odd)).toBe(1);
    }
  });

  it('rejects when the plugin fails, so that the last value read stays', async () => {
    native.fontScale = () => {
      throw new Error('not implemented');
    };
    await expect(systemFontScale()).rejects.toThrow('not implemented');
  });

  it('asks the system about a hardware keyboard', async () => {
    expect(await hardwareKeyboard()).toBe(false);
    native.hardware = () => true;
    expect(await hardwareKeyboard()).toBe(true);
    // Only a plain true counts.
    native.hardware = () => 'yes';
    expect(await hardwareKeyboard()).toBe(false);
    expect(native.asked).toEqual(['getKeyboard', 'getKeyboard', 'getKeyboard']);
  });

  it('tells the app the colour to paint behind the page', () => {
    tellBackground('#121417');
    tellBackground('#F5F5F3');
    expect(native.painted).toEqual(['#121417', '#F5F5F3']);
  });

  it('tells it only colours written #rrggbb, which the app reads', () => {
    for (const odd of ['', '#fff', '#12141780', 'black', 'rgb(0, 0, 0)', '#12141g', ' #121417']) tellBackground(odd);
    expect(native.painted).toEqual([]);
  });

  it('lets a failed call go: the window keeps its colour', async () => {
    native.paintFails = true;
    expect(() => tellBackground('#000000')).not.toThrow();
    await Promise.resolve();
    expect(native.painted).toEqual(['#000000']);
  });
});
