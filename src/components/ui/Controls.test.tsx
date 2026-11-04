// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { SegmentedControl, SettingGroup, SettingRow, ToggleRow } from './Controls';

let root: Root | null = null;

beforeEach(() => {
  useSettings.setState({ language: 'en' });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  root?.unmount();
  root = null;
});

async function render(node: Parameters<Root['render']>[0]) {
  root = createRoot(document.getElementById('root')!);
  root.render(node);
  await vi.waitFor(() => expect(document.getElementById('root')!.childElementCount).toBeGreaterThan(0));
}

describe('ToggleRow', () => {
  it('puts the label and the switch on one line, the switch at the end', async () => {
    await render(h(ToggleRow, { label: 'Show weekends', hint: 'Saturday and Sunday', checked: false, onChange: () => {} }));
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    const row = toggle.parentElement!.parentElement!;
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');
    expect(row.className).not.toContain('flex-col');
    expect(row.lastElementChild!.contains(toggle)).toBe(true);
    expect(toggle.parentElement!.className).toContain('shrink-0');
    // At least 56 px tall: a finger hits it anywhere.
    expect(row.className).toContain('min-h-14');
  });

  it('is named by its label and described by its hint', async () => {
    await render(h(ToggleRow, { label: 'Show weekends', hint: 'Saturday and Sunday', checked: true, onChange: () => {} }));
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-labelledby')!)?.textContent).toBe('Show weekends');
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe('Saturday and Sunday');
    expect(toggle.hasAttribute('aria-label')).toBe(false);
  });

  it('switches with a tap on its text as well as on the switch', async () => {
    const onChange = vi.fn();
    await render(h(ToggleRow, { label: 'Show weekends', hint: 'Saturday and Sunday', checked: false, onChange }));
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    const label = document.querySelector<HTMLLabelElement>('label')!;
    expect(label.htmlFor).toBe(toggle.id);
    // The hint is part of what can be tapped.
    expect(label.contains(document.getElementById(toggle.getAttribute('aria-describedby')!))).toBe(true);
    label.click();
    toggle.click();
    expect(onChange.mock.calls).toEqual([[true], [true]]);
  });

  it('moves its knob without sliding where motion is reduced', async () => {
    await render(h(ToggleRow, { label: 'Show weekends', checked: false, onChange: () => {} }));
    const knob = document.querySelector('[role="switch"] [data-knob]')!;
    expect(knob.className.split(' ')).toEqual(expect.arrayContaining(['transition-transform', 'motion-reduce:transition-none']));
  });
});

describe('SettingRow', () => {
  it('stacks the control under the label on a phone, side by side from sm', async () => {
    await render(h(SettingRow, { label: 'Language', htmlFor: 'x', children: h('select', { id: 'x' }) }));
    const row = document.querySelector('select')!.parentElement!.parentElement!;
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('sm:flex-row');
  });

  it('puts a short select at the end of the label line when inline, named without its hint', async () => {
    await render(h(SettingRow, { inline: true, label: 'Custom view length', hint: 'Days in the N days view', htmlFor: 'x', children: h('select', { id: 'x' }) }));
    const select = document.querySelector('select')!;
    const row = select.parentElement!.parentElement!;
    expect(row.className).not.toContain('flex-col');
    expect(row.className).toContain('items-center');
    expect(document.querySelector('label[for="x"]')!.textContent).toBe('Custom view length');
    expect(row.textContent).toContain('Days in the N days view');
  });

  it('writes hints at 13 px', async () => {
    await render(h(SettingRow, { label: 'Days', hint: 'In the N days view', children: h('span') }));
    const hint = [...document.querySelectorAll('span')].find((s) => s.textContent === 'In the N days view')!;
    expect(hint.className).toContain('text-[0.8125rem]');
  });
});

describe('SettingGroup', () => {
  it('is a section named by its heading', async () => {
    await render(h(SettingGroup, { title: 'Calendar view', children: h('p', null, 'x') }));
    const section = document.querySelector('section')!;
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent).toBe('Calendar view');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'a', label: 'Monday' },
    { value: 'b', label: 'Sunday' },
    { value: 'c', label: 'Saturday' },
  ];

  it('wraps its segments when it is not full', async () => {
    await render(h(SegmentedControl<string>, { value: 'a', options, onChange: () => {}, label: 'Week starts' }));
    const group = document.querySelector('[role="group"]')!;
    expect(group.className).toContain('flex-wrap');
    expect(group.getAttribute('aria-label')).toBe('Week starts');
  });

  it('shares the whole width on a phone when full, with no segment wrapped onto a line of its own', async () => {
    await render(h(SegmentedControl<string>, { value: 'b', options, onChange: () => {}, full: true }));
    const group = document.querySelector('[role="group"]')!;
    for (const c of ['grid', 'w-full', 'grid-flow-col', 'auto-cols-fr']) expect(group.className.split(/\s+/)).toContain(c);
    expect(group.className).not.toContain('flex-wrap');
    // A label that does not fit is cut, not broken over lines.
    expect(group.querySelector('button span')!.className).toContain('truncate');
    expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('lays out two by two on a phone when asked', async () => {
    await render(h(SegmentedControl<string>, { value: 'a', options: [...options, { value: 'd', label: 'Friday' }], onChange: () => {}, full: true, phoneColumns: 2 }));
    expect(document.querySelector('[role="group"]')!.className).toContain('max-sm:grid-cols-2');
  });

  it('names segments drawn as glyphs', async () => {
    const onChange = vi.fn();
    await render(h(SegmentedControl<number>, { value: 1, options: [{ value: 1, label: 'A', name: 'Normal' }, { value: 2, label: 'A', name: 'Large' }], onChange, full: true }));
    const large = document.querySelector<HTMLButtonElement>('button[aria-label="Large"]')!;
    large.click();
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('gives its segments a finger-sized height on a touch screen', async () => {
    await render(h(SegmentedControl<string>, { value: 'a', options, onChange: () => {}, full: true }));
    expect(document.querySelector('[role="group"] button')!.className).toContain('min-h-[var(--touch,0px)]');
  });
});
