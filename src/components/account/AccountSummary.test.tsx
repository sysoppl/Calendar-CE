// @vitest-environment jsdom
// The account's status line as the sidebar and the header show it, from the
// stores the app keeps: accounts and the connection.
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/store/app';
import { useData, type Account } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useSyncStatus } from '@/store/syncStatus';
import { useUi } from '@/store/ui';

const autoSync = vi.hoisted(() => ({ refreshNow: vi.fn((): Promise<void> => Promise.resolve()) }));
vi.mock('@/lib/autoSync', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/autoSync')>()), ...autoSync }));

const { SidebarAccount, HeaderAccount } = await import('./AccountChip');

// Nothing here may reach a server: the network is closed, and checked to be untouched after each test.
const network = vi.hoisted(() => ({ fetch: vi.fn(() => Promise.reject(new Error('No network in this test'))) }));
vi.stubGlobal('fetch', network.fetch);
afterEach(() => {
  expect(network.fetch).not.toHaveBeenCalled();
});
let root: Root | null = null;
let phone = false;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: phone && query.includes('max-width'), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
});

const local: Account = { id: 'local', kind: 'local', name: 'This device', useProxy: false };
const dav: Account = { id: 'dav1', kind: 'caldav', name: 'Work', username: 'ada', serverUrl: 'https://dav.example.com/', password: 'x', passwordBox: 'v1.a.b', useProxy: false, lastSync: Date.now() };

beforeEach(() => {
  phone = false;
  useSettings.setState({ language: 'en' });
  useApp.setState({ storageMode: 'caldav' });
  useData.setState({ accounts: [local, dav], syncing: {} });
  useSyncStatus.setState({ online: true });
  useUi.setState({ toasts: [] });
  autoSync.refreshNow.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  root?.unmount();
  root = null;
  useData.setState({ accounts: [], syncing: {} });
});

async function render(node: Parameters<Root['render']>[0]) {
  root = createRoot(document.getElementById('root')!);
  root.render(node);
  await vi.waitFor(() => expect(document.querySelector('[data-status]') ?? document.querySelector('button')).not.toBeNull());
}

const line = () => document.querySelector('[data-status]')!;

describe('The sidebar status line', () => {
  it('says "Synced with" the server and nothing about times', async () => {
    await render(h(SidebarAccount));
    expect(line().textContent).toBe('Synced with Work');
    expect(document.body.textContent).not.toMatch(/ago|Synced \d/);
  });

  it('never says "Syncing…", and has no sync button', async () => {
    phone = true;
    useData.setState({ syncing: { dav1: true } });
    await render(h(SidebarAccount));
    expect(line().textContent).toBe('Synced with Work');
    expect(document.body.textContent).not.toContain('Syncing');
    expect([...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '')).not.toContain('Sync now');
  });

  it('marks a server that cannot be reached in the danger colour', async () => {
    useData.setState({ accounts: [local, { ...dav, error: 'down', errorCode: 'network' }] });
    await render(h(SidebarAccount));
    expect(line().textContent).toBe("Couldn't reach the server");
    expect(line().getAttribute('data-status')).toBe('unreachable');
    expect(document.querySelector('[data-dot]')!.className).toContain('bg-danger');
  });

  it('marks a password to enter again in the warning colour', async () => {
    useData.setState({ accounts: [local, { ...dav, password: undefined }] });
    await render(h(SidebarAccount));
    expect(line().textContent).toBe('Enter the password for Work again');
    expect(document.querySelector('[data-dot]')!.className).toContain('bg-warning');
  });

  it('puts offline first', async () => {
    useData.setState({ accounts: [local, { ...dav, error: 'down', errorCode: 'network' }] });
    useSyncStatus.setState({ online: false });
    await render(h(SidebarAccount));
    expect(line().textContent).toBe("Offline - changes can't be saved");
    expect(document.querySelector('[data-dot]')).toBeNull();
  });

  it('says "On this device" once with nothing synced', async () => {
    useApp.setState({ storageMode: 'local' });
    useData.setState({ accounts: [local] });
    await render(h(SidebarAccount));
    expect(document.body.textContent).toBe('On this device');
    expect(document.querySelector('button')!.getAttribute('aria-label')).toBe('On this device. Account & storage');
  });

  it('speaks Polish', async () => {
    useSettings.setState({ language: 'pl' });
    useData.setState({ accounts: [local] });
    useApp.setState({ storageMode: 'local' });
    await render(h(SidebarAccount));
    expect(document.body.textContent).toBe('Na tym urządzeniu');
  });
});

describe('The header account card', () => {
  const open = async () => {
    await render(h(HeaderAccount));
    document.querySelector<HTMLButtonElement>('button[aria-label^="Account"]')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Status'));
  };
  const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name);

  it('has no "Sync now", and "Try again" only after a failure', async () => {
    await open();
    expect(button('Sync now')).toBeUndefined();
    expect(button('Try again')).toBeUndefined();
    root!.unmount();
    root = null;

    useData.setState({ accounts: [local, { ...dav, error: 'No connection', errorCode: 'network' }] });
    await open();
    expect(document.body.textContent).toContain("Couldn't reach the server");
    button('Try again')!.click();
    expect(autoSync.refreshNow).toHaveBeenCalledTimes(1);
  });

  it('says when "Try again" failed again', async () => {
    autoSync.refreshNow.mockImplementationOnce(() => Promise.reject(new Error('Still down')));
    useData.setState({ accounts: [local, { ...dav, error: 'x', errorCode: 'other' }] });
    await open();
    button('Try again')!.click();
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => t.message)).toEqual(["Couldn't refresh: Still down"]));
  });

  it('offers to enter a CalDAV password again', async () => {
    useData.setState({ accounts: [local, { ...dav, password: undefined }] });
    await open();
    expect(document.body.textContent).toContain('Enter the password for Work again');
    button('Enter the password again')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  });

  it('shows on a phone only when something needs attention', async () => {
    phone = true;
    root = createRoot(document.getElementById('root')!);
    root.render(h(HeaderAccount));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('button[aria-label^="Account"]')).toBeNull();
    useData.setState({ accounts: [local, { ...dav, error: 'x', errorCode: 'other' }] });
    await vi.waitFor(() => expect(document.querySelector('button[aria-label^="Account"]')).not.toBeNull());
  });
});
