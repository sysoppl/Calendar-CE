// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '@/store/ui';
import { Modal, closeTopModal, isModalOpen } from './Modal';
import { ConfirmDialog } from './Prompts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so every element would count as hidden.
Element.prototype.checkVisibility = () => true;

let app: HTMLElement;
let root: Root;

const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
  // The dialog takes the focus on the next frame.
  await frame();
};
const key = (name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => void (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
};
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"><button id="opener">Open</button></div><div id="toasts" class="fixed" style="z-index: 70"><button>Undo</button></div><aside inert></aside>';
  app = document.getElementById('app')!;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(isModalOpen()).toBe(false);
});

describe('Modal', () => {
  it('makes the page behind it inert and releases it again', async () => {
    const toasts = document.getElementById('toasts')!;
    const aside = document.querySelector('aside')!;
    await render(h(Modal, { open: true, onClose: () => {}, title: 'One', children: 'Text' }));
    expect(app.hasAttribute('inert')).toBe(true);
    // Painted above the dialog, so still in use.
    expect(toasts.hasAttribute('inert')).toBe(false);
    expect(dialogs()[0].closest('[inert]')).toBeNull();

    await render(null);
    expect(app.hasAttribute('inert')).toBe(false);
    // Inert before the dialog opened: not this module's to release.
    expect(aside.hasAttribute('inert')).toBe(true);
  });

  it('leaves only the top dialog of a stack usable', async () => {
    const second = (open: boolean) => h(Modal, { open, onClose: () => {}, title: 'Two', children: 'Text' });
    await render(h('div', null, h(Modal, { open: true, onClose: () => {}, title: 'One', children: 'Text' }), second(true)));
    const [one, two] = dialogs();
    expect(one.closest('[inert]')).not.toBeNull();
    expect(two.closest('[inert]')).toBeNull();

    await render(h('div', null, h(Modal, { open: true, onClose: () => {}, title: 'One', children: 'Text' }), second(false)));
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0].closest('[inert]')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(true);
  });

  it('moves the focus in and gives it back', async () => {
    const opener = document.getElementById('opener')!;
    opener.focus();
    await render(h(Modal, { open: true, onClose: () => {}, title: 'One', initialFocus: '#name', children: h('input', { id: 'name' }) }));
    expect(document.activeElement?.id).toBe('name');
    await render(null);
    expect(document.activeElement).toBe(opener);
  });

  it('falls back to the panel when the element to focus is missing', async () => {
    await render(h(Modal, { open: true, onClose: () => {}, title: 'One', initialFocus: '#missing', children: 'Text' }));
    expect(document.activeElement).toBe(dialogs()[0]);
  });

  it('keeps Tab inside', async () => {
    await render(h(Modal, { open: true, onClose: () => {}, title: 'One', footer: h('button', null, 'Save'), children: h('input', { id: 'name' }) }));
    const close = button('Close');
    const save = button('Save');

    // From the panel itself backwards: to the last stop.
    expect(document.activeElement).toBe(dialogs()[0]);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(save);

    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(save);

    // In the middle the browser moves the focus itself.
    document.getElementById('name')!.focus();
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(false);

    // Focus that got out (a click on a toast) comes back with the next Tab.
    document.querySelector<HTMLElement>('#toasts button')!.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('skips what Tab cannot reach', async () => {
    await render(
      h(Modal, {
        open: true,
        onClose: () => {},
        dismissible: false,
        children: h(
          'form',
          null,
          h('input', { type: 'radio', name: 'scope', id: 'a', defaultChecked: true }),
          h('input', { type: 'radio', name: 'scope', id: 'b' }),
          h('button', { disabled: true }, 'Off'),
          h('span', { tabIndex: -1 }, 'Text'),
        ),
      }),
    );
    document.getElementById('a')!.focus();
    // The only stop: Tab stays on it in both directions.
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('closes on Escape, the backdrop and the close button', async () => {
    const onClose = vi.fn();
    await render(h(Modal, { open: true, onClose, title: 'One', children: 'Text' }));
    key('Escape');
    act(() => void dialogs()[0].parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => button('Close').click());
    expect(onClose).toHaveBeenCalledTimes(3);
    // A press inside the panel is not a press on the backdrop.
    act(() => void dialogs()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('leaves Escape to a dropdown that is open inside it', async () => {
    const onClose = vi.fn();
    await render(h(Modal, { open: true, onClose, title: 'One', children: h('input', { id: 'time', 'aria-expanded': true }) }));
    document.getElementById('time')!.focus();
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be dismissed when it has to be answered', async () => {
    const onClose = vi.fn();
    await render(h(Modal, { open: true, onClose, dismissible: false, title: 'Notice', children: h('button', null, 'Continue') }));
    expect(button('Close')).toBeUndefined();
    key('Escape');
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void dialogs()[0].parentElement!.dispatchEvent(press));
    // Prevented, so the press does not take the focus out of the dialog.
    expect(press.defaultPrevented).toBe(true);
    expect(closeTopModal()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(isModalOpen()).toBe(true);
  });
});

describe('closeTopModal', () => {
  it('closes one layer at a time, from the top', async () => {
    expect(closeTopModal()).toBe(false);
    const closed: string[] = [];
    const modal = (name: string, open: boolean) => h(Modal, { key: name, open, onClose: () => closed.push(name), title: name, children: 'Text' });
    await render(h('div', null, modal('one', true), modal('two', true)));
    expect(closeTopModal()).toBe(true);
    expect(closed).toEqual(['two']);
    await render(h('div', null, modal('one', true), modal('two', false)));
    expect(closeTopModal()).toBe(true);
    expect(closed).toEqual(['two', 'one']);
  });

  it('does not reach under a dialog that has to be answered', async () => {
    const onClose = vi.fn();
    await render(
      h('div', null, h(Modal, { open: true, onClose, title: 'Under', children: 'Text' }), h(Modal, { open: true, dismissible: false, title: 'Notice', children: 'Text' })),
    );
    expect(closeTopModal()).toBe(false);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  const ask = (title: string, danger = false) => useUi.getState().confirm({ title, message: `${title}?`, confirmLabel: `Yes, ${title}`, danger });
  const shown = () => dialogs().map((d) => d.querySelector('h2')!.textContent);

  it('starts a dangerous prompt on Cancel and a harmless one on its button', async () => {
    await render(h(ConfirmDialog));
    let answer = ask('delete', true);
    await frame();
    expect(document.activeElement).toBe(button('Cancel'));
    act(() => button('Yes, delete').click());
    await expect(answer).resolves.toBe(true);

    answer = ask('save');
    await frame();
    expect(document.activeElement).toBe(button('Yes, save'));
    act(() => void closeTopModal());
    await expect(answer).resolves.toBe(false);
    expect(shown()).toEqual([]);
  });

  it('asks one question after another', async () => {
    document.getElementById('opener')!.focus();
    await render(h(ConfirmDialog));
    const first = ask('first', true);
    const second = ask('second', true);
    const third = ask('third');
    await frame();
    expect(shown()).toEqual(['first']);

    const yes = button('Yes, first');
    act(() => yes.click());
    // A second click on the button that is going away answers nothing else.
    act(() => yes.click());
    await expect(first).resolves.toBe(true);
    await frame();
    expect(shown()).toEqual(['second']);
    // The next question opens afresh: on Cancel again, not on the spot just clicked.
    expect(document.activeElement).toBe(button('Cancel'));

    key('Escape');
    await expect(second).resolves.toBe(false);
    await frame();
    expect(shown()).toEqual(['third']);

    act(() => button('Yes, third').click());
    await expect(third).resolves.toBe(true);
    expect(shown()).toEqual([]);
    expect(useUi.getState().confirmPrompt).toBeNull();
    // Back where the first question was asked from.
    expect(document.activeElement?.id).toBe('opener');
  });
});
