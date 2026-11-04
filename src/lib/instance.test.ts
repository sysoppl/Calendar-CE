// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimInstance, TAKE_OVER_MS, type Instance } from './instance';
import { IDBFactory } from 'fake-indexeddb';
import { createEventIcs } from '@/lib/ical/events';
vi.setConfig({ testTimeout: 30_000 });

/**
 * The browser's lock manager as the pages of one browser share it: one lock,
 * `ifAvailable`, `steal`, waiting requests, and a page that goes away
 * (`discard`) releasing what it held.
 */
class Locks {
  private holder: { page: number; abort: () => void } | null = null;
  private waiting: { page: number; grant: () => void }[] = [];

  /** What one page sees as `navigator.locks`. */
  page(page: number): LockManager {
    return {
      request: (_name: string, a: LockOptions | LockGrantedCallback<unknown>, b?: LockGrantedCallback<unknown>) => {
        const options = typeof a === 'function' ? {} : a;
        const callback = (typeof a === 'function' ? a : b)!;
        return new Promise((resolve, reject) => {
          const run = (lock: Lock | null) => Promise.resolve().then(() => callback(lock));
          const grant = () => {
            const holder = { page, abort: () => reject(new DOMException('The lock was taken', 'AbortError')) };
            this.holder = holder;
            run({ name: 'calendar-app', mode: 'exclusive' }).then(
              (value) => {
                this.release(holder);
                resolve(value);
              },
              (err) => {
                this.release(holder);
                reject(err);
              },
            );
          };
          if (options.steal) {
            this.holder?.abort();
            this.holder = null;
            grant();
          } else if (!this.holder && !this.waiting.length) grant();
          else if (options.ifAvailable) run(null).then(resolve, reject);
          else this.waiting.push({ page, grant });
        });
      },
      query: () => Promise.resolve({ held: [], pending: [] }),
    } as unknown as LockManager;
  }

  holds(page: number): boolean {
    return this.holder?.page === page;
  }

  /** The page is closed or loads again: what it held is free, what it waited for is not wanted any more. */
  discard(page: number): void {
    this.waiting = this.waiting.filter((w) => w.page !== page);
    if (this.holder?.page === page) this.release(this.holder);
  }

  private release(holder: { page: number }): void {
    if (this.holder !== holder) return;
    this.holder = null;
    this.waiting.shift()?.grant();
  }
}

