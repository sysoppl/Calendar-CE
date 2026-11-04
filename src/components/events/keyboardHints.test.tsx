// @vitest-environment jsdom
// What only a keyboard can use is shown only with a keyboard (hooks/useKeyboardUi.ts).
import { act, createElement as h, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventData } from '@/lib/ical/types';
import { useKeyboardUiState } from '@/hooks/useKeyboardUi';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { AppRail } from '@/components/layout/AppRail';
import { ParticipantsRow } from './EventFields';
import { EventEditor } from './EventEditor';

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  useSettings.setState({ language: 'en' });
  useKeyboardUiState.setState({ finePointer: false, hardware: false, typed: false });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useUi.setState({ eventEditor: null });
});

function draw(element: ReactElement) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

const event = (): EventData =>
  ({ title: '', description: '', location: '', start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false, timezone: 'Europe/Warsaw', alarms: [], busy: true, attendees: [], categories: [] }) as unknown as EventData;

describe('adding guests', () => {
  it('says to tap Add without a keyboard, and Add adds the typed address', () => {
    let data = event();
    const set = (patch: Partial<EventData>) => {
      data = { ...data, ...patch };
      flushSync(() => root!.render(h(ParticipantsRow, { data, set, calendarId: 'cal', hint: true })));
    };
    const host = draw(h(ParticipantsRow, { data, set, calendarId: 'cal', hint: true }));
    expect(host.textContent).toContain('Type an address and tap Add');
    const input = host.querySelector('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'anna@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    act(() => add.click());
    expect(data.attendees.map((a) => a.email)).toEqual(['anna@example.com']);
  });

  it('says to press Enter with a keyboard', () => {
    useKeyboardUiState.setState({ typed: true });
    const host = draw(h(ParticipantsRow, { data: event(), set: () => {}, calendarId: 'cal', hint: true }));
    expect(host.textContent).toContain('Type an email and press Enter');
  });
});

describe('the editor', () => {
  it('shows "Ctrl+Enter to save" only while a keyboard is there', () => {
    useUi.setState({ eventEditor: { mode: 'create', data: event(), calendarId: 'cal' } });
    draw(h(EventEditor));
    const hint = [...document.querySelectorAll('p')].find((p) => p.textContent === 'Ctrl+Enter to save')!;
    expect(hint.classList).toContain('hidden');
    expect(hint.classList).toContain('keys:block');
  });
});

describe('the tools rail', () => {
  it('has the shortcuts button only with a keyboard', () => {
    let host = draw(h(AppRail));
    expect(host.querySelector('button[aria-label="Keyboard shortcuts"]')).toBeNull();
    act(() => root!.unmount());
    useKeyboardUiState.setState({ hardware: true });
    host = draw(h(AppRail));
    expect(host.querySelector('button[aria-label="Keyboard shortcuts"]')).not.toBeNull();
  });
});
