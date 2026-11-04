// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Sidebar } from './Sidebar';

let root: Root | null = null;

beforeEach(() => {
  // A phone: the sidebar is a drawer.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: /max-width/.test(query), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  useSettings.setState({ language: 'en' });
  useUi.setState({ sidebarOpen: true });
  document.body.innerHTML = '';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useUi.setState({ sidebarOpen: false });
});

describe('The drawer on a touch screen', () => {
  it('is wide enough for 44 px days in its mini calendar, and only there', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    root.render(h(Sidebar));
    await vi.waitFor(() => expect(host.querySelector('aside')).not.toBeNull());
    const drawer = host.querySelector('aside')!;
    // 21rem less the scroller's 0.75rem on each side leaves 7 columns of 44 px on a 390 px phone (86vw = 335 px).
    expect(drawer.classList).toContain('pointer-coarse:w-[min(21rem,86vw)]');
    expect(drawer.classList).toContain('w-[min(var(--sidebar-width),86vw)]');
    const grid = drawer.querySelector('button[aria-current="date"]')!.closest('.select-none')!.parentElement!;
    expect([...grid.classList]).toEqual(['px-1', 'pb-4', 'pointer-coarse:px-0']);
  });

  it('closes on a tap on the dimmed page beside it, not on the click of the tap that opened it', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    root.render(h(Sidebar));
    await vi.waitFor(() => expect(host.querySelector('aside')).not.toBeNull());
    const backdrop = host.querySelector('aside')!.parentElement!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(useUi.getState().sidebarOpen).toBe(true);
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(useUi.getState().sidebarOpen).toBe(false);
  });
});
