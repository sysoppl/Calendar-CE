// @vitest-environment jsdom
// The text size on Android, where the app follows the system's font size by itself.
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

vi.mock('@/lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/platform')>()), isNative: true }));
vi.mock('@/theme/fonts', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/theme/fonts')>()), loadAllFonts: () => {} }));
// The system is set to 140 %; the app follows it up to 130 %.
vi.mock('@/hooks/useTextScale', () => ({ useTextScale: () => (useSettings.getState().textSize === 'system' ? 1.3 : (useSettings.getState().textSize as number)) }));

const { AppearanceSection } = await import('./AppearanceSection');

let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(async () => {
  useSettings.setState({ language: 'en', textSize: 'system' });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  root.render(h(AppearanceSection));
  await vi.waitFor(() => expect(follow()).not.toBeNull());
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ toasts: [] });
});

const follow = () => document.querySelector<HTMLButtonElement>('button[role="switch"]');
const size = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-pressed][aria-label="${name}"]`)!;

describe('The text size on Android', () => {
  it('follows the system, says by how much, and marks no size chosen by hand', () => {
    const toggle = follow()!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-labelledby')!)?.textContent).toBe(en['settings.textSize.system']);
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe('Now 130%, as set in the system (up to 130%).');
    expect(document.querySelectorAll('[role="group"] button[aria-pressed="true"][aria-label]')).toHaveLength(0);
  });

  it('keeps the size on screen when the system is no longer followed, and follows it again', async () => {
    follow()!.click();
    expect(useSettings.getState().textSize).toBe(1.2);
    await vi.waitFor(() => expect(size('Very large').getAttribute('aria-pressed')).toBe('true'));
    expect(follow()!.getAttribute('aria-checked')).toBe('false');
    size('Normal').click();
    // "Normal" is a size of its own here, not the system's.
    expect(useSettings.getState().textSize).toBe(1);
    follow()!.click();
    expect(useSettings.getState().textSize).toBe('system');
  });

  it('turns following off by choosing a size', () => {
    size('Small').click();
    expect(useSettings.getState().textSize).toBe(0.9);
  });
});
