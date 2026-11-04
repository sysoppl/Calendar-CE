// @vitest-environment jsdom
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '@/lib/backend';
import { discoverCalDav } from '@/lib/backend/caldav';
import { useData, type Account } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { AccountCard } from './CalendarsSection';

vi.mock('@/lib/backend/caldav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/backend/caldav')>()),
  discoverCalDav: vi.fn(),
}));

let root: Root | null = null;
const real = { setAccountPassword: useData.getState().setAccountPassword, syncAccount: useData.getState().syncAccount, removeAccount: useData.getState().removeAccount };
const realConfirm = useUi.getState().confirm;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
});

beforeEach(() => {
  useSettings.setState({ language: 'en' });
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useData.setState({ ...real, accounts: [] });
  useUi.setState({ toasts: [], confirm: realConfirm });
  vi.mocked(discoverCalDav).mockReset();
});

const account = (over: Partial<Account>): Account => ({
  id: 'acc-1',
  kind: 'caldav',
  name: 'Work',
  username: 'alice',
  serverUrl: 'https://dav.example.com/',
  homeUrl: 'https://dav.example.com/alice/',
  useProxy: false,
  ...over,
});

async function card(a: Account): Promise<string> {
  root?.unmount();
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  root.render(h(AccountCard, { account: a }));
  await vi.waitFor(() => expect(host.textContent).toContain(a.kind === 'caldav' ? 'Work' : 'device'));
  return host.textContent ?? '';
}

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

/** Types into a field the way React notices. */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The card of an account whose saved password cannot be read, with the dialog opened from it. */
async function openPasswordDialog() {
  const lost = account({ passwordBox: 'v1.aaa.bbb' });
  const setAccountPassword = vi.fn(async () => {});
  const syncAccount = vi.fn(async () => {});
  useData.setState({ accounts: [lost], setAccountPassword, syncAccount });
  await card(lost);
  button('Enter the password again')!.click();
  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  const field = document.getElementById('acc-password-again') as HTMLInputElement;
  // The dialog starts in the field.
  await vi.waitFor(() => expect(document.activeElement).toBe(field));
  return { field, setAccountPassword, syncAccount };
}

describe('AccountCard', () => {
  it('says so when a CalDAV password could not be encrypted on this device', async () => {
    expect(await card(account({ password: 'secret' }))).toContain('kept on this device unencrypted');
    expect(await card(account({ password: 'secret', passwordBox: 'v1.aaa.bbb' }))).not.toContain('unencrypted');
    expect(await card(account({ passwordBox: 'v1.aaa.bbb' }))).not.toContain('unencrypted');
  });

  it('offers to enter the password again only when the saved one cannot be read', async () => {
    const lost = await card(account({ passwordBox: 'v1.aaa.bbb' }));
    expect(lost).toContain('cannot be read on this device');
    expect(button('Enter the password again')).toBeDefined();
    // With the reason the last sync gave, that is what the card says.
    await card(account({ passwordBox: 'v1.aaa.bbb', error: 'The password saved for this account can no longer be read on this device. Enter it again to keep syncing.' }));
    expect(button('Enter the password again')).toBeDefined();

    await card(account({ password: 'secret', passwordBox: 'v1.aaa.bbb' }));
    expect(button('Enter the password again')).toBeUndefined();
    await card(account({ password: '' }));
    expect(button('Enter the password again')).toBeUndefined();
    await card({ id: 'local', kind: 'local', name: 'This device', useProxy: false });
    expect(button('Enter the password again')).toBeUndefined();
  });
});

describe('The state of an account', () => {
  const status = () => document.querySelector('[data-status]');

  it('says it is synced, with no time and nothing to press', async () => {
    const text = await card(account({ password: 'secret', passwordBox: 'v1.a.b', lastSync: Date.now() - 60_000 }));
    expect(status()?.textContent).toBe('Synced');
    expect(text).not.toMatch(/Last sync|ago/);
    expect(button('Sync')).toBeUndefined();
    expect(button('Try again')).toBeUndefined();
  });

  it('offers "Try again" only after a failure, which syncs the account', async () => {
    const syncAccount = vi.fn(async () => {});
    useData.setState({ syncAccount });
    await card(account({ password: 'secret', passwordBox: 'v1.a.b', error: 'No connection to the calendar server (ECONNREFUSED).', errorCode: 'network' }));
    expect(status()?.textContent).toBe("Couldn't reach the server");
    button('Try again')!.click();
    expect(syncAccount).toHaveBeenCalledWith('acc-1');

    await card(account({ password: 'secret', passwordBox: 'v1.a.b', error: 'HTTP 500', errorCode: 'other' }));
    expect(status()?.textContent).toBe("Couldn't sync Work");
    expect(button('Try again')).toBeDefined();
  });

  it('says that a failed retry failed', async () => {
    useData.setState({ syncAccount: vi.fn(async () => Promise.reject(new Error('Still down'))) });
    await card(account({ password: 'secret', passwordBox: 'v1.a.b', error: 'Down', errorCode: 'network' }));
    button('Try again')!.click();
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => t.message)).toContain("Couldn't refresh: Still down"));
  });

  it('asks for the password of an account the server refused', async () => {
    await card(account({ password: 'old', passwordBox: 'v1.a.b', error: 'Sign-in failed.', errorCode: 'auth' }));
    expect(status()?.textContent).toBe('Enter the password for Work again');
    expect(button('Enter the password again')).toBeDefined();
  });

  it('says so when the device is offline', async () => {
    const { useSyncStatus } = await import('@/store/syncStatus');
    useSyncStatus.setState({ online: false });
    try {
      await card(account({ password: 'secret', passwordBox: 'v1.a.b', lastSync: Date.now() }));
      expect(status()?.textContent).toBe("Offline - changes can't be saved");
    } finally {
      useSyncStatus.setState({ online: true });
    }
  });

  it('says that an account was removed', async () => {
    const removeAccount = vi.fn(async () => {});
    useData.setState({ removeAccount } as never);
    const confirm = vi.spyOn(useUi.getState(), 'confirm').mockResolvedValue(true);
    useUi.setState({ confirm });
    await card(account({ password: 'secret', passwordBox: 'v1.a.b' }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove account"]')!.click();
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => t.message)).toContain('Account removed'));
    expect(removeAccount).toHaveBeenCalledWith('acc-1');
  });
});

