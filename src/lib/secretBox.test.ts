import { IDBFactory } from 'fake-indexeddb';
import { createStore, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SecretBox = typeof import('./secretBox');

/** A fresh copy of the module: it caches the key, like a tab does. */
async function freshModule(): Promise<SecretBox> {
  vi.resetModules();
  return import('./secretBox');
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('secretBox', () => {
  it('seals a secret and opens it again', async () => {
    const box = await freshModule();
    const sealed = await box.sealSecret('zażółć gęślą jaźń 🔑', 'account-1');
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(sealed).not.toContain('zażółć');
    expect(await box.openSecret(sealed!, 'account-1')).toBe('zażółć gęślą jaźń 🔑');
  });

  it('gives a different result every time', async () => {
    const box = await freshModule();
    const a = await box.sealSecret('secret', 'account-1');
    const b = await box.sealSecret('secret', 'account-1');
    expect(a).not.toBe(b);
    expect(await box.openSecret(b!, 'account-1')).toBe('secret');
  });

  it('opens only with the label it was sealed for', async () => {
    const box = await freshModule();
    const sealed = await box.sealSecret('secret', 'account-1');
    expect(await box.openSecret(sealed!, 'account-2')).toBeNull();
  });

  it('refuses what was tampered with or is not a box at all', async () => {
    const box = await freshModule();
    const sealed = (await box.sealSecret('secret', 'a'))!;
    const [version, iv, body] = sealed.split('.');
    const flipped = body.startsWith('A') ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(await box.openSecret(`${version}.${iv}.${flipped}`, 'a')).toBeNull();
    expect(await box.openSecret(`v2.${iv}.${body}`, 'a')).toBeNull();
    expect(await box.openSecret(`${sealed}.extra`, 'a')).toBeNull();
    expect(await box.openSecret('secret', 'a')).toBeNull();
    expect(await box.openSecret('', 'a')).toBeNull();
  });

  it('keeps one key in IndexedDB that cannot be exported, and uses it after a restart', async () => {
    const first = await freshModule();
    const sealed = (await first.sealSecret('secret', 'a'))!;

    const key = await get<CryptoKey>('box', createStore('calendar-secrets', 'keys'));
    expect(key?.extractable).toBe(false);
    expect(key?.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key!)).rejects.toThrow();

    // A new copy of the module stands for the app starting again.
    const second = await freshModule();
    expect(await second.openSecret(sealed, 'a')).toBe('secret');
    // Still the same key: what the second start seals, the first one can open.
    expect(await first.openSecret((await second.sealSecret('again', 'a'))!, 'a')).toBe('again');
  });

  it('cannot open anything once the key is gone, and does not make a new one to try', async () => {
    const first = await freshModule();
    const sealed = (await first.sealSecret('secret', 'a'))!;

    vi.stubGlobal('indexedDB', new IDBFactory());
    const second = await freshModule();
    expect(await second.openSecret(sealed, 'a')).toBeNull();
    expect(await get('box', createStore('calendar-secrets', 'keys'))).toBeUndefined();
  });

  it('settles on one key when two tabs start at the same time', async () => {
    const a = await freshModule();
    const b = await freshModule();
    const [fromA, fromB] = await Promise.all([a.sealSecret('one', 'x'), b.sealSecret('two', 'x')]);
    expect(await b.openSecret(fromA!, 'x')).toBe('one');
    expect(await a.openSecret(fromB!, 'x')).toBe('two');
  });

  describe('where the browser cannot do this', () => {
    it('answers null without IndexedDB', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const box = await freshModule();
      expect(await box.sealSecret('secret', 'a')).toBeNull();
      expect(await box.openSecret('v1.AAAA.AAAA', 'a')).toBeNull();
    });

    it('answers null without WebCrypto', async () => {
      vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
      const box = await freshModule();
      expect(await box.sealSecret('secret', 'a')).toBeNull();
    });

    it('answers null when IndexedDB refuses to open', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
      const box = await freshModule();
      expect(await box.sealSecret('secret', 'a')).toBeNull();
      // And works once storage does.
      vi.stubGlobal('indexedDB', new IDBFactory());
      expect(await box.sealSecret('secret', 'a')).not.toBeNull();
    });

    it('answers null when the key cannot be stored', async () => {
      const factory = new IDBFactory();
      vi.stubGlobal('indexedDB', factory);
      const box = await freshModule();
      // A key that cannot be cloned into the database.
      vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValueOnce((() => {}) as unknown as CryptoKey);
      expect(await box.sealSecret('secret', 'a')).toBeNull();
      vi.restoreAllMocks();
    });
  });

  it('tells a key store that did not open from a key that is gone', async () => {
    const working = new IDBFactory();
    vi.stubGlobal('indexedDB', working);
    const sealed = (await (await freshModule()).sealSecret('secret', 'a'))!;

    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('The database could not be opened', 'UnknownError');
      },
    });
    const down = await freshModule();
    expect(await down.readSecret(sealed, 'a')).toEqual({ failure: 'unavailable' });
    expect(await down.openSecret(sealed, 'a')).toBeNull();
    // The same copy of the module reads it once the store opens again.
    vi.stubGlobal('indexedDB', working);
    expect(await down.readSecret(sealed, 'a')).toEqual({ value: 'secret' });

    vi.stubGlobal('indexedDB', new IDBFactory());
    expect(await (await freshModule()).readSecret(sealed, 'a')).toEqual({ failure: 'lost' });
    expect(await (await freshModule()).readSecret('v1.broken', 'a')).toEqual({ failure: 'lost' });
  });
});
