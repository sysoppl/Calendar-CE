// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventData } from '@/lib/ical/types';
import { MilestoneRow } from './EventFields';

let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = '';
});

const event = (over: Partial<EventData> = {}): EventData => ({
  uid: 'u1',
  title: 'Anna’s birthday',
  description: '',
  location: '',
  start: new Date(2026, 9, 30),
  end: new Date(2026, 9, 31),
  allDay: true,
  timezone: 'floating',
  alarms: [],
  busy: false,
  attendees: [],
  categories: [],
  ...over,
});

function show(data: EventData, repeats = false) {
  const set = vi.fn();
  const repeatYearly = vi.fn();
  const r = createRoot(document.body.appendChild(document.createElement('div')));
  root = r;
  flushSync(() => r.render(h(MilestoneRow, { data, set, repeats, repeatYearly })));
  return { set, repeatYearly, input: document.querySelector<HTMLInputElement>('input[type="date"]') };
}

/** What React's onChange of a date input gets when its value becomes `value`. */
function pick(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MilestoneRow', () => {
  it('is there only while the title names a birthday or an anniversary', () => {
    expect(show(event({ title: 'Dentist', since: new Date(1990, 4, 12) })).input).toBeNull();
    expect(show(event()).input?.getAttribute('aria-label')).toBe('Birth date');
    root?.unmount();
    expect(show(event({ title: 'Wedding anniversary' })).input?.getAttribute('aria-label')).toBe('Counting from');
  });

  it('shows the years the event marks', () => {
    show(event({ start: new Date(2026, 4, 12), end: new Date(2026, 4, 13), since: new Date(1990, 4, 12) }));
    expect(document.body.textContent).toContain('Turns 36');
  });

  it('moves an event that does not repeat onto the day of its year and makes it yearly', () => {
    const { set, repeatYearly, input } = show(event());
    pick(input!, '1990-05-12');
    expect(set).toHaveBeenCalledWith({ since: new Date(1990, 4, 12), start: new Date(2026, 4, 12), end: new Date(2026, 4, 13) });
    expect(repeatYearly).toHaveBeenCalledOnce();
  });

  it('puts 29 February on the 28th, also in a leap year', () => {
    const { set, input } = show(event({ start: new Date(2028, 0, 10), end: new Date(2028, 0, 11) }));
    pick(input!, '2000-02-29');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ since: new Date(2000, 1, 29), start: new Date(2028, 1, 28) }));
  });

  it('moves an event on the old date’s day along when the date is corrected, without touching its repeat', () => {
    const { set, repeatYearly, input } = show(event({ start: new Date(2026, 4, 12), end: new Date(2026, 4, 13), since: new Date(1990, 4, 12) }), true);
    pick(input!, '1990-05-21');
    expect(set).toHaveBeenCalledWith({ since: new Date(1990, 4, 21), start: new Date(2026, 4, 21), end: new Date(2026, 4, 22) });
    expect(repeatYearly).not.toHaveBeenCalled();
  });

  it('keeps a date whose year is still being typed in the field, and gives the event only the whole one', () => {
    const { set, repeatYearly, input } = show(event());
    for (const typed of ['0001-09-19', '0019-09-19', '0199-09-19']) {
      pick(input!, typed);
      expect(input!.value).toBe(typed);
    }
    expect(set).not.toHaveBeenCalled();
    pick(input!, '1997-09-19');
    expect(set).toHaveBeenCalledWith({ since: new Date(1997, 8, 19), start: new Date(2026, 8, 19), end: new Date(2026, 8, 20) });
    expect(repeatYearly).toHaveBeenCalledOnce();
  });

  it('keeps a date that already has one while a new year is typed', () => {
    const { set, input } = show(event({ since: new Date(1990, 4, 12) }), true);
    pick(input!, '0002-05-12');
    expect(input!.value).toBe('0002-05-12');
    expect(set).not.toHaveBeenCalled();
    pick(input!, '');
    expect(set).toHaveBeenCalledWith({ since: undefined });
  });

  it('leaves the dates of a series elsewhere alone', () => {
    const { set, repeatYearly, input } = show(event(), true);
    pick(input!, '1990-05-12');
    expect(set).toHaveBeenCalledWith({ since: new Date(1990, 4, 12) });
    expect(repeatYearly).not.toHaveBeenCalled();
  });

  it('removes the date', () => {
    const { set } = show(event({ since: new Date(1990, 4, 12) }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove the date"]')!.click();
    expect(set).toHaveBeenCalledWith({ since: undefined });
  });
});
