import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersionAnswer } from './answer';
import type { UpdateChannel } from './channel';
import { APP_UPDATE_TIMING, INITIAL_APP_UPDATE, createAppUpdate, useAppUpdate, type AppUpdateController, type AppUpdateEnvironment } from './controller';
import { RELOAD_MARK_KEY } from './reload';

function memorySession(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

interface Rig {
  env: AppUpdateEnvironment;
  controller: AppUpdateController;
  answer: { current: VersionAnswer | null };
  fetchAnswer: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  safe: { current: boolean };
  online: { current: boolean };
  session: ReturnType<typeof memorySession>;
  wake: () => void;
  listen: ReturnType<typeof vi.fn>;
  unlisten: ReturnType<typeof vi.fn>;
  cacheKeys: string[];
  unregister: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

let rig: Rig | null = null;

const ANDROID_VERSION_URL = 'https://calendar.example.com/version.json';

function start(channel: UpdateChannel, options: { current?: string; answer?: VersionAnswer | null; session?: ReturnType<typeof memorySession> | null } = {}): Rig {
  const answer = { current: options.answer === undefined ? { version: '1.16.0' } : options.answer };
  const safe = { current: true };
  const online = { current: true };
  const session = options.session === null ? null : (options.session ?? memorySession());
  let wake = () => {};
  const unlisten = vi.fn();
  const listen = vi.fn((fn: () => void) => {
    wake = fn;
    return unlisten;
  });
  const cacheKeys = ['calendar-shell-1.16.0-0123456789', 'other'];
  const unregister = vi.fn(async () => true);
  const update = vi.fn(async () => {});
  const fetchAnswer = vi.fn(async () => answer.current);
  const reload = vi.fn();
  const env: AppUpdateEnvironment = {
    channel,
    current: options.current ?? '1.16.0',
    versionUrl: channel === 'android' ? ANDROID_VERSION_URL : '/version.json',
    fetchAnswer,
    safeToReload: () => safe.current,
    session: session as unknown as Storage | null,
    reload,
    shell: {
      caches: { keys: async () => [...cacheKeys], delete: async (key: string) => cacheKeys.splice(cacheKeys.indexOf(key), 1).length > 0 },
      serviceWorker: { getRegistrations: async () => [{ unregister, update } as unknown as ServiceWorkerRegistration] },
    },
    online: () => online.current,
    listen,
  };
  const controller = createAppUpdate(env);
  rig = { env, controller, answer, fetchAnswer, reload, safe, online, session: session!, wake: () => wake(), listen, unlisten, cacheKeys, unregister, update };
  return rig;
}

/** Lets the first ask (and what follows it, the settle wait included) run. */
async function settle() {
  await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.settleMs + 10);
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppUpdate.setState({ ...INITIAL_APP_UPDATE }, true);
});

afterEach(() => {
  rig?.controller.stop();
  rig = null;
  vi.useRealTimers();
});

