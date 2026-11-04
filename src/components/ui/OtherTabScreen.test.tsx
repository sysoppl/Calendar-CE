// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadFailedScreen, OtherTabScreen } from './OtherTabScreen';

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
});

afterEach(() => {
  root.unmount();
});

function show(onUseHere = () => {}) {
  root = createRoot(host);
  flushSync(() => root.render(h(OtherTabScreen, { onUseHere })));
}

describe('OtherTabScreen', () => {
  it('says that the app runs elsewhere, in the language of the settings, and moves it here once', () => {
    localStorage.setItem('calendar.settings', JSON.stringify({ state: { language: 'pl' }, version: 1 }));
    const onUseHere = vi.fn();
    show(onUseHere);
    expect(host.querySelector('h1')?.textContent).toBe('Kalendarz jest otwarty w innej karcie');
    expect(document.documentElement.lang).toBe('pl');

    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Użyj tutaj');
    flushSync(() => button.click());
    flushSync(() => button.click());
    expect(onUseHere).toHaveBeenCalledTimes(1);
    expect(button.textContent).toContain('Przełączanie na tę kartę…');
  });

  it('has a page of its own for an app that could not be loaded', () => {
    localStorage.setItem('calendar.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }));
    root = createRoot(host);
    flushSync(() => root.render(h(LoadFailedScreen)));
    expect(host.querySelector('h1')?.textContent).toBe('Something went wrong');
    expect(host.querySelector('button')?.textContent).toBe('Reload');
  });

  it('falls back to the language of the browser when the settings cannot be read', () => {
    localStorage.setItem('calendar.settings', '{not json');
    show();
    expect(host.querySelector('h1')?.textContent).toBe('Calendar is open in another tab');
  });

  describe('looks like the app', () => {
    beforeEach(() => {
      // The system asks for dark.
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark'), media: query, addEventListener() {}, removeEventListener() {} }));
      delete document.documentElement.dataset.theme;
    });
    afterEach(() => vi.unstubAllGlobals());

    const themeFor = (state: Record<string, unknown>) => {
      localStorage.setItem('calendar.settings', JSON.stringify({ state: { language: 'en', ...state }, version: 4 }));
      show();
      const theme = document.documentElement.dataset.theme;
      root.unmount();
      root = createRoot(host);
      return theme;
    };

    it('is light when nothing was chosen, whatever the system says', () => {
      expect(themeFor({})).toBe('daylight');
      expect(themeFor({ themeMode: 'fixed' })).toBe('daylight');
    });

    it('takes the theme chosen to be always on', () => {
      expect(themeFor({ themeMode: 'fixed', theme: 'graphite' })).toBe('graphite');
    });

    it('follows the system only when that was chosen', () => {
      expect(themeFor({ themeMode: 'system', lightTheme: 'daylight', darkTheme: 'graphite' })).toBe('graphite');
    });
  });
});
