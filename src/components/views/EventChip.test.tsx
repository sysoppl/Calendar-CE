// @vitest-environment jsdom
import { createElement as h, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BarChip, CLIP_FADE, DotChip, TaskChip, TimedChipContent } from './EventChip';

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
});

function draw(element: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host.firstElementChild as HTMLElement;
}

const classes = (el: Element) => [...el.classList];
const title = (chip: HTMLElement, text: string) => [...chip.querySelectorAll('span')].find((s) => s.textContent === text)!;

describe('BarChip', () => {
  it("is the phone's chip when dense: 11 px medium text, cut with a fade, no ellipsis", () => {
    const chip = draw(h(BarChip, { dense: true, title: 'Przegląd auta', color: '#0a7268', eventStyle: 'filled' }));
    expect(classes(chip)).toEqual(expect.arrayContaining(['text-[0.6875rem]', 'font-medium', 'pl-1', 'pr-px', 'rounded-l-sm', 'rounded-r-sm']));
    const span = title(chip, 'Przegląd auta');
    expect(span.className).not.toContain('truncate');
    for (const c of CLIP_FADE.split(' ')) expect(span.classList).toContain(c);
    expect(span.className).toContain('[mask-image:');
  });

  it('stays as it was on a computer', () => {
    const chip = draw(h(BarChip, { title: 'Przegląd auta', color: '#0a7268', eventStyle: 'filled' }));
    expect(classes(chip)).toEqual(expect.arrayContaining(['text-[0.75rem]', 'font-semibold', 'px-1.5', 'rounded-l-md']));
    expect(title(chip, 'Przegląd auta').classList).toContain('truncate');
  });

  it('keeps square ends where the event goes on in the next or previous week', () => {
    const chip = draw(h(BarChip, { dense: true, title: 'Wyjazd', color: '#0a7268', eventStyle: 'filled', continuesBefore: true, continuesAfter: true }));
    expect(classes(chip)).toEqual(expect.arrayContaining(['rounded-l-none', 'rounded-r-none']));
  });
});

describe('TimedChipContent', () => {
  const props = { title: 'PROJEKT demo', time: '9:00 – 10:00', color: '#0a7268', eventStyle: 'filled' as const };

  it('gives a phone a title over as many lines as the chip has room for, and the time only where it fits', () => {
    const chip = draw(h(TimedChipContent, { ...props, heightPx: 54, phone: true }));
    const span = title(chip, 'PROJEKT demo');
    expect(span.style.webkitLineClamp || span.style.getPropertyValue('-webkit-line-clamp')).toBe('3');
    expect(span.className).not.toContain('truncate');
    expect(title(chip, '9:00 – 10:00').classList).toContain('@[4rem]:block');
    expect(chip.classList).toContain('px-1');
  });

  it('cuts a short phone chip on one line with a fade', () => {
    const chip = draw(h(TimedChipContent, { ...props, heightPx: 26, phone: true }));
    const span = title(chip, 'PROJEKT demo');
    expect(span.className).not.toContain('truncate');
    expect(span.className).toContain('[mask-image:');
  });

  it('stays as it was on a computer', () => {
    const chip = draw(h(TimedChipContent, { ...props, heightPx: 54 }));
    expect(title(chip, 'PROJEKT demo').classList).toContain('truncate');
    expect(chip.classList).toContain('px-1.5');
  });
});

describe('TaskChip', () => {
  it("marks a task with a ring on a phone, which is no checkbox too small for a finger", () => {
    const chip = draw(h(TaskChip, { dense: true, title: 'Pay rent', color: '#0a7268', completed: false, onToggle: () => {} }));
    expect(chip.querySelector('[role="checkbox"]')).toBeNull();
    expect(chip.querySelector('[data-task-ring]')).not.toBeNull();
    expect(title(chip, 'Pay rent').className).toContain('[mask-image:');
  });

  it('keeps its checkbox elsewhere', () => {
    const chip = draw(h(TaskChip, { title: 'Pay rent', color: '#0a7268', completed: false, onToggle: () => {} }));
    expect(chip.querySelector('[role="checkbox"]')).not.toBeNull();
  });
});

describe('DotChip', () => {
  it('shows a past event in the weaker text colour, not faded out', () => {
    const chip = draw(h(DotChip, { title: 'Standup', time: '9:00', color: '#0a7268', past: true }));
    expect(chip.className).not.toContain('opacity');
    expect(title(chip, 'Standup').classList).toContain('text-text-weak');
  });
});
