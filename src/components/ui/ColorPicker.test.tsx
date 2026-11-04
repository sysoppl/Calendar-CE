// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settings';
import { CALENDAR_COLORS } from '@/theme/themes';
import { ColorPicker } from './ColorPicker';

let root: Root | undefined;

beforeEach(() => {
  useSettings.setState({ language: 'en' });
  document.body.innerHTML = '';
});

afterEach(() => {
  root?.unmount();
  root = undefined;
});

function render(props: Parameters<typeof ColorPicker>[0]) {
  const r = createRoot(document.body.appendChild(document.createElement('div')));
  root = r;
  flushSync(() => r.render(h(ColorPicker, props)));
}

const swatches = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')];
const customField = () => document.querySelector<HTMLInputElement>('input[type="color"]')!;

describe('ColorPicker', () => {
  it('offers the one palette, sixteen named swatches, and a colour of one own', () => {
    render({ value: '#007c73', onChange: () => {} });
    expect(swatches().map((b) => b.getAttribute('aria-label'))).toEqual(['Red', 'Orange', 'Gold', 'Lime', 'Green', 'Mint', 'Teal', 'Sky', 'Blue', 'Indigo', 'Lavender', 'Purple', 'Magenta', 'Pink', 'Brown', 'Gray']);
    expect(customField().getAttribute('aria-label')).toBe('Custom color');
    // No palette headings any more.
    expect(document.body.textContent).not.toMatch(/Vivid|Natural/);
    expect(swatches().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.title)).toEqual(['Teal']);
  });

  it('hands on the swatch picked, and a custom colour', () => {
    const picked: string[] = [];
    render({ value: '#007c73', onChange: (c) => picked.push(c) });
    swatches().find((b) => b.title === 'Gold')!.click();
    expect(picked).toEqual(['#af8700']);
  });

  it('shows a colour from outside the palette as the custom one, with its value', () => {
    // A calendar keeps its colour of before: violet is not a swatch any more.
    render({ value: '#9171F0', onChange: () => {} });
    expect(swatches().some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(customField().value).toBe('#9171f0');
    expect(document.body.textContent).toContain('#9171f0');
  });

  it('gives the colour field a #rrggbb value for a short colour', () => {
    render({ value: '#3a7', onChange: () => {} });
    expect(customField().value).toBe('#33aa77');
  });

  it('starts the colour field at the default colour when nothing custom is chosen', () => {
    render({ value: '#1d6cd6', onChange: () => {} });
    expect(customField().value).toBe('#d12e2c');
    expect(document.body.textContent).not.toMatch(/#[0-9a-f]{6}/);
  });

  it('puts the option to inherit first, pressed while no colour is set', () => {
    let cleared = 0;
    render({ value: undefined, onChange: () => {}, inherit: { label: 'Calendar color', color: '#1d6cd6', onSelect: () => cleared++ } });
    const first = document.querySelector('button')!;
    expect(first.textContent).toBe('Calendar color');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    first.click();
    expect(cleared).toBe(1);
  });

  it('draws the swatches it names', () => {
    render({ onChange: () => {} });
    const dots = swatches().map((b) => (b.firstElementChild as HTMLElement).style.background);
    expect(dots).toHaveLength(CALENDAR_COLORS.length);
    expect(dots[0]).toBe('rgb(209, 46, 44)');
  });
});
