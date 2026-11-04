// @vitest-environment jsdom
import { createElement as h } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADER_DELAY_MS } from '@/hooks/useDelayed';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { SyncActivity } from './SyncActivity';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const DAV = { id: 'u1', kind: 'caldav' as const, name: 'Home server', serverUrl: 'https://dav.example.org/', username: 'me', useProxy: false };

beforeEach(() => {
  vi.useFakeTimers();
  useSettings.setState({ language: 'en' });
  useData.setState({ accounts: [{ id: 'local', kind: 'local', name: 'On this device', useProxy: false }, DAV], calendars: [], syncing: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root!.render(h(SyncActivity)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const bar = () => document.querySelector('[role="progressbar"]');
const note = () => document.querySelector('[role="status"]');
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('The calendar while it syncs', () => {
  it('shows nothing for a sync that ends at once', () => {
    act(() => useData.setState({ syncing: { u1: true } }));
    wait(LOADER_DELAY_MS - 50);
    act(() => useData.setState({ syncing: { u1: false } }));
    wait(1000);
    expect(bar()).toBeNull();
    expect(note()).toBeNull();
  });

  it('shows the thin line during a longer sync, and says the calendars are on their way the first time', () => {
    act(() => useData.setState({ syncing: { u1: true } }));
    expect(bar()).toBeNull();
    wait(LOADER_DELAY_MS);
    expect(bar()?.getAttribute('aria-label')).toBe('Syncing…');
    expect(note()?.textContent).toBe('Getting your calendars…');
    // Its first calendar is here: the line stays while the sync goes on, the note goes.
    act(() => useData.setState({ calendars: [{ id: 'u1|c1', accountId: 'u1', remoteId: 'c1', name: 'Personal', color: '#007c73', components: ['VEVENT'], readOnly: false, visible: true, order: 0 }] }));
    expect(bar()).not.toBeNull();
    expect(note()).toBeNull();
    act(() => useData.setState({ syncing: { u1: false } }));
    expect(bar()).toBeNull();
  });

  it('does not take a later sync for the first one', () => {
    act(() => useData.setState({ accounts: [{ ...DAV, lastSync: 1 }], syncing: { u1: true } }));
    wait(LOADER_DELAY_MS);
    expect(bar()).not.toBeNull();
    expect(note()).toBeNull();
  });
});
