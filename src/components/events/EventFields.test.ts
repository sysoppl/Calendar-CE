// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { eventDataFor, expandEvent } from '@/lib/ical/events';
import { parseObject } from '@/lib/ical/parse';
import type { EventData } from '@/lib/ical/types';
import type { Calendar } from '@/store/data';
import { CalendarRow } from './EventFields';

let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
});

const calendar: Calendar = { id: 'cal', accountId: 'local', name: 'Work', color: '#069c8d', components: ['VEVENT'], readOnly: false, visible: true, order: 0 };

/** An event as a CalDAV server, an import or an invitation may hand it over, as the editor reads it. */
function eventWithColor(color: string) {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', 'UID:c1', 'DTSTART:20261014T090000Z', 'DTEND:20261014T100000Z', 'SUMMARY:Call', `COLOR:${color}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const obj = parseObject({ url: 'https://x.test/cal/c1.ics', etag: '"1"', calendarId: 'cal', data: ics })!;
  const [occ] = expandEvent(obj, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 10, 1)));
  return eventDataFor(obj, occ);
}

/** The colour dot beside the calendar select. */
function swatch(data: EventData): HTMLElement {
  const r = createRoot(document.body.appendChild(document.createElement('div')));
  root = r;
  flushSync(() => r.render(h(CalendarRow, { data, set: () => {}, calendars: [calendar], calendarId: 'cal', onCalendar: () => {} })));
  return document.querySelector<HTMLElement>('button[aria-label] > span.rounded-full')!;
}

const BEACON = 'url(https://tracker.example/beacon?u=victim)';

describe('CalendarRow', () => {
  it('never gets an event colour that is not a colour from calendar data', () => {
    expect(eventWithColor(BEACON).color).toBeUndefined();
    const dot = swatch(eventWithColor(BEACON));
    expect(dot.getAttribute('style')).not.toContain('url(');
    // The calendar's colour stands in.
    expect(dot.style.background).toBe('rgb(6, 156, 141)');
  });

  it('never puts an event colour that is not a colour into CSS, even one that got past the reader', () => {
    // The check where the colour is used stays, for values that reach it some other way.
    for (const color of [BEACON, 'red;background:url(x)', 'expression(alert(1))']) {
      const dot = swatch({ ...eventWithColor('#d0021b'), color });
      expect(dot.getAttribute('style')).not.toMatch(/url\(|expression/);
      expect(dot.style.background).toBe('rgb(6, 156, 141)');
      root?.unmount();
      root = undefined;
    }
  });

  it('shows an event colour that is one', () => {
    expect(swatch(eventWithColor('#d0021b')).style.background).toBe('rgb(208, 2, 27)');
  });

  it("drops a COLOR it cannot show, too, when the calendar's colour is chosen", () => {
    const data = eventWithColor('rgb(1,2,3)');
    expect(data.colorAsWritten).toBe('rgb(1,2,3)');
    const patches: Partial<EventData>[] = [];
    const r = createRoot(document.body.appendChild(document.createElement('div')));
    root = r;
    flushSync(() => r.render(h(CalendarRow, { data, set: (patch) => patches.push(patch), calendars: [calendar], calendarId: 'cal', onCalendar: () => {} })));

    flushSync(() => document.querySelector<HTMLElement>('button[aria-label] > span.rounded-full')!.parentElement!.click());
    const inherit = document.querySelector<HTMLElement>('button[aria-pressed="true"]')!;
    expect(inherit.textContent).toMatch(/calendar/i);
    flushSync(() => inherit.click());

    expect(patches).toHaveLength(1);
    expect(patches[0]).toHaveProperty('colorAsWritten', undefined);
    expect(patches[0]).toHaveProperty('color', undefined);
  });
});
