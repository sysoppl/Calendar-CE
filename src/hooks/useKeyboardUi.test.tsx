// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `asked` counts the questions for a hardware keyboard, which the detection asks once it listens for keys. */
const native = vi.hoisted(() => ({ isNative: false, hardware: false, asked: 0, resume: [] as (() => void)[] }));
vi.mock('@/lib/platform', () => ({
  get isNative() {
    return native.isNative;
  },
}));
vi.mock('@/lib/display', () => ({
  hardwareKeyboard: () => {
    native.asked++;
    return Promise.resolve(native.hardware);
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: () => void) => {
      if (event === 'resume') native.resume.push(listener);
      return Promise.resolve({ remove: () => void native.resume.splice(native.resume.indexOf(listener), 1) });
    },
  },
}));

/** Whether the media query for a mouse or trackpad matches, and who listens for its changes. */
let finePointer = false;
let pointerListeners: (() => void)[] = [];
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  finePointer = false;
  pointerListeners = [];
  native.isNative = false;
  native.hardware = false;
  native.asked = 0;
  native.resume = [];
  localStorage.clear();
  document.documentElement.removeAttribute('data-keys');
  document.body.innerHTML = '<div id="root"></div><input id="field" />';
  host = document.getElementById('root')!;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === '(hover: hover) and (pointer: fine)' ? finePointer : false;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => pointerListeners.push(listener),
      removeEventListener: (_: string, listener: () => void) => (pointerListeners = pointerListeners.filter((l) => l !== listener)),
    }),
  });
  vi.resetModules();
});

afterEach(() => {
  root?.unmount();
  root = null;
});

/** Starts the detection as the app's root does, with a component that shows what it says. */
async function start() {
  const { useKeyboardDetection, useKeyboardUi, keyboardUi } = await import('./useKeyboardUi');
  function Probe() {
    useKeyboardDetection();
    return h('span', { id: 'probe' }, String(useKeyboardUi()));
  }
  const asked = native.asked;
  root = createRoot(host);
  root.render(h(Probe));
  await vi.waitFor(() => expect(host.querySelector('#probe')).not.toBeNull());
  // The probe is on the page before the detection's effect has run: a key
  // pressed in between would go unseen. The effect listens for keys first,
  // then asks for a hardware keyboard, so once asked it is listening.
  await vi.waitFor(() => expect(native.asked).toBeGreaterThan(asked));
  const shown = () => host.querySelector('#probe')!.textContent === 'true';
  const marked = () => document.documentElement.hasAttribute('data-keys');
  return { shown, marked, keyboardUi };
}

function press(key: string, init: { target?: Element; keyCode?: number; isComposing?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: init.isComposing ?? false });
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { get: () => init.keyCode });
  (init.target ?? document.body).dispatchEvent(event);
}

describe('useKeyboardUi', () => {
  it('shows no keyboard on a touch screen until a key is pressed outside a field', async () => {
    const { shown, marked, keyboardUi } = await start();
    expect(shown()).toBe(false);
    expect(marked()).toBe(false);
    expect(keyboardUi()).toBe(false);

    press('n');
    await vi.waitFor(() => expect(shown()).toBe(true));
    expect(marked()).toBe(true);
    expect(keyboardUi()).toBe(true);
    // Known on the next start too.
    expect(localStorage.getItem('calendar.keys')).toBe('1');
  });

  it('does not take a soft keyboard for one', async () => {
    const { shown } = await start();
    // What soft keyboards send while composing, and keys typed into a field.
    press('Unidentified', { keyCode: 229 });
    press('a', { keyCode: 229 });
    press('a', { isComposing: true });
    press('n', { target: document.getElementById('field')! });
    // Keys that soft keyboards also have, or that say nothing on their own.
    press('Enter');
    press('Backspace');
    press('Shift');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown()).toBe(false);
    expect(localStorage.getItem('calendar.keys')).toBeNull();
  });

  it('takes arrows and Escape as a keyboard', async () => {
    for (const key of ['ArrowDown', 'Escape']) {
      localStorage.clear();
      vi.resetModules();
      root?.unmount();
      const { shown } = await start();
      press(key);
      await vi.waitFor(() => expect(shown(), key).toBe(true));
    }
  });

  it('shows the keyboard interface at once with a mouse or a trackpad, and follows the pointer', async () => {
    finePointer = true;
    const { shown, marked } = await start();
    expect(shown()).toBe(true);
    expect(marked()).toBe(true);
    finePointer = false;
    for (const listener of pointerListeners) listener();
    await vi.waitFor(() => expect(shown()).toBe(false));
    expect(marked()).toBe(false);
  });

  it('remembers a keyboard seen on an earlier start', async () => {
    localStorage.setItem('calendar.keys', '1');
    const { shown } = await start();
    expect(shown()).toBe(true);
  });

  it('asks the system for a hardware keyboard, and again when the app comes back', async () => {
    native.isNative = true;
    const { shown } = await start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(shown()).toBe(false);
    native.hardware = true;
    expect(native.resume).toHaveLength(1);
    native.resume[0]();
    await vi.waitFor(() => expect(shown()).toBe(true));
    native.hardware = false;
    native.resume[0]();
    await vi.waitFor(() => expect(shown()).toBe(false));
  });

  it('sees a hardware keyboard the system reports at start', async () => {
    native.hardware = true;
    const { shown } = await start();
    await vi.waitFor(() => expect(shown()).toBe(true));
  });

  it('still works without storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      const { shown } = await start();
      expect(shown()).toBe(false);
      press('n');
      await vi.waitFor(() => expect(shown()).toBe(true));
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
