// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { AppearanceSection, nearestTextSize } from './AppearanceSection';

vi.mock('@/theme/fonts', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/theme/fonts')>()), loadAllFonts: () => {} }));

// Nothing here may reach a server: the network is closed, and checked to be untouched after each test.
const network = vi.hoisted(() => ({ fetch: vi.fn(() => Promise.reject(new Error('No network in this test'))) }));
vi.stubGlobal('fetch', network.fetch);
afterEach(() => {
  expect(network.fetch).not.toHaveBeenCalled();
});
let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  root.render(h(AppearanceSection));
  await vi.waitFor(() => expect(sizeButton('Normal')).not.toBeNull());
}

beforeEach(async () => {
  useSettings.setState({ language: 'en', textSize: 'system' });
  await mount();
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ toasts: [], settings: null });
});

/** A text size, by its name: the buttons show an "A" of their size. */
function sizeButton(name: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-pressed][aria-label="${name}"]`);
}

describe('The text size in Appearance', () => {
  it('shows following the system as "Normal" in a browser, which applies its own size', () => {
    expect(sizeButton('Normal')!.getAttribute('aria-pressed')).toBe('true');
    expect(sizeButton('Large')!.getAttribute('aria-pressed')).toBe('false');
    // In a browser there is no system size to follow apart from the browser's own.
    expect(document.body.textContent).not.toContain(en['settings.textSize.system']);
  });

  it('keeps a size chosen by hand, and goes back to following the system with "Normal"', async () => {
    sizeButton('Large')!.click();
    expect(useSettings.getState().textSize).toBe(1.1);
    await vi.waitFor(() => expect(sizeButton('Large')!.getAttribute('aria-pressed')).toBe('true'));
    expect(sizeButton('Normal')!.getAttribute('aria-pressed')).toBe('false');
    sizeButton('Very small')!.click();
    expect(useSettings.getState().textSize).toBe(0.85);
    sizeButton('Normal')!.click();
    expect(useSettings.getState().textSize).toBe('system');
  });

  it('draws five sizes as letters of growing size that fit a phone on one line', () => {
    const group = sizeButton('Normal')!.closest('[role="group"]')!;
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Very small', 'Small', 'Normal', 'Large', 'Very large']);
    expect(buttons.every((b) => b.textContent === 'A')).toBe(true);
    const sizes = buttons.map((b) => parseFloat((b.querySelector('[style]') as HTMLElement).style.fontSize));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    // A grid that shares the width, never wrapping a size onto a line of its own.
    expect(group.className).toContain('grid');
    expect(group.className).not.toContain('flex-wrap');
    // Named by the row's label.
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(en['settings.fontScale']);
  });

  it('turns a system scale into the nearest size offered when the system is no longer followed', () => {
    expect(nearestTextSize(1.3)).toBe(1.2);
    expect(nearestTextSize(0.8)).toBe(0.85);
    expect(nearestTextSize(1.04)).toBe(1);
  });
});

describe('The look in Appearance', () => {
  const cards = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].map((b) => b.textContent ?? '').filter((name) => /^(Daylight|Linen|Graphite|Night|High contrast)$/.test(name));

  it('offers no style presets', () => {
    expect(document.body.textContent).not.toMatch(/Style preset|Focus|Airy/);
  });

  it('offers the five themes when one theme is always on', async () => {
    useSettings.getState().update({ themeMode: 'fixed', theme: 'daylight' });
    await vi.waitFor(() => expect(cards()).toEqual(['Daylight', 'Linen', 'Graphite', 'Night', 'High contrast']));
  });

  it('offers the light themes for light and the dark ones for dark when following the system', async () => {
    useSettings.getState().update({ themeMode: 'system' });
    const under = (heading: string) => {
      const title = [...document.querySelectorAll('div.font-semibold')].find((e) => e.textContent === heading);
      return title ? [...title.nextElementSibling!.querySelectorAll('button')].map((b) => b.textContent) : [];
    };
    await vi.waitFor(() => expect(under(en['settings.lightTheme'])).toEqual(['Daylight', 'Linen']));
    expect(under(en['settings.darkTheme'])).toEqual(['Graphite', 'Night', 'High contrast']);
  });

  it('draws the theme cards and the event style preview in the palette of today', () => {
    const html = document.body.innerHTML;
    // Red, blue and green in the cards; red, blue and gold in the preview.
    for (const rgb of ['rgb(209, 46, 44)', 'rgb(29, 108, 214)', 'rgb(27, 128, 55)', 'rgb(175, 135, 0)']) expect(html).toContain(rgb);
    expect(html).not.toMatch(/rgb\(145, 113, 240\)|rgb\(232, 53, 87\)|rgb\(236, 150, 7\)/);
  });

  it('lays four event styles out two by two on a phone, and the others across the width', () => {
    const groupOf = (label: string) => document.getElementById([...document.querySelectorAll('label[id]')].find((l) => l.textContent === label)!.id)!.closest('div')!.parentElement!.querySelector('[role="group"]')!;
    expect(groupOf(en['settings.eventStyle']).className).toContain('max-sm:grid-cols-2');
    expect(groupOf(en['settings.shape']).className).not.toContain('max-sm:grid-cols-2');
    expect(groupOf(en['settings.shape']).className).toContain('auto-cols-fr');
  });

  it('shows font names on up to two lines instead of cutting them short', () => {
    const name = [...document.querySelectorAll('button span')].find((s) => s.textContent === 'Atkinson Hyperlegible Next');
    if (name) {
      expect(name.className).toContain('line-clamp-2');
      expect(name.className).not.toContain('truncate');
    }
    for (const card of document.querySelectorAll('[data-font-grid] button')) {
      const name = card.querySelector('span:not([class*="text-xl"])')!;
      expect(name.className).toContain('line-clamp-2');
      // A finger-sized card on a touch screen.
      expect(card.className).toContain('min-h-[var(--touch,0px)]');
    }
  });

  it('saves a change and says so', async () => {
    vi.useFakeTimers();
    try {
      [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent === en['settings.density.compact'])!.click();
      expect(useSettings.getState().density).toBe('compact');
      await vi.advanceTimersByTimeAsync(1000);
      expect(useUi.getState().toasts.map((t) => t.message)).toContain(en['save.saved']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('A theme id of an earlier version', () => {
  it('shows the theme it resolves to as chosen', async () => {
    // Stored settings of version 4 are read as they are, so an old id may stay in them.
    useSettings.setState({ themeMode: 'fixed', theme: 'paper' });
    await vi.waitFor(() => {
      const chosen = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')].map((b) => b.textContent);
      expect(chosen).toContain('Linen');
    });
  });
});