function eventIcs(uid: string, title = uid, start = new Date(2026, 9, 14, 9, 0)): string {
  return createEventIcs({
    uid,
    title,
    description: '',
    location: '',
    start,
    end: new Date(start.getTime() + 3600_000),
    allDay: false,
    timezone: 'Europe/Warsaw',
    alarms: [],
    busy: true,
    attendees: [],
    categories: [],
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

interface Page {
  id: number;
  instance: Instance;
  runs: () => boolean;
  waiting: () => boolean;
  replaced: ReturnType<typeof vi.fn>;
}

let locks: Locks;
let pages = 0;

function openPage(onReplaced?: () => void): Page {
  const id = ++pages;
  let running = false;
  let waiting = false;
  const replaced = vi.fn(onReplaced ?? (() => {}));
  const instance = claimInstance({ locks: locks.page(id), onWaiting: () => (waiting = true), onReplaced: replaced });
  void instance.ready.then(() => (running = true));
  return { id, instance, runs: () => running, waiting: () => waiting, replaced };
}

beforeEach(() => {
  locks = new Locks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('one copy of the app per browser', () => {
  it('runs in the first page; another one waits, and starts by itself once the first is closed', async () => {
    const first = openPage();
    await tick();
    expect(first.runs()).toBe(true);
    expect(first.waiting()).toBe(false);

    const second = openPage();
    await tick();
    expect(second.waiting()).toBe(true);
    expect(second.runs()).toBe(false);

    locks.discard(first.id);
    await tick();
    expect(second.runs()).toBe(true);
    expect(locks.holds(second.id)).toBe(true);
  });

  it('moves to a page that asks, only once the page before is gone', async () => {
    const first = openPage();
    await tick();
    const second = openPage();
    await tick();

    second.instance.takeOver();
    await tick();
    // The page that ran is told to stop (it loads again), and still holds the
    // lock until it is gone: whatever it writes last lands before the next copy reads.
    expect(first.replaced).toHaveBeenCalledTimes(1);
    expect(second.runs()).toBe(false);

    locks.discard(first.id);
    await tick();
    expect(second.runs()).toBe(true);

    // Loaded again, the first page now waits in its turn.
    const again = openPage();
    await tick();
    expect(again.waiting()).toBe(true);
    expect(again.runs()).toBe(false);
  });

  it('takes the lock from a page that does not answer, which stops as soon as it runs', async () => {
    const first = openPage();
    await tick();
    // A page that does not go away when asked (the browser froze it, or it hangs).
    first.replaced.mockImplementation(() => {});
    const second = openPage();
    await tick();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    second.instance.takeOver();
    await vi.advanceTimersByTimeAsync(TAKE_OVER_MS - 100);
    expect(second.runs()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await tick();
    expect(second.runs()).toBe(true);
    expect(locks.holds(second.id)).toBe(true);
    // Once it runs again, the first page learns that the lock was taken from it.
    expect(first.replaced).toHaveBeenCalled();
  });

  it('lets every page run where there are no locks', async () => {
    const one = claimInstance({ locks: null, onWaiting: () => {} });
    const two = claimInstance({ locks: null, onWaiting: () => {} });
    await expect(Promise.all([one.ready, two.ready])).resolves.toBeDefined();
  });
});

describe('two pages of one browser', () => {
  /** A browser's storage: what two pages of it share. */
  interface BrowserStorage {
    idb: IDBFactory;
    local: Storage;
  }

  const newStorage = (): BrowserStorage => {
    const items = new Map<string, string>();
    const local: Storage = {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, String(value)),
    };
    return { idb: new IDBFactory(), local };
  };

  /** Starts the app's store from fresh modules over `storage`, as a page of that browser does. */
  async function startDevice(storage: BrowserStorage) {
    vi.stubGlobal('indexedDB', storage.idb);
    vi.stubGlobal('localStorage', storage.local);
    vi.resetModules();
    const data = await import('@/store/data');
    await data.useData.getState().init();
    return { storage, state: () => data.useData.getState() };
  }
  type Device = Awaited<ReturnType<typeof startDevice>>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Opens a second page and starts the app in it as soon as it may run (as
   * main.tsx does): right away, before the first page goes on, where it is
   * not made to wait.
   */
  async function openSecond(storage: BrowserStorage): Promise<{ page: Page; started: Promise<Device> }> {
    const app = openApp(storage);
    const started = app.device();
    await tick();
    if (!app.page.waiting()) await started;
    return { page: app.page, started };
  }

  /** A page of the browser that holds `storage`: the app starts in it only once it may run (as main.tsx does). */
  function openApp(storage: BrowserStorage = newStorage()): { page: Page; device: () => Promise<Device> } {
    const page = openPage();
    return {
      page,
      device: async () => {
        await page.instance.ready;
        return startDevice(storage);
      },
    };
  }

  it('keep a calendar made in one of them while the other changes something', async () => {
    const a = openApp();
    const tabA = await a.device();
    await tabA.state().setupLocalDefaults();
    const b = await openSecond(tabA.storage);

    const work = await tabA.state().createCalendar('local', { name: 'Work', color: '#2d772a', components: ['VEVENT'] });
    await tabA.state().applyOps([{ type: 'create', calendarId: work.id, uid: 'w1', data: eventIcs('w1', 'Board meeting') }]);

    locks.discard(a.page.id);
    const tabB = await b.started;
    const other = tabB.state().calendars.find((c) => c.accountId === 'local' && c.id !== work.id)!;
    tabB.state().setCalendarVisible(other.id, false);
    locks.discard(b.page.id);

    const next = await openApp(tabA.storage).device();
    expect(next.state().calendars.some((c) => c.id === work.id)).toBe(true);
    expect(Object.values(next.state().objects[work.id] ?? {})).toHaveLength(1);
  });
});
