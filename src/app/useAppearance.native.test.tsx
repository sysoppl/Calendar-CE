// @vitest-environment jsdom
// The appearance in the Android app: the system bars follow the theme, and
// the app paints the frame colour behind the page, and the system's font size
// is read again when the app comes back to the front.
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { refreshSystemFontScale } from '@/hooks/useTextScale';
import { useAppearance } from './useAppearance';

const native = vi.hoisted(() => ({
  scale: 1,
  styles: [] as string[],
  colors: [] as string[],
  /** What the page told the app to paint behind it. */
  backgrounds: [] as string[],
  /** What `(prefers-color-scheme: dark)` answers. */
  dark: false,
  resume: [] as (() => void)[],
}));

vi.mock('@/lib/platform', async (original) => ({ ...(await original<typeof import('@/lib/platform')>()), isNative: true }));
vi.mock('@/lib/display', async (original) => ({
  ...(await original<typeof import('@/lib/display')>()),
  systemFontScale: () => Promise.resolve(native.scale),
  tellBackground: (color: string) => void native.backgrounds.push(color),
}));
vi.mock('@capacitor/status-bar', () => ({
  Style: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
  StatusBar: {
    setStyle: async ({ style }: { style: string }) => void native.styles.push(style),
    setBackgroundColor: async ({ color }: { color: string }) => void native.colors.push(color),
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: () => void) => {
      if (event === 'resume') native.resume.push(listener);
      return Promise.resolve({ remove: () => void native.resume.splice(native.resume.indexOf(listener), 1) });
    },
  },
}));

let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('dark') && native.dark, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(() => {
  native.scale = 1;
  native.styles = [];
  native.colors = [];
  native.backgrounds = [];
  native.dark = false;
  native.resume = [];
  useSettings.setState({ language: 'en', textSize: 'system', themeMode: 'fixed', theme: 'daylight', accentColor: '' });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  root?.unmount();
  root = null;
  native.scale = 1;
  await refreshSystemFontScale();
});

function Probe() {
  useAppearance();
  return h('span', { id: 'probe' });
}

async function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(h(Probe));
  await vi.waitFor(() => expect(document.getElementById('probe')).not.toBeNull());
}

const fontScale = () => document.documentElement.style.getPropertyValue('--font-scale');

describe('useAppearance in the app', () => {
  it('gives a light theme dark bar icons on its frame colour, and a dark theme light ones', async () => {
    await mount();
    await vi.waitFor(() => expect(native.styles).toEqual(['LIGHT']));
    expect(native.colors).toEqual(['#f5f5f3']);

    useSettings.setState({ theme: 'graphite' });
    await vi.waitFor(() => expect(native.styles).toEqual(['LIGHT', 'DARK']));
    expect(native.colors.at(-1)).toBe('#121417');

    useSettings.setState({ theme: 'linen' });
    await vi.waitFor(() => expect(native.styles.at(-1)).toBe('LIGHT'));
    useSettings.setState({ theme: 'night' });
    await vi.waitFor(() => expect(native.styles.at(-1)).toBe('DARK'));
    expect(native.colors.at(-1)).toBe('#000000');
  });

  it('paints the frame colour of the theme behind the page, and again whenever the theme changes', async () => {
    await mount();
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#f5f5f3']));

    useSettings.setState({ theme: 'graphite' });
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#f5f5f3', '#121417']));
    useSettings.setState({ theme: 'linen' });
    await vi.waitFor(() => expect(native.backgrounds.at(-1)).toBe('#f4f1ec'));
    useSettings.setState({ theme: 'night' });
    await vi.waitFor(() => expect(native.backgrounds.at(-1)).toBe('#000000'));
    // The same colour as the system bars, every time.
    expect(native.backgrounds).toEqual(native.colors);
  });

  it("paints the app's theme, not the system's: dark on a light system, light on a dark one", async () => {
    useSettings.setState({ themeMode: 'fixed', theme: 'graphite' });
    await mount();
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#121417']));
    root?.unmount();

    native.dark = true;
    native.backgrounds = [];
    useSettings.setState({ themeMode: 'fixed', theme: 'daylight' });
    await mount();
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#f5f5f3']));
    root?.unmount();

    // Following the system: the dark theme chosen for it on a dark system, the light one on a light system.
    native.backgrounds = [];
    useSettings.setState({ themeMode: 'system', lightTheme: 'linen', darkTheme: 'night' });
    await mount();
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#000000']));
    root?.unmount();

    native.dark = false;
    native.backgrounds = [];
    await mount();
    await vi.waitFor(() => expect(native.backgrounds).toEqual(['#f4f1ec']));
  });

  it("reads the system's font size again when the app comes back to the front", async () => {
    native.scale = 1.15;
    await mount();
    await vi.waitFor(() => expect(fontScale()).toBe('1.15'));
    await vi.waitFor(() => expect(native.resume).toHaveLength(1));

    // Changed in the system's settings meanwhile.
    native.scale = 1.6;
    native.resume[0]();
    await vi.waitFor(() => expect(fontScale()).toBe('1.3'));

    root?.unmount();
    root = null;
    await vi.waitFor(() => expect(native.resume).toHaveLength(0));
  });
});
