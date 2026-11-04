// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardUiState } from '@/hooks/useKeyboardUi';
import { closeTopFloating, Menu, Popover } from './Menu';

let root: Root | null = null;
let host: HTMLElement;
const picked = vi.fn();

beforeEach(() => {
  picked.mockReset();
  useKeyboardUiState.setState({ finePointer: false, hardware: false, typed: false });
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
});

afterEach(() => {
  root?.unmount();
  root = null;
});

function show(...nodes: ReturnType<typeof h>[]) {
  root = createRoot(host);
  flushSync(() => root!.render(h('div', null, ...nodes)));
}

const menu = (label: string) =>
  h(Menu, {
    trigger: h('button', { type: 'button', 'data-trigger': label }, label),
    items: [
      { label: 'Settings', hint: 'S', onSelect: picked },
      { label: 'Tasks', badge: 3, badgeLabel: '3 due', onSelect: picked },
    ],
  });

/** The trigger (its id is the menu's own, for aria). */
const trigger = (name: string) => document.querySelector<HTMLElement>(`[data-trigger="${name}"]`)!;

async function open(name: string) {
  flushSync(() => trigger(name).click());
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
}

describe('Menu', () => {
  it('shows no keyboard shortcuts where there is no keyboard', async () => {
    show(menu('open'));
    await open('open');
    expect(document.querySelector('kbd')).toBeNull();
    expect(document.querySelector('[role="menu"]')!.textContent).toContain('Settings');
  });

  it('shows them once a keyboard is there', async () => {
    useKeyboardUiState.setState({ typed: true });
    show(menu('open'));
    await open('open');
    expect(document.querySelector('kbd')?.textContent).toBe('S');
  });

  it('shows a count with what it counts for a screen reader', async () => {
    show(menu('open'));
    await open('open');
    const tasks = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Tasks'))!;
    expect(tasks.querySelector('[aria-hidden="true"]')?.textContent).toBe('3');
    expect(tasks.querySelector('.sr-only')?.textContent).toBe('3 due');
  });

  it('is not seen in the corner before it is placed, and pops in where it belongs', async () => {
    show(menu('open'));
    flushSync(() => trigger('open').click());
    const panel = document.querySelector<HTMLElement>('[role="menu"]')!;
    // Mounted, not placed yet: unseen and not animating from the corner.
    expect(panel.style.opacity).toBe('0');
    expect(panel.classList.contains('animate-pop')).toBe(false);
    await vi.waitFor(() => expect(panel.classList.contains('animate-pop')).toBe(true));
    expect(panel.style.opacity).toBe('');
    // Placed by left/top: the animation's transform must not take the place over.
    expect(panel.style.transform).toBe('');
    expect(panel.style.left).toMatch(/px$/);
    expect(panel.style.top).toMatch(/px$/);
  });

  it('places a picker the same way', async () => {
    show(h(Popover, { trigger: h('button', { type: 'button', 'data-trigger': 'picker' }, 'Pick'), children: h('p', { id: 'panel' }, 'A month') }));
    flushSync(() => trigger('picker').click());
    const panel = document.getElementById('panel')!.parentElement!;
    expect(panel.style.opacity).toBe('0');
    await vi.waitFor(() => expect(panel.classList.contains('animate-pop')).toBe(true));
    expect(panel.style.opacity).toBe('');
    expect(panel.style.transform).toBe('');
  });

  it('is closed by the back button before anything else, the newest first', async () => {
    expect(closeTopFloating()).toBe(false);
    show(menu('first'), h(Popover, { trigger: h('button', { type: 'button', 'data-trigger': 'picker' }, 'Pick'), children: h('p', { id: 'panel' }, 'A month') }));
    await open('first');
    flushSync(() => trigger('picker').click());
    await vi.waitFor(() => expect(document.getElementById('panel')).not.toBeNull());
    // The picker came last: it closes first.
    flushSync(() => expect(closeTopFloating()).toBe(true));
    await vi.waitFor(() => expect(document.getElementById('panel')).toBeNull());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    flushSync(() => expect(closeTopFloating()).toBe(true));
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(closeTopFloating()).toBe(false);
  });
});
