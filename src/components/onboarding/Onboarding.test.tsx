// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBackend } from '@/lib/backend';
import { FakeBackend } from '@/lib/backend/fake';
import { CLOUD_URL } from '@/lib/links';
import { useApp } from '@/store/app';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { Onboarding } from './Onboarding';

// The server answers discovery like a CalDAV server; its calendars come from the fake backend.
vi.mock('@/lib/backend/caldav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/backend/caldav')>()),
  discoverCalDav: vi.fn(async () => ({ principalUrl: 'https://dav.example.org/p/me/', homeUrl: 'https://dav.example.org/cal/me/', displayName: 'Me' })),
}));

let root: Root | null = null;
let server: FakeBackend;

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  server = new FakeBackend();
  server.addCalendar('birthdays', { displayName: 'Birthdays', readOnly: true, order: 0 });
  server.addCalendar('personal', { displayName: 'Personal', components: ['VEVENT', 'VTODO'], order: 1 });
  server.addCalendar('work', { displayName: 'Work', order: 2 });
  registerBackend('caldav', () => server);
  useApp.setState({ onboarded: false, storageMode: null });
  useData.setState({ accounts: [{ id: 'local', kind: 'local', name: 'On this device', useProxy: false }], calendars: [] });
  useSettings.setState({ language: 'en', defaultCalendarId: undefined, defaultTaskListId: undefined });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (text: string) =>
  vi.waitFor(() => {
    const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    if (!found) throw new Error(`No "${text}" button yet`);
    return found;
  });

/** Types into a field the way React notices. */
function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A first start: the welcome screen with the places to keep the calendar. */
async function start() {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  root.render(h(Onboarding));
  await button('Keep it on this device');
}

describe('The welcome screen', () => {
  it('offers this device and a CalDAV server as equals, keeps what to know one tap away, and only links to the hosted edition', async () => {
    await start();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-option]')];
    expect(cards.map((c) => c.dataset.option)).toEqual(['local', 'caldav']);
    // Both buttons look the same.
    const filled = cards.map((c) => [...c.querySelectorAll('button')].some((b) => b.className.includes('bg-primary ')));
    expect(filled).toEqual([true, true]);
    // Folded with its count; every point is still there to read.
    const caveats = cards[0].querySelector('details')!;
    expect(caveats.open).toBe(false);
    expect(caveats.querySelector('summary')!.textContent).toBe('Keep in mind· 2');
    expect(caveats.querySelectorAll('li')).toHaveLength(2);
    // No account to create or sign in to: the hosted edition is a link that opens outside the app.
    expect(document.body.textContent).not.toMatch(/Create account|Sign in/);
    const promo = document.querySelector('[data-promo="cloud"] a') as HTMLAnchorElement;
    expect(promo.href).toBe(CLOUD_URL);
    expect(promo.target).toBe('_blank');
    expect(promo.rel).toContain('noopener');
  });

  it('names the CalDAV server\'s first calendar and task list as where new items go', async () => {
    await start();
    (await button('Connect a server')).click();
    await vi.waitFor(() => expect(document.getElementById('acc-server')).not.toBeNull());
    type('acc-server', 'https://dav.example.org/');
    type('acc-user', 'me');
    type('acc-pass', 'secret');
    (document.getElementById('acc-form') as HTMLFormElement).requestSubmit();

    await vi.waitFor(() => expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'caldav' }));
    const account = useData.getState().accounts.find((a) => a.kind === 'caldav')!;
    // Settings shows these instead of "—": the first visible calendar that can be written to, and the first list.
    expect(useSettings.getState()).toMatchObject({ defaultCalendarId: `${account.id}|personal`, defaultTaskListId: `${account.id}|personal` });
  });

  it('names the calendar and task list it makes on this device', async () => {
    await start();
    (await button('Keep it on this device')).click();
    await vi.waitFor(() => expect(useApp.getState()).toMatchObject({ onboarded: true, storageMode: 'local' }));
    expect(useSettings.getState()).toMatchObject({ defaultCalendarId: 'local|personal', defaultTaskListId: 'local|tasks' });
  });
});
