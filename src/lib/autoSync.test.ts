// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The first test of the file also loads the modules, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
import type { BackendErrorCode } from '@/lib/backend/types';
import type { Account } from '@/store/data';

/** The store as the automatic sync sees it: accounts, feeds, and what a sync of each does. */
const world = vi.hoisted(() => ({
  native: false,
  resume: [] as (() => void)[],
  /** Per account, the failure its next syncs end in. */
  failing: new Map<string, string>(),
  /** Per feed, whether its fetch fails. */
  feedFails: new Set<string>(),
  /** Every sync started: account id and when, in seconds since the start of the test. */
  syncs: [] as { id: string; at: number }[],
  feeds: [] as { id: string; at: number }[],
  start: 0,
}));

vi.mock('@/lib/platform', () => ({
  get isNative() {
    return world.native;
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: () => void) => {
      if (event === 'resume') world.resume.push(listener);
      return Promise.resolve({ remove: async () => void world.resume.splice(world.resume.indexOf(listener), 1) });
    },
  },
}));

vi.mock('@/store/data', async () => {
  const { create } = await import('zustand');
  interface State {
    accounts: Account[];
    calendars: { id: string; subscriptionUrl?: string }[];
    syncing: Record<string, boolean>;
    syncAccount: (id: string) => Promise<void>;
    refreshSubscription: (id: string) => Promise<void>;
  }
  const useData = create<State>((set, get) => ({
    accounts: [],
    calendars: [],
    syncing: {},
    syncAccount: async (id) => {
      world.syncs.push({ id, at: (Date.now() - world.start) / 1000 });
      const code = world.failing.get(id) as BackendErrorCode | undefined;
      // Like the store: the failure is noted on the account, and success clears it.
      set({ accounts: get().accounts.map((a) => (a.id === id ? { ...a, error: code, errorCode: code } : a)) });
      // The error type of the modules the test loaded last, which the automatic sync uses.
      if (code) throw new (await import('@/lib/backend/types')).BackendError(code, code);
    },
    refreshSubscription: async (id) => {
      world.feeds.push({ id, at: (Date.now() - world.start) / 1000 });
      if (world.feedFails.has(id)) throw new Error('Feed down');
    },
  }));
  return { useData };
});

let visibility: DocumentVisibilityState = 'visible';

async function load(accounts: Partial<Account>[], calendars: { id: string; subscriptionUrl?: string }[] = []) {
  vi.resetModules();
  const autoSync = await import('./autoSync');
  const { useData } = await import('@/store/data');
  const { useSyncStatus } = await import('@/store/syncStatus');
  useData.setState({ accounts: accounts.map((a) => ({ name: a.id!, useProxy: false, kind: 'caldav', ...a }) as Account), calendars: calendars as never });
  return { ...autoSync, useData, useSyncStatus };
}

const syncsOf = (id: string) => world.syncs.filter((s) => s.id === id).map((s) => s.at);
const feedsOf = (id: string) => world.feeds.filter((s) => s.id === id).map((s) => s.at);

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function hide(): void {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}

function show(): void {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 16, 9, 0, 0));
  world.start = Date.now();
  world.native = false;
  world.resume = [];
  world.failing.clear();
  world.feedFails.clear();
  world.syncs = [];
  world.feeds = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
});

