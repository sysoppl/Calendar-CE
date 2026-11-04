// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useSettings } from '@/store/settings';
import { ErrorBoundary, ErrorScreen, ROOT_ERROR_OPTIONS, errorCode, logFailure } from './ErrorScreen';

// What an event could put into an error message: it must not reach the page or the console.
const SECRET = 'Dentist with Anna at 10:00';

function Thrower(): never {
  throw new TypeError(`invalid date-time value: '${SECRET}'`);
}

let root: Root | null = null;
let host: HTMLElement;
let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  useSettings.setState({ language: 'en' });
});

afterEach(() => {
  root?.unmount();
  root = null;
  logged.mockRestore();
});

const consoleText = () => logged.mock.calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ')).join('\n');

describe('ErrorBoundary', () => {
  it('shows the failure page instead of a child that throws, with a code and without the message', async () => {
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(ErrorBoundary, null, h('p', null, 'before'), h(Thrower)));
    await vi.waitFor(() => expect(host.textContent).toContain('Something went wrong'));
    expect(host.textContent).toContain('render/TypeError');
    expect(host.textContent).not.toContain('Dentist');
    expect(host.textContent).not.toContain('before');
    const reload = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reload');
    expect(reload).toBeDefined();
    // A screen reader starts at the heading of the page that replaced the app.
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));

    // Logged once, by the boundary, with the code and where it happened, and nothing of the message.
    expect(logged).toHaveBeenCalled();
    expect(consoleText()).toContain('render/TypeError');
    expect(consoleText()).toContain('Thrower');
    expect(consoleText()).not.toContain('Dentist');
  });

  it('speaks the language of the app', async () => {
    useSettings.setState({ language: 'pl' });
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(ErrorBoundary, null, h(Thrower)));
    await vi.waitFor(() => expect(host.textContent).toContain('Coś poszło nie tak'));
    expect(host.textContent).toContain('Wczytaj ponownie');
  });

  it('leaves a page behind even when the error gets past every boundary', async () => {
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(Thrower));
    await vi.waitFor(() => expect(host.textContent).toContain('Something went wrong'));
    expect(host.textContent).toContain('render/TypeError');
    expect(host.querySelector('button')?.textContent).toBe('Reload');
    expect(host.textContent).not.toContain('Dentist');
    expect(consoleText()).not.toContain('Dentist');
    root = null;
  });
});

describe('ROOT_ERROR_OPTIONS', () => {
  it('reports a screen that failed once and was then drawn, without the message', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let tries = 0;
    function Flaky() {
      if (tries++ === 0) throw new TypeError(`invalid date-time value: '${SECRET}'`);
      return h('p', null, 'drawn');
    }
    root = createRoot(host, ROOT_ERROR_OPTIONS);
    root.render(h(Flaky));
    await vi.waitFor(() => expect(host.textContent).toBe('drawn'));
    // React's own report would carry the first error, message and all, as its cause.
    await vi.waitFor(() => expect(warned).toHaveBeenCalled());
    const text = warned.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(text).toContain('render/TypeError');
    expect(text).toContain('Flaky');
    expect(text).not.toContain('Dentist');
    expect(consoleText()).not.toContain('Dentist');
    warned.mockRestore();
  });
});

describe('ErrorScreen', () => {
  it('reloads the app from its button', async () => {
    const onReload = vi.fn();
    root = createRoot(host);
    root.render(h(ErrorScreen, { kind: 'start', code: 'start/InvalidStateError', onReload }));
    await vi.waitFor(() => expect(host.textContent).toContain('could not be opened'));
    expect(host.textContent).toContain('start/InvalidStateError');
    host.querySelector('button')!.click();
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('errorCode', () => {
  it('names the kind of error and never more', () => {
    expect(errorCode('render', new TypeError(SECRET))).toBe('render/TypeError');
    expect(errorCode('start', new DOMException(SECRET, 'QuotaExceededError'))).toBe('start/QuotaExceededError');
    expect(errorCode('start', Object.assign(new Error('x'), { name: SECRET }))).toBe('start/Error');
    expect(errorCode('start', SECRET)).toBe('start/Error');
    expect(errorCode('start', { name: 'Dentist' })).toBe('start/Error');
  });
});

describe('logFailure', () => {
  it('logs the code locations and drops every line that could be the message', () => {
    const error = new TypeError('x');
    error.stack = [
      `TypeError: ${SECRET}`,
      '    at Dentist',
      `    at ${SECRET.replaceAll(' ', '')}@http://evil/ (x)`,
      '    at readTaskData (http://localhost:5173/src/lib/ical/tasks.ts:15:7)',
      '    at http://localhost:5173/src/hooks/useCalendarData.ts:73:12',
      'useTasks@http://localhost:5173/src/hooks/useCalendarData.ts:70:3',
    ].join('\n');
    logFailure('render/TypeError', error, '\n    at TasksPanel (http://localhost:5173/src/components/tasks/TasksPanel.tsx:1:1)\n    at Anna went to the dentist\n    at div');
    const text = consoleText();
    expect(text).toContain('render/TypeError');
    expect(text).toContain('readTaskData');
    expect(text).toContain('useCalendarData.ts:73:12');
    expect(text).toContain('useTasks@');
    expect(text).toContain('TasksPanel');
    expect(text).toContain('at div');
    expect(text).not.toMatch(/Dentist|Anna/);
  });

  it('drops a message over several lines, even one that looks like a stack frame', () => {
    const error = new Error(`bad value\n    at Dentist (http://localhost:5173/src/x.ts:1:2)`);
    expect(error.stack).toContain('at Dentist');
    logFailure('render/Error', error);
    expect(consoleText()).not.toContain('Dentist');
    // The real frames are still there.
    expect(consoleText()).toContain('ErrorScreen.test.tsx');
  });
});
