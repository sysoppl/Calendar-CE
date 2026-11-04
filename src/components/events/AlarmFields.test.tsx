// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settings';
import { AlarmFields } from './AlarmFields';

let root: Root | null = null;

beforeEach(() => useSettings.setState({ language: 'en' }));

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

function render(alarms: number[]) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(h(AlarmFields, { alarms, allDay: false, onChange: () => {} })));
  return document.body.textContent ?? '';
}

describe('AlarmFields', () => {
  it('offers another notification up to five', () => {
    expect(render([0, 5, 10, 15])).toContain('Add notification');
  });

  it('says so at five, and keeps more that another app wrote', () => {
    const text = render([0, 5, 10, 15, 30, 60, 120]);
    expect(text).not.toContain('Add notification');
    expect(text).toContain('An event or a task can have up to 5 notifications.');
    expect(document.querySelectorAll('[aria-label="Remove notification"]')).toHaveLength(7);
  });
});
