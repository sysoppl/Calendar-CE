// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occurrence } from '@/lib/ical/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { EventPopover } from './EventPopover';

// As in the Android app: served from https://localhost, where Capacitor answers its own routes.
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => true, getPlatform: () => 'android' } };
});

const event = vi.hoisted(() => ({ location: '', url: undefined as string | undefined, description: '' }));

vi.mock('@/hooks/useCalendarData', () => ({
  useCalendarMap: () => new Map([['work', { id: 'work', name: 'Work', color: '#0a7268', readOnly: false }]]),
  getParsedObject: () => ({}),
  currentOccurrence: () => undefined,
  selfEmailsFor: () => new Set<string>(),
}));
vi.mock('@/lib/ical/events', () => ({
  eventDataFor: () => ({ title: 'Standup', ...event, attendees: [], organizer: undefined, alarms: [], allDay: false, busy: true, timezone: 'floating', rrule: undefined }),
}));

const occurrence = { key: 'standup', objectUrl: 'standup', calendarId: 'work', title: 'Standup', start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false } as Occurrence;
let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(() => {
  useSettings.setState({ language: 'en' });
  Object.assign(event, { location: '', url: undefined, description: '' });
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useUi.setState({ popover: null });
});

function open(data: Partial<typeof event>) {
  root?.unmount();
  document.body.innerHTML = '';
  Object.assign(event, data);
  useUi.setState({ popover: { occurrence, anchor: { x: 0, y: 0, width: 10, height: 10 } } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(h(EventPopover)));
}

const links = () => [...document.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a')].map((a) => a.getAttribute('href'));
const capFile = 'https://localhost/_capacitor_file_/x';
const capContent = 'https://localhost/_capacitor_content_/com.example.provider/invite.html';

describe('links in the event popover', () => {
  it("shows addresses on the app's own origin as plain text", () => {
    open({ location: capContent, url: capFile, description: `Details: ${capFile} and ${capContent}` });
    expect(links()).toEqual([]);
    const text = document.querySelector('[role="dialog"]')!.textContent!;
    expect(text).toContain(capFile);
    expect(text).toContain(capContent);
  });

  it('does not turn such a place into a map search either', () => {
    open({ location: 'HTTPS://localhost/_capacitor_file_/x' });
    expect(links()).toEqual([]);
  });

  it('keeps loopback and single-label hosts as text in the app', () => {
    open({ url: 'https://127.0.0.1/x', description: 'https://[::1]/a https://intranet/b http://localhost:5232/c' });
    expect(links()).toEqual([]);
  });

  it('links web pages elsewhere and an ordinary place to the map', () => {
    open({ location: 'Room 4.02', url: 'https://example.com/agenda', description: 'Notes: https://example.org/n.' });
    expect(links()).toEqual(['https://www.openstreetmap.org/search?query=Room%204.02', 'https://example.com/agenda', 'https://example.org/n']);
  });

  it('offers no Join button for a meeting room on a loopback host', () => {
    open({ description: 'https://meet.localhost/room' });
    expect(document.body.textContent).not.toContain('Join meeting');
    open({ description: 'https://meet.example.com/room' });
    expect(document.body.textContent).toContain('Join meeting');
  });
});
