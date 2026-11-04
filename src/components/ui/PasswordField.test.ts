// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordField } from './PasswordField';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSWORD = 'hunter2-secret';

let root: Root;

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

/** Types as a person would. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the password field', () => {
  it('keep what is typed out of the page markup', () => {
    let clear = () => {};
    function Form() {
      const [password, setPassword] = useState('');
      clear = () => setPassword('');
      return h('form', null, h(PasswordField, { id: 'pw', label: 'Password', value: password, onChange: setPassword }));
    }
    root = createRoot(document.body.appendChild(document.createElement('div')));
    act(() => root.render(h(Form)));
    const password = document.getElementById('pw') as HTMLInputElement;

    type(password, PASSWORD);
    // What the form sends is there…
    expect(password.value).toBe(PASSWORD);
    // …but not in the markup, where a style rule or a saved page could read it.
    expect(password.hasAttribute('value')).toBe(false);
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    // Shown as text, still not in the markup.
    act(() => (document.querySelector('button[aria-controls="pw"]') as HTMLButtonElement).click());
    expect(password.type).toBe('text');
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    // Cleared by the form, the fields are empty.
    act(() => clear());
    expect(password.value).toBe('');
  });
});