describe('a CalDAV server', () => {
  it('is asked at the start and then every 30 seconds while the app is on screen', async () => {
    const auto = await load([{ id: 'dav' }]);
    stop = auto.startAutoSync();
    await wait(95_000);
    expect(syncsOf('dav')).toEqual([0, 30, 60, 90]);
  });

  it('is not asked while the app is hidden, and at once when it is back after more than 10 seconds', async () => {
    const auto = await load([{ id: 'dav' }]);
    stop = auto.startAutoSync();
    await wait(1_000);
    hide();
    await wait(120_000);
    expect(syncsOf('dav')).toEqual([0]);
    show();
    await wait(0);
    expect(syncsOf('dav')).toEqual([0, 121]);
    // Hidden and back within 10 seconds of that: nothing more yet.
    await wait(4_000);
    hide();
    await wait(1_000);
    show();
    await wait(0);
    expect(syncsOf('dav')).toEqual([0, 121]);
    // The schedule is looked at every 5 seconds.
    await wait(35_000);
    expect(syncsOf('dav')).toEqual([0, 121, 155]);
  });

  it('is asked at once when the window gets the focus or the app is resumed, unless it was just asked', async () => {
    world.native = true;
    const auto = await load([{ id: 'dav' }]);
    stop = auto.startAutoSync();
    await wait(5_000);
    window.dispatchEvent(new Event('focus'));
    await wait(0);
    expect(syncsOf('dav')).toEqual([0]);
    await wait(7_000);
    window.dispatchEvent(new Event('focus'));
    await wait(0);
    expect(syncsOf('dav')).toEqual([0, 12]);
    await wait(15_000);
    for (const listener of world.resume) listener();
    await wait(0);
    expect(syncsOf('dav')).toEqual([0, 12, 27]);
  });

  it('waits longer after each failure, up to 15 minutes, and is asked at once when the connection comes back', async () => {
    world.failing.set('dav', 'network');
    const auto = await load([{ id: 'dav' }]);
    stop = auto.startAutoSync();
    await wait(30 * 60_000);
    const times = syncsOf('dav');
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // 30 s doubled per failure in a row.
    expect(gaps.slice(0, 5)).toEqual([60, 120, 240, 480, 900]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(900);
    expect(gaps.at(-1)).toBe(900);

    // Back online: asked at once, then on the usual schedule again.
    world.failing.delete('dav');
    await wait(100_000);
    window.dispatchEvent(new Event('offline'));
    await wait(1_000);
    expect(auto.useSyncStatus.getState().online).toBe(false);
    const before = syncsOf('dav').length;
    window.dispatchEvent(new Event('online'));
    await wait(0);
    expect(syncsOf('dav').length).toBe(before + 1);
    await wait(66_000);
    expect(syncsOf('dav').length).toBe(before + 3);
  });

  it('is not asked while the browser is offline', async () => {
    const auto = await load([{ id: 'dav' }]);
    stop = auto.startAutoSync();
    await wait(1_000);
    window.dispatchEvent(new Event('offline'));
    await wait(120_000);
    expect(syncsOf('dav')).toEqual([0]);
  });

  it('stops being asked after a refused password, until the account changes', async () => {
    world.failing.set('dav', 'auth');
    const auto = await load([{ id: 'dav', passwordBox: 'box-1' }]);
    stop = auto.startAutoSync();
    await wait(10 * 60_000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await wait(0);
    expect(syncsOf('dav')).toEqual([0]);

    // A new password: asked again, and on schedule from then on.
    world.failing.delete('dav');
    auto.useData.setState((s) => ({ accounts: s.accounts.map((a) => ({ ...a, passwordBox: 'box-2' })) }));
    await wait(5_000);
    expect(syncsOf('dav')).toEqual([0, 605]);
    await wait(30_000);
    expect(syncsOf('dav')).toEqual([0, 605, 635]);
  });

  it('stops being asked after a refusal or a locked password too, and once asked again by hand it is back on schedule', async () => {
    world.failing.set('a', 'forbidden');
    world.failing.set('b', 'locked');
    const auto = await load([{ id: 'a' }, { id: 'b' }]);
    stop = auto.startAutoSync();
    await wait(5 * 60_000);
    expect(syncsOf('a')).toEqual([0]);
    expect(syncsOf('b')).toEqual([0]);
    world.failing.clear();
    await auto.refreshNow();
    await wait(30_000);
    expect(syncsOf('a')).toEqual([0, 300, 330]);
  });
});

describe('feeds and the device', () => {
  it('leaves the device alone and lets each feed decide when it is fetched, waiting longer after failures', async () => {
    world.feedFails.add('local|bad');
    const auto = await load([{ id: 'local', kind: 'local' }], [{ id: 'local|good', subscriptionUrl: 'https://feeds.example.org/good.ics' }, { id: 'local|bad', subscriptionUrl: 'https://feeds.example.org/bad.ics' }, { id: 'local|mine' }]);
    stop = auto.startAutoSync();
    await wait(8 * 60_000);
    expect(syncsOf('local')).toEqual([]);
    expect(feedsOf('local|mine')).toEqual([]);
    // Asked every minute (the store fetches only when its copy is 15 minutes old).
    expect(feedsOf('local|good')).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480]);
    expect(feedsOf('local|bad')).toEqual([0, 60, 180, 420]);
  });
});

describe('a refresh asked for by hand', () => {
  it('asks every account and feed at once, says nothing when that worked and rejects when something failed', async () => {
    const auto = await load([{ id: 'dav' }, { id: 'dav2' }, { id: 'local', kind: 'local' }], [{ id: 'local|feed', subscriptionUrl: 'https://feeds.example.org/f.ics' }]);
    await expect(auto.refreshNow()).resolves.toBeUndefined();
    expect(world.syncs.map((s) => s.id).sort()).toEqual(['dav', 'dav2']);
    expect(feedsOf('local|feed')).toEqual([0]);

    world.failing.set('dav', 'network');
    await expect(auto.refreshNow()).rejects.toMatchObject({ name: 'BackendError', code: 'network' });
  });
});

describe('stopping', () => {
  it('ends the schedule and the listeners', async () => {
    const auto = await load([{ id: 'dav' }]);
    const end = auto.startAutoSync();
    await wait(1_000);
    end();
    await wait(120_000);
    window.dispatchEvent(new Event('focus'));
    show();
    await wait(0);
    expect(syncsOf('dav')).toEqual([0]);
  });
});
