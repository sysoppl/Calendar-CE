// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { MiniCalendar } from './MiniCalendar';

let root: Root | null = null;

beforeEach(() => {
  useSettings.setState({ language: 'en', weekStartsOn: 1, showWeekNumbers: false });
  document.body.innerHTML = '';
});

afterEach(() => {
  root?.unmount();
  root = null;
});

async function show(props: Partial<Parameters<typeof MiniCalendar>[0]> = {}) {
  const onSelect = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  root.render(h(MiniCalendar, { selected: new Date(2026, 9, 20), onSelect, ...props }));
  await vi.waitFor(() => expect(host.querySelectorAll('button[aria-label*="2026"]').length).toBe(42));
  const day = (n: number) => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label*="October"][aria-label*="2026"]')].find((b) => b.textContent === String(n))!;
  return { host, onSelect, day };
}

const classes = (el: Element) => el.className.split(/\s+/);

describe('MiniCalendar on a touch screen', () => {
  it('makes each day a 44 px target and keeps the drawn day as it is', async () => {
    const { day } = await show();
    const button = day(20);
    // A mouse gets the 28 px circle as before; a finger the whole cell, 44 px tall.
    expect(classes(button)).toEqual(expect.arrayContaining(['h-7', 'w-7', 'rounded-full', 'pointer-coarse:h-11', 'pointer-coarse:w-full']));
    const circle = button.firstElementChild!;
    expect(classes(circle)).toEqual(expect.arrayContaining(['h-7', 'w-7', 'rounded-full']));
    // What a day looks like is drawn on the circle, never on the larger target.
    expect(classes(circle).some((c) => c.startsWith('bg-'))).toBe(true);
    expect(classes(button).some((c) => /^(hover:)?bg-/.test(c))).toBe(false);
    // Every class of the target that is not the desktop circle's applies to a coarse pointer only.
    const desktop = new Set(['group', 'relative', 'flex', 'h-7', 'w-7', 'items-center', 'justify-center', 'rounded-full', 'disabled:pointer-events-none', 'disabled:opacity-30']);
    expect(classes(button).filter((c) => !desktop.has(c) && !c.startsWith('pointer-coarse:'))).toEqual([]);
  });

  it('picks the day from anywhere on the target', async () => {
    const { day, onSelect } = await show();
    (day(14).firstElementChild as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 9, 14));
  });

  it('keeps days before the earliest one closed', async () => {
    const { day, onSelect } = await show({ min: new Date(2026, 9, 10) });
    expect(day(9).disabled).toBe(true);
    expect(day(10).disabled).toBe(false);
    day(9).click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('gives the arrows 44 px on a touch screen only', async () => {
    const { host } = await show();
    for (const name of ['Previous', 'Next']) {
      const arrow = host.querySelector(`button[aria-label="${name}"]`)!;
      expect(classes(arrow)).toContain('pointer-coarse:size-11');
      expect(classes(arrow)).toContain('p-1.5');
    }
  });
});
