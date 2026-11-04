// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'calendar.accountGen';

function memoryStorage(options: { full?: boolean } = {}): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => {
      if (options.full) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, String(value));
    },
  };
}

/** A tab of the app: its own copy of the module, over the storage all tabs share. */
async function openTab(storage: Storage) {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  const tabs = await import('./tabs');
  let reloads = 0;
  tabs.onOutdated(() => reloads++);
  return { ...tabs, reloads: () => reloads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tabs of one browser', () => {
  it('write as long as nobody changes the accounts', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    const b = await openTab(storage);
    expect(a.tabIsCurrent()).toBe(true);
    expect(b.tabIsCurrent()).toBe(true);
  });

  it('stop writing once another tab changes the accounts, and load again when it is done', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    const b = await openTab(storage);
    await a.changeAccounts(async () => {
      // The tab making the change goes on; the other writes nothing, and waits.
      expect(a.tabIsCurrent()).toBe(true);
      expect(b.tabIsCurrent()).toBe(false);
      expect(b.reloads()).toBe(0);
    });
    expect(a.tabIsCurrent()).toBe(true);
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(1);
    // Once is enough.
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(1);
    expect(a.reloads()).toBe(0);
  });

  it('write nothing when loaded in the middle of a change, and load again after it', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    let finish = () => {};
    const change = a.changeAccounts(() => new Promise<void>((resolve) => (finish = resolve)));
    const b = await openTab(storage);
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(0);
    finish();
    await change;
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(1);
    // Loaded again, it is current.
    const again = await openTab(storage);
    expect(again.tabIsCurrent()).toBe(true);
  });

  it('keep the mark busy until the outermost of nested changes ends', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    await a.changeAccounts(async () => {
      await a.changeAccounts(async () => {});
      expect(storage.getItem(KEY)).toMatch(/^busy:/);
    });
    expect(storage.getItem(KEY)).toMatch(/^[0-9a-f]{24}$/);
  });

  it('are not held up for long by a change that was cut off', async () => {
    const storage = memoryStorage();
    storage.setItem(KEY, `busy:${Date.now() - 61_000}:0a0a`);
    expect((await openTab(storage)).tabIsCurrent()).toBe(true);
    storage.setItem(KEY, `busy:${Date.now()}:0b0b`);
    expect((await openTab(storage)).tabIsCurrent()).toBe(false);
  });

  it('do not take themselves for outdated where storage keeps nothing', async () => {
    const a = await openTab(memoryStorage({ full: true }));
    await a.changeAccounts(async () => {});
    expect(a.tabIsCurrent()).toBe(true);
    expect(a.reloads()).toBe(0);
  });

  it('are not held up by their own change when its end could not be stored', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    const b = await openTab(storage);
    await a.changeAccounts(async () => {
      // Storage fills up during the change.
      storage.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    expect(a.tabIsCurrent()).toBe(true);
    // The others write nothing, and load again once the mark counts as cut off.
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    expect(b.tabIsCurrent()).toBe(false);
    expect(b.reloads()).toBe(1);
    vi.restoreAllMocks();
  });

  it('load again at once when told of a change or of cleared storage, without writing first', async () => {
    const storage = memoryStorage();
    const a = await openTab(storage);
    const b = await openTab(storage);
    await a.changeAccounts(async () => {});
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(b.reloads()).toBe(1);

    const c = await openTab(storage);
    storage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(c.reloads()).toBe(1);
  });
});
