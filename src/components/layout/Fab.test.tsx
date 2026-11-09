// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { Fab } from './Fab';
import { ViewBar } from './ViewBar';

const actions = vi.hoisted(() => ({ openNewEvent: vi.fn(), openNewTask: vi.fn() }));
vi.mock('@/lib/actions', () => actions);

let root: Root | null = null;
let host: HTMLElement;
let width = 390;

beforeEach(() => {
  width = 390;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
  useSettings.setState({ language: 'en', fabAction: 'event' });
  actions.openNewEvent.mockReset();
  actions.openNewTask.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
});

afterEach(() => {
  root?.unmount();
  root = null;
});

async function show(element: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
  root = createRoot(host);
  root.render(h('div', { id: 'shell' }, h(element, props)));
  await vi.waitFor(() => expect(host.querySelector('#shell')).not.toBeNull());
}

describe('Fab', () => {
  it('starts a new event at the next free slot on a phone', async () => {
    await show(Fab);
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('New event');
    button.click();
    expect(actions.openNewEvent).toHaveBeenCalledTimes(1);
    expect(actions.openNewEvent.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('starts a new task when the setting says so', async () => {
    useSettings.setState({ fabAction: 'task' });
    await show(Fab);
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('New task');
    button.click();
    expect(actions.openNewTask).toHaveBeenCalledTimes(1);
    expect(actions.openNewEvent).not.toHaveBeenCalled();
  });

  it('offers both when the setting asks each time, and starts the one picked', async () => {
    useSettings.setState({ fabAction: 'choose' });
    await show(Fab);
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('New event or task');
    button.click();
    const items = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(found).toHaveLength(2);
      return found;
    });
    expect(items.map((item) => item.textContent)).toEqual(['New event', 'New task']);
    expect(actions.openNewEvent).not.toHaveBeenCalled();
    items[1].click();
    expect(actions.openNewTask).toHaveBeenCalledTimes(1);
    expect(actions.openNewEvent).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')).toBeNull());
    button.click();
    const again = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(found).toHaveLength(2);
      return found;
    });
    again[0].click();
    expect(actions.openNewEvent).toHaveBeenCalledTimes(1);
    expect(actions.openNewEvent.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('starts a new event when the stored setting is one it does not know', async () => {
    useSettings.setState({ fabAction: 'banner' as never });
    await show(Fab);
    host.querySelector('button')!.click();
    expect(actions.openNewEvent).toHaveBeenCalledTimes(1);
  });

  it('is not there on a wide screen, where the sidebar has the button', async () => {
    width = 1280;
    for (const fabAction of ['event', 'task', 'choose'] as const) {
      useSettings.setState({ fabAction });
      await show(Fab);
      expect(host.querySelector('button')).toBeNull();
      root!.unmount();
      root = null;
    }
  });
});

describe('the new-event button and the bar of views', () => {
  it('sit apart: the button floats above the bar, as far from it as from the edge', async () => {
    await show(Fab);
    const button = host.querySelector('button')!;
    expect(button.className).toContain('bottom-[calc(3.5rem+1rem+var(--safe-bottom))]');
    root!.unmount();
    await show(ViewBar);
    expect(host.querySelector('[role="tablist"]')!.className).toContain('h-14');
  });
});
