import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawObject } from './ical/parse';

const object = (calendarId: string, name: string): RawObject => ({ url: `local://${calendarId}/${name}.ics`, etag: '"1"', calendarId, data: `DATA ${name}` });

async function load(broken: Partial<Record<'get' | 'set' | 'del' | 'delMany' | 'keys', boolean>> = {}) {
  vi.resetModules();
  vi.doMock('idb-keyval', async (original) => {
    const real = await original<typeof import('idb-keyval')>();
    const failing = Object.fromEntries(
      Object.keys(broken).map((name) => [name, () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))]),
    );
    return { ...real, ...failing };
  });
  return import('./storage');
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock('idb-keyval');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('object storage', () => {
  it('stores and loads the objects of a calendar', async () => {
    const storage = await load();
    expect(await storage.loadObjects('local|a')).toEqual([]);
    await storage.saveObjects('local|a', [object('local|a', 'one'), object('local|a', 'two')]);
    expect(await storage.loadObjects('local|a')).toEqual([object('local|a', 'one'), object('local|a', 'two')]);
    await storage.deleteObjects('local|a');
    expect(await storage.loadObjects('local|a')).toEqual([]);
  });

  it('tells "nothing stored" from "could not read"', async () => {
    const storage = await load({ get: true });
    expect(await storage.loadObjects('local|a')).toBeNull();
  });

  it('rejects a write that failed', async () => {
    const storage = await load({ set: true });
    await expect(storage.saveObjects('local|a', [object('local|a', 'one')])).rejects.toThrow(/quota/i);
  });

  it('never rejects a delete', async () => {
    const storage = await load({ del: true, delMany: true });
    await expect(storage.deleteObjects('local|a')).resolves.toBeUndefined();
    await expect(storage.deleteObjectsWithPrefix('local|')).resolves.toBeUndefined();
    const noKeys = await load({ keys: true });
    await expect(noKeys.deleteObjectsWithPrefix('local|')).resolves.toBeUndefined();
  });

  it('removes everything of one account and nothing of another', async () => {
    const storage = await load();
    for (const id of ['user1|work', 'user1|home', 'user10|work', 'local|personal']) await storage.saveObjects(id, [object(id, 'x')]);
    await storage.deleteObjectsWithPrefix('user1|');
    expect(await storage.loadObjects('user1|work')).toEqual([]);
    expect(await storage.loadObjects('user1|home')).toEqual([]);
    expect(await storage.loadObjects('user10|work')).toHaveLength(1);
    expect(await storage.loadObjects('local|personal')).toHaveLength(1);
  });

  it('keeps things in memory only where there is no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const storage = await load();
    await expect(storage.saveObjects('local|a', [object('local|a', 'one')])).resolves.toBeUndefined();
    expect(await storage.loadObjects('local|a')).toEqual([]);
    await expect(storage.deleteObjects('local|a')).resolves.toBeUndefined();
    await expect(storage.deleteObjectsWithPrefix('local|')).resolves.toBeUndefined();
  });
});