describe('Entering a CalDAV password again', () => {
  it('checks the password with the server, then saves it and syncs', async () => {
    vi.mocked(discoverCalDav).mockResolvedValue({ principalUrl: 'https://dav.example.com/p/alice/', homeUrl: 'https://dav.example.com/alice/' });
    const { field, setAccountPassword, syncAccount } = await openPasswordDialog();
    expect(dialog()!.textContent).toContain('alice');
    expect(dialog()!.textContent).toContain('dav.example.com');

    type(field, 'new secret');
    button('Check and save')!.click();
    await vi.waitFor(() => expect(setAccountPassword).toHaveBeenCalledWith('acc-1', 'new secret'));
    expect(discoverCalDav).toHaveBeenCalledWith({ serverUrl: 'https://dav.example.com/', username: 'alice', password: 'new secret', useProxy: false });
    expect(syncAccount).toHaveBeenCalledWith('acc-1');
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('Password saved');
    // The focus lands on the card again, not on the page.
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('H4'));
    expect(document.activeElement?.textContent).toBe('Work');
  });

  it('does not save a password the server refuses, and says so at the field', async () => {
    vi.mocked(discoverCalDav).mockRejectedValue(new BackendError('auth', 'Sign-in failed. Check the username and password.', { status: 401 }));
    const { field, setAccountPassword } = await openPasswordDialog();
    type(field, 'wrong');
    field.form!.requestSubmit();
    await vi.waitFor(() => expect(dialog()!.textContent).toContain('The server did not accept this password.'));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(setAccountPassword).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('brings any other failure into view and onto the focus', async () => {
    vi.mocked(discoverCalDav).mockRejectedValue(new BackendError('network', 'No connection to the calendar server (ECONNREFUSED).'));
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { field, setAccountPassword } = await openPasswordDialog();
    type(field, 'secret');
    field.form!.requestSubmit();
    await vi.waitFor(() => expect(dialog()!.textContent).toContain('No connection to the calendar server'));
    const alert = dialog()!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not connect to the server');
    await vi.waitFor(() => expect(document.activeElement).toBe(alert));
    expect(scrolled).toHaveBeenCalled();
    expect(setAccountPassword).not.toHaveBeenCalled();
  });

  it('forgets an answer that comes after the dialog was closed', async () => {
    let answer!: () => void;
    vi.mocked(discoverCalDav).mockReturnValue(new Promise((resolve) => (answer = () => resolve({ principalUrl: 'p', homeUrl: 'h' }))));
    const { field, setAccountPassword } = await openPasswordDialog();
    type(field, 'secret');
    field.form!.requestSubmit();
    await vi.waitFor(() => expect(discoverCalDav).toHaveBeenCalled());
    button('Cancel')!.click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    answer();
    await new Promise((r) => setTimeout(r, 20));
    expect(setAccountPassword).not.toHaveBeenCalled();
  });
});

describe('AccountCard over plain http', () => {
  const warning = 'travel over the internet in clear text';

  it('warns when the server is reached over http on the internet', async () => {
    expect(await card(account({ serverUrl: 'http://dav.example.com/', homeUrl: 'http://dav.example.com/alice/' }))).toContain(warning);
    expect(document.querySelector('[data-warning="clear"]')).not.toBeNull();
  });

  it('says nothing for https or a server on the local network', async () => {
    expect(await card(account({}))).not.toContain(warning);
    expect(await card(account({ serverUrl: 'http://192.168.1.10:5232/', homeUrl: 'http://192.168.1.10:5232/alice/' }))).not.toContain(warning);
    expect(await card(account({ serverUrl: 'localhost:5232', homeUrl: 'http://localhost:5232/alice/' }))).not.toContain(warning);
  });

  it('asks for a CalDAV password with field names of its own, no login to this site', async () => {
    await openPasswordDialog();
    const field = document.getElementById('acc-password-again') as HTMLInputElement;
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    expect(field.name).toBe('caldav-password');
    expect(dialog()!.querySelector('[autocomplete="username"]')).toBeNull();
  });
});
