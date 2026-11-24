import { describe, expect, it, vi } from 'vitest';
import { RELOAD_MARK_KEY, SHELL_CACHE_PREFIX, dropAppShell, readReloadMark, refreshWorker, safeToReload, settleReloadMark, webDecision, writeReloadMark, type ReloadProbe } from './reload';

const IDLE: ReloadProbe = { modalOpen: false, overlayOpen: false, typing: false, filled: false };

function memorySession(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('loading the page again', () => {
  it('is safe only when nothing that may hold input is open', () => {
    expect(safeToReload(IDLE)).toBe(true);
    for (const key of Object.keys(IDLE) as (keyof ReloadProbe)[]) {
      expect(safeToReload({ ...IDLE, [key]: true }), key).toBe(false);
    }
  });

  it('happens by itself once per version and tab, then waits for the button', () => {
    expect(webDecision({ latest: '1.16.1', mark: null, safe: true, canMark: true })).toBe('reload');
    // Loaded for this version already and still the old bundle: a cache in the way. No loop.
    expect(webDecision({ latest: '1.16.1', mark: '1.16.1', safe: true, canMark: true })).toBe('lock');
    // A still newer version gets its one try.
    expect(webDecision({ latest: '1.16.2', mark: '1.16.1', safe: true, canMark: true })).toBe('reload');
    // Something open: never thrown away.
    expect(webDecision({ latest: '1.16.1', mark: null, safe: false, canMark: true })).toBe('lock');
    // Nowhere to note the try: it could loop, so it does not try.
    expect(webDecision({ latest: '1.16.1', mark: null, safe: true, canMark: false })).toBe('lock');
  });

  it('notes the version in this tab only, and forgets it once reached', () => {
    const session = memorySession();
    expect(readReloadMark(session)).toBeNull();
    expect(writeReloadMark(session, '1.16.1')).toBe(true);
    expect(session.values.get(RELOAD_MARK_KEY)).toBe('1.16.1');
    expect(readReloadMark(session)).toBe('1.16.1');
    settleReloadMark(session, '1.16.0');
    expect(readReloadMark(session)).toBe('1.16.1');
    settleReloadMark(session, '1.16.1');
    expect(readReloadMark(session)).toBeNull();
    expect(writeReloadMark(null, '1.16.1')).toBe(false);
    const broken = { getItem: () => null, setItem: () => {
      throw new Error('QuotaExceededError');
    }, removeItem: () => {} };
    expect(writeReloadMark(broken, '1.16.1')).toBe(false);
    expect(readReloadMark({ getItem: () => {
      throw new Error('SecurityError');
    }, setItem: () => {}, removeItem: () => {} })).toBeNull();
  });

  it('by hand drops the app shell and its worker, and nothing else', async () => {
    const caches = new Map([
      [`${SHELL_CACHE_PREFIX}1.16.0-0123456789`, 1],
      [`${SHELL_CACHE_PREFIX}1.15.2-abcdefabcd`, 1],
      ['someone-else', 1],
    ]);
    const unregister = vi.fn(async () => true);
    await dropAppShell({
      caches: { keys: async () => [...caches.keys()], delete: async (key: string) => caches.delete(key) },
      serviceWorker: { getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration] },
    });
    expect([...caches.keys()]).toEqual(['someone-else']);
    expect(unregister).toHaveBeenCalledOnce();
    // Without caches or a worker (a private window, an old browser) it still resolves.
    await expect(dropAppShell({})).resolves.toBeUndefined();
    await expect(dropAppShell({ caches: { keys: async () => Promise.reject(new Error('no')), delete: async () => false } })).resolves.toBeUndefined();
  });

  it('asks the worker for the newer one, but does not wait for ever', async () => {
    const update = vi.fn(async () => {});
    await refreshWorker({ serviceWorker: { getRegistrations: async () => [{ update } as unknown as ServiceWorkerRegistration] } });
    expect(update).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    try {
      const hanging = refreshWorker({ serviceWorker: { getRegistrations: () => new Promise(() => {}) } }, 5000);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(hanging).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
