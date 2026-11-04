// @vitest-environment jsdom
// The modules built on this one are tested in a DOM environment, where the
// globals (crypto, typed arrays, TextEncoder) are not always the ones Node
// provides. This keeps the module working there.
import { describe, expect, it } from 'vitest';
import { deriveLogin, deriveRecovery, generateAccountKey, generateSecretKey, importAccountKeys, open, openJson, rowId, seal, sealJson, toHex, utf8 } from './index';

describe('in a DOM environment', () => {
  const ctx = { projectId: 'calendar', scope: 'objects', id: '5f1c0d6b8a9e4c3fb2a17d0e6c4b9a58', ownerId: '66f2a1b3c4d5e6f70812' };

  it('has a document, so this really is the DOM environment', () => {
    expect(typeof document).toBe('object');
  });

  it('seals and opens with account keys and with raw keys', async () => {
    const amk = generateAccountKey();
    const keys = await importAccountKeys(amk);
    expect(await openJson(keys.data, 1, ctx, await sealJson(keys.data, 1, ctx, { c: 'calendar', d: 'ICS' }))).toEqual({ c: 'calendar', d: 'ICS' });
    const wrapped = await seal(new Uint8Array(32).fill(7), 4, { ...ctx, scope: 'prefs', id: 'pw' }, amk);
    expect(toHex(await open(new Uint8Array(32).fill(7), 4, { ...ctx, scope: 'prefs', id: 'pw' }, wrapped))).toBe(toHex(amk));
    expect(await rowId(keys, 'settings')).toMatch(/^[0-9a-f]{32}$/);
    expect(toHex(await open(keys.reminders, 5, ctx, await seal(keys.reminders, 5, ctx, utf8('digest'))))).toBe(toHex(utf8('digest')));
  });

  it('derives keys, with Argon2 on this thread because there is no Worker', { timeout: 30_000 }, async () => {
    expect(typeof Worker).toBe('undefined');
    const login = await deriveLogin('correct horse battery staple', generateSecretKey());
    expect(login.authKey).toHaveLength(43);
    expect(login.kek).toHaveLength(32);
    const recovery = await deriveRecovery('R10123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJK');
    expect(recovery.verifier).toHaveLength(64);
  });
});
