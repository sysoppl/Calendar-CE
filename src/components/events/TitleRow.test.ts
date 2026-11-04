// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventData } from '@/lib/ical/types';
import { TitleRow } from './EventFields';

let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = '';
});

const event = (over: Partial<EventData> = {}): EventData => ({
  uid: 'u1',
  title: 'Surprise party',
  description: '',
  location: '',
  start: new Date(2026, 9, 30, 18),
  end: new Date(2026, 9, 30, 21),
  allDay: false,
  timezone: 'floating',
  alarms: [],
  busy: true,
  attendees: [],
  categories: [],
  ...over,
});

function show(data: EventData) {
  const set = vi.fn();
  const r = createRoot(document.body.appendChild(document.createElement('div')));
  root = r;
  flushSync(() => r.render(h(TitleRow, { data, set })));
  return { set, toggle: document.querySelector<HTMLButtonElement>('button[aria-label="Hide the name"]')! };
}

describe('TitleRow', () => {
  it('hides the name with a switch beside the title', () => {
    const { set, toggle } = show(event());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.body.textContent).not.toContain('Hidden event');
    toggle.click();
    expect(set).toHaveBeenCalledWith({ hidden: true });
  });

  it('says what a hidden event looks like, and shows the name again', () => {
    const { set, toggle } = show(event({ hidden: true }));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-describedby')).toBe(document.querySelector('p')!.id);
    expect(document.body.textContent).toContain('The calendar shows “Hidden event” until the event is opened.');
    toggle.click();
    expect(set).toHaveBeenCalledWith({ hidden: false });
  });
});
