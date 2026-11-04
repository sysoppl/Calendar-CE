// @vitest-environment jsdom
import { createElement as h, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '@/lib/backend';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { CalDavForm } from './AccountDialog';

let root: Root | null = null;
const realAdd = useData.getState().addCalDavAccount;

beforeEach(() => {
  useSettings.setState({ language: 'en' });
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useData.setState({ addCalDavAccount: realAdd });
});

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CalDavForm', () => {
  it('brings a failed connection into view and moves the focus onto it', async () => {
    useData.setState({ addCalDavAccount: vi.fn(() => Promise.reject(new BackendError('network', 'No connection to the calendar server (ECONNREFUSED).'))) });
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    // The way the welcome screen shows it: the form, and a Connect button outside it.
    root.render(
      h(CalDavForm, {
        onConnected: () => {},
        children: ({ fields, formId }) => h(Fragment, null, fields, h('button', { type: 'submit', form: formId }, 'Connect')),
      }),
    );
    await vi.waitFor(() => expect(document.getElementById('acc-server')).not.toBeNull());
    type(document.getElementById('acc-server') as HTMLInputElement, 'https://dav.example.com/');
    type(document.getElementById('acc-user') as HTMLInputElement, 'alice');
    const connect = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Connect')!;
    connect.focus();
    connect.click();

    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('Could not connect to the server');
    expect(alert.textContent).toContain('ECONNREFUSED');
    await vi.waitFor(() => expect(document.activeElement).toBe(alert));
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts[0]).toBe(alert);
  });

  function renderForm() {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    root.render(
      h(CalDavForm, {
        onConnected: () => {},
        children: ({ fields, formId, canSubmit }) => h(Fragment, null, fields, h('button', { type: 'submit', form: formId, disabled: !canSubmit }, 'Connect')),
      }),
    );
    return host;
  }

  it('says that the app\'s server relays plain http to a public host only where its operator allows it, with nothing to confirm', async () => {
    const add = vi.fn(() => new Promise<never>(() => {}));
    useData.setState({ addCalDavAccount: add });
    const host = renderForm();
    await vi.waitFor(() => expect(document.getElementById('acc-server')).not.toBeNull());
    type(document.getElementById('acc-user') as HTMLInputElement, 'alice');
    type(document.getElementById('acc-server') as HTMLInputElement, 'http://dav.example.com/');
    await vi.waitFor(() => expect(host.textContent).toContain('This address is not encrypted'));
    expect(host.textContent).toContain('cannot be added here unless the operator of this app’s server allows it');
    // No promise the browser could not keep: the server's answer decides.
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    const connect = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Connect')!;
    expect(connect.disabled).toBe(false);
    connect.click();
    await vi.waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://dav.example.com/', useProxy: true })));
  });

  it('warns about plain http to a public host and, without the proxy, connects only once that is confirmed', async () => {
    const add = vi.fn(() => new Promise<never>(() => {}));
    useData.setState({ addCalDavAccount: add });
    const host = renderForm();
    await vi.waitFor(() => expect(document.getElementById('acc-server')).not.toBeNull());
    const server = document.getElementById('acc-server') as HTMLInputElement;
    type(document.getElementById('acc-user') as HTMLInputElement, 'alice');
    const connect = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Connect')!;
    host.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false'));

    type(server, 'http://192.168.1.10:5232/');
    await vi.waitFor(() => expect(connect().disabled).toBe(false));
    expect(host.textContent).not.toContain('This address is not encrypted');

    type(server, 'http://dav.example.com/');
    await vi.waitFor(() => expect(host.textContent).toContain('This address is not encrypted'));
    expect(host.textContent).not.toContain('operator');
    expect(connect().disabled).toBe(true);
    host.querySelector<HTMLFormElement>('form')!.requestSubmit();
    expect(add).not.toHaveBeenCalled();

    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await vi.waitFor(() => expect(connect().disabled).toBe(false));
    // Another address needs its own confirmation.
    type(server, 'http://dav.example.org/');
    await vi.waitFor(() => expect(connect().disabled).toBe(true));
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await vi.waitFor(() => expect(connect().disabled).toBe(false));
    connect().click();
    await vi.waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://dav.example.org/' })));
  });

  it('keeps the password out of the markup and its fields apart from a login to this site', async () => {
    const host = renderForm();
    await vi.waitFor(() => expect(document.getElementById('acc-pass')).not.toBeNull());
    const pass = document.getElementById('acc-pass') as HTMLInputElement;
    type(pass, 'hunter2-secret');
    await new Promise((r) => setTimeout(r, 0));
    expect(pass.value).toBe('hunter2-secret');
    expect(pass.getAttribute('value')).toBeNull();
    expect(host.innerHTML).not.toContain('hunter2-secret');
    expect(pass.getAttribute('autocomplete')).toBe('new-password');
    expect(pass.name).toBe('caldav-password');
    const user = document.getElementById('acc-user') as HTMLInputElement;
    expect(user.getAttribute('autocomplete')).toBe('off');
    expect(user.name).not.toBe('username');
    expect(host.querySelector('[autocomplete="username"], [autocomplete="current-password"]')).toBeNull();
  });
});