describe('the browser', () => {
  it('stays unlocked on the newest version', async () => {
    const r = start('web');
    await settle();
    expect(r.fetchAnswer).toHaveBeenCalledWith('/version.json');
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'web', locked: false });
    expect(r.reload).not.toHaveBeenCalled();
  });

  it('loads itself again by itself when nothing is open, once, after asking the worker for the new one', async () => {
    const r = start('web', { answer: { version: '1.16.1' } });
    await vi.advanceTimersByTimeAsync(0);
    // Locked at once, busy, while writes under way land.
    expect(useAppUpdate.getState()).toMatchObject({ locked: true, busy: true, latest: '1.16.1' });
    expect(r.reload).not.toHaveBeenCalled();
    await settle();
    expect(r.session.values.get(RELOAD_MARK_KEY)).toBe('1.16.1');
    expect(r.update).toHaveBeenCalledOnce();
    expect(r.reload).toHaveBeenCalledOnce();
    // The automatic load leaves the user's caches and the worker alone.
    expect(r.cacheKeys).toHaveLength(2);
    expect(r.unregister).not.toHaveBeenCalled();
  });

  it('after a load that brought the old bundle again, shows the button instead of loading in a loop', async () => {
    const r = start('web', { answer: { version: '1.16.1' }, session: memorySession({ [RELOAD_MARK_KEY]: '1.16.1' }) });
    await settle();
    expect(useAppUpdate.getState()).toMatchObject({ locked: true, busy: false, latest: '1.16.1' });
    expect(r.reload).not.toHaveBeenCalled();
    // The button clears the app shell's caches and the worker first, so the next load comes from the server.
    await r.controller.update();
    expect(r.cacheKeys).toEqual(['other']);
    expect(r.unregister).toHaveBeenCalledOnce();
    expect(r.reload).toHaveBeenCalledOnce();
  });

  it('never throws away what is open: the lock waits for the button', async () => {
    const r = start('web', { answer: { version: '1.16.1' } });
    r.safe.current = false;
    await settle();
    expect(useAppUpdate.getState()).toMatchObject({ locked: true, busy: false });
    expect(r.reload).not.toHaveBeenCalled();
    await r.controller.update();
    expect(r.reload).toHaveBeenCalledOnce();
  });

  it('does not load by itself where the tab cannot note that it did', async () => {
    const r = start('web', { answer: { version: '1.16.1' }, session: null });
    await settle();
    expect(useAppUpdate.getState()).toMatchObject({ locked: true, busy: false });
    expect(r.reload).not.toHaveBeenCalled();
  });

  it('forgets the mark once this copy is the version it was for', async () => {
    const session = memorySession({ [RELOAD_MARK_KEY]: '1.16.1' });
    start('web', { current: '1.16.1', answer: { version: '1.16.1' }, session });
    await settle();
    expect(session.values.has(RELOAD_MARK_KEY)).toBe(false);
    expect(useAppUpdate.getState().locked).toBe(false);
  });

  it('is never locked by an answer it cannot read, nor while offline', async () => {
    const r = start('web', { answer: null });
    await settle();
    expect(useAppUpdate.getState().locked).toBe(false);
    r.online.current = false;
    r.answer.current = { version: '9.0.0' };
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(r.fetchAnswer).toHaveBeenCalledTimes(1);
    expect(useAppUpdate.getState().locked).toBe(false);
  });

  it('keeps the lock through answers it cannot read, and lifts it on a well-formed one that is not newer', async () => {
    const r = start('web', { answer: { version: '1.16.1' } });
    r.safe.current = false;
    await settle();
    expect(useAppUpdate.getState().locked).toBe(true);
    r.answer.current = null;
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(useAppUpdate.getState().locked).toBe(true);
    // The server went back to this version (a release rolled back).
    r.answer.current = { version: '1.16.0' };
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(useAppUpdate.getState()).toMatchObject({ locked: false, latest: null });
  });

  it('asks on start, on waking at most once a minute, and every 15 minutes', async () => {
    const r = start('web');
    await settle();
    expect(r.fetchAnswer).toHaveBeenCalledTimes(1);
    r.wake();
    await settle();
    expect(r.fetchAnswer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.gapMs);
    r.wake();
    await settle();
    expect(r.fetchAnswer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(r.fetchAnswer).toHaveBeenCalledTimes(3);
  });

  it('asks once at a time', async () => {
    const r = start('web');
    let release = () => {};
    r.fetchAnswer.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ version: '1.16.0' }))));
    await settle();
    const first = r.controller.check();
    const second = r.controller.check();
    expect(second).toBe(first);
    release();
    await first;
  });

  it('stops asking and listening when stopped', async () => {
    const r = start('web');
    await settle();
    r.controller.stop();
    expect(r.unlisten).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs * 3);
    expect(r.fetchAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('the Android app built with a server', () => {
  it('asks that server and locks for a newer version, which it never loads itself', async () => {
    const r = start('android');
    await settle();
    expect(r.fetchAnswer).toHaveBeenCalledWith(ANDROID_VERSION_URL);
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'android', locked: false });
    r.answer.current = { version: '1.16.1' };
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'android', locked: true, latest: '1.16.1', busy: false });
    // The lock links the download; nothing is loaded, cleared or unregistered.
    await r.controller.update();
    expect(r.reload).not.toHaveBeenCalled();
    expect(r.unregister).not.toHaveBeenCalled();
    expect(r.session.values.has(RELOAD_MARK_KEY)).toBe(false);
  });

  it('unlocks once the server says this is the newest version again', async () => {
    const r = start('android', { answer: { version: '1.17.0' } });
    await settle();
    expect(useAppUpdate.getState().locked).toBe(true);
    r.answer.current = { version: '1.16.0' };
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs);
    expect(useAppUpdate.getState().locked).toBe(false);
  });
});

describe('a copy with nothing to ask', () => {
  it('asks nothing, listens to nothing, and never locks', async () => {
    const r = start('none', { answer: { version: '9.0.0' } });
    await settle();
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMING.intervalMs * 2);
    r.wake();
    await settle();
    expect(r.fetchAnswer).not.toHaveBeenCalled();
    expect(r.listen).not.toHaveBeenCalled();
    expect(useAppUpdate.getState()).toMatchObject({ channel: 'none', locked: false });
  });
});
