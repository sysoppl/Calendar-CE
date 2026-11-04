// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { ROOT_ERROR_OPTIONS } from '@/components/ui/ErrorScreen';
import { App } from './App';

const SECRET = 'Dentist with Anna';

// The first screen of a new install, broken on purpose.
vi.mock('@/components/onboarding/Onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/onboarding/Onboarding')>()),
  Onboarding: () => {
    throw new TypeError(`cannot read '${SECRET}'`);
  },
}));

let root: Root | null = null;
let host: HTMLElement;
let logged: MockInstance<typeof console.error>;
const realInit = useData.getState().init;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
});

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useSettings.setState({ language: 'en' });
});

afterEach(() => {
  root?.unmount();
  root = null;
  useData.setState({ init: realInit });
  vi.restoreAllMocks();
});

const consoleText = () => logged.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

describe('App', () => {
  it('says so when the data on this device cannot be opened, instead of loading for ever', async () => {
    useData.setState({ init: () => Promise.reject(new DOMException(`no store for ${SECRET}`, 'InvalidStateError')) });
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(App));
    await vi.waitFor(() => expect(host.textContent).toContain('The data kept on this device could not be opened'));
    expect(host.textContent).toContain('start/InvalidStateError');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Reload');
    // No spinner left behind it.
    expect(host.querySelector('svg.animate-spin')).toBeNull();
    expect(host.textContent).not.toContain(SECRET);
    expect(consoleText()).toContain('start/InvalidStateError');
    expect(consoleText()).not.toContain(SECRET);
  });

  it('says so calmly when the start takes long, and drops it once the start is done', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // A store that never answers: no failure, no end.
      let finish = () => {};
      useData.setState({ hydrated: false, init: () => new Promise<void>((resolve) => (finish = resolve)) });
      root = createRoot(host, ROOT_ERROR_OPTIONS);
      root.render(h(App));
      await vi.advanceTimersByTimeAsync(14_900);
      expect(host.querySelector('svg.animate-spin')).not.toBeNull();
      expect(host.textContent).not.toContain('longer than usual');
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(host.textContent).toContain('Calendar is taking longer than usual to start'));
      expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Reload');
      // Not turned into a failure: the spinner is still there, and no error code.
      expect(host.querySelector('svg.animate-spin')).not.toBeNull();
      expect(host.textContent).not.toContain('Something went wrong');

      // The start gets there after all: the next screen (in this file, the broken welcome screen) takes over.
      finish();
      useData.setState({ hydrated: true });
      await vi.waitFor(() => expect(host.querySelector('svg.animate-spin')).toBeNull());
      expect(host.textContent).not.toContain('longer than usual');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the failure page when a screen cannot be drawn', async () => {
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(App));
    await vi.waitFor(() => expect(host.textContent).toContain('Something went wrong'), { timeout: 5000 });
    expect(host.textContent).toContain('render/TypeError');
    expect(host.textContent).not.toContain(SECRET);
    expect(consoleText()).not.toContain(SECRET);
  });
});
