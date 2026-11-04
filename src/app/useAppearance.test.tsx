// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { refreshSystemFontScale, textScale, useTextScale } from '@/hooks/useTextScale';
import { useAppearance } from './useAppearance';

const system = vi.hoisted(() => ({ scale: 1 as number | Error }));
vi.mock('@/lib/display', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/display')>()),
  systemFontScale: () => (system.scale instanceof Error ? Promise.reject(system.scale) : Promise.resolve(system.scale)),
}));

let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(() => {
  system.scale = 1;
  useSettings.setState({ language: 'en', textSize: 'system', density: 'comfortable', shape: 'rounded' });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  root?.unmount();
  root = null;
  system.scale = 1;
  await refreshSystemFontScale();
});

function Probe() {
  useAppearance();
  return h('span', { id: 'scale' }, String(useTextScale()));
}

async function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(h(Probe));
  await vi.waitFor(() => expect(document.getElementById('scale')).not.toBeNull());
}

const fontScale = () => document.documentElement.style.getPropertyValue('--font-scale');

describe('useAppearance', () => {
  it("sets the text scale to the system's font scale, within its bounds", async () => {
    system.scale = 1.2;
    await mount();
    await vi.waitFor(() => expect(fontScale()).toBe('1.2'));
    expect(textScale()).toBe(1.2);

    system.scale = 2;
    await refreshSystemFontScale();
    await vi.waitFor(() => expect(fontScale()).toBe('1.3'));
    system.scale = 0.5;
    await refreshSystemFontScale();
    await vi.waitFor(() => expect(fontScale()).toBe('0.85'));
  });

  it('uses a size chosen by hand over the system', async () => {
    system.scale = 1.25;
    useSettings.setState({ textSize: 1.1 });
    await mount();
    await vi.waitFor(() => expect(fontScale()).toBe('1.1'));
    useSettings.setState({ textSize: 'system' });
    await vi.waitFor(() => expect(fontScale()).toBe('1.25'));
  });

  it('keeps the last scale when the system cannot be asked', async () => {
    system.scale = 1.1;
    await mount();
    await vi.waitFor(() => expect(fontScale()).toBe('1.1'));
    system.scale = new Error('No display');
    await refreshSystemFontScale();
    expect(textScale()).toBe(1.1);
    expect(fontScale()).toBe('1.1');
  });

  it('marks density and shape on the document', async () => {
    useSettings.setState({ density: 'compact', shape: 'round' });
    await mount();
    await vi.waitFor(() => expect(document.documentElement.dataset.density).toBe('compact'));
    expect(document.documentElement.dataset.shape).toBe('round');
    expect(document.documentElement.lang).toBe('en');
  });
});
