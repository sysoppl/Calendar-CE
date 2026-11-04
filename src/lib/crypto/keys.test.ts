import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, utf8 } from './encoding';
import { open, seal, type Context } from './envelope';
import { CryptoError } from './errors';
import { CALENDAR_ALARMS_ROW_LABEL, exportReminderKey, generateAccountKey, importAccountKeys, objectRowLabel, profileRowLabel, randomRowId, rowId, SETTINGS_ROW_LABEL } from './keys';

const AMK = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const CTX: Context = { projectId: 'calendar', scope: 'reminders', id: 'c7a1f0e2d3b4c5a6978801f2e3d4c5b6', ownerId: '66f2a1b3c4d5e6f70812' };

/** HKDF-SHA-256 without a salt, from the platform instead of WebCrypto. */
function derive(amk: Uint8Array, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', amk, new Uint8Array(0), info, 32));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CryptoError);
  expect((error as CryptoError).code).toBe(code);
}

describe('account keys', () => {
  it('generates 32 random bytes', () => {
    const a = generateAccountKey();
    const b = generateAccountKey();
    expect(a).toHaveLength(32);
    expect(toHex(a)).not.toBe(toHex(b));
    expect(a.some((byte) => byte !== 0)).toBe(true);
  });

  it('imports working keys that cannot be exported', async () => {
    const keys = await importAccountKeys(AMK);
    for (const key of [keys.data, keys.reminders, keys.ids]) {
      expect(key.extractable).toBe(false);
      expect(key.type).toBe('secret');
      await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
      await expect(crypto.subtle.exportKey('jwk', key)).rejects.toThrow();
    }
    expect(keys.data.algorithm.name).toBe('HKDF');
    expect(keys.data.usages).toEqual(['deriveBits']);
    expect(keys.reminders.algorithm.name).toBe('HKDF');
    expect(keys.reminders.usages).toEqual(['deriveBits']);
    expect(keys.ids.algorithm.name).toBe('HMAC');
    expect(keys.ids.usages).toEqual(['sign']);
  });

  it('leaves the account key untouched', async () => {
    const amk = AMK.slice();
    await importAccountKeys(amk);
    await exportReminderKey(amk);
    expect(toHex(amk)).toBe(toHex(AMK));
  });

  it('derives the data and reminder keys with their own labels', async () => {
    const keys = await importAccountKeys(AMK);
    const plaintext = utf8('reminder digest');
    // A value sealed with the working key opens with the raw key derived independently, and the other way round.
    expect(await open(derive(AMK, 'cal/v1/reminders'), 5, CTX, await seal(keys.reminders, 5, CTX, plaintext))).toEqual(plaintext);
    expect(await open(keys.reminders, 5, CTX, await seal(derive(AMK, 'cal/v1/reminders'), 5, CTX, plaintext))).toEqual(plaintext);
    expect(await open(derive(AMK, 'cal/v1/data'), 1, CTX, await seal(keys.data, 1, CTX, plaintext))).toEqual(plaintext);
    // The two keys are not interchangeable, and neither is the account key itself.
    await expectCode(open(keys.data, 5, CTX, await seal(keys.reminders, 5, CTX, plaintext)), 'auth');
    await expectCode(open(keys.reminders, 5, CTX, await seal(keys.data, 5, CTX, plaintext)), 'auth');
    await expectCode(open(AMK, 5, CTX, await seal(keys.reminders, 5, CTX, plaintext)), 'auth');
  });

  it('exports only the reminder key, as raw bytes', async () => {
    const raw = await exportReminderKey(AMK);
    expect(raw).toHaveLength(32);
    expect(toHex(raw)).toBe(derive(AMK, 'cal/v1/reminders').toString('hex'));
    expect(toHex(raw)).not.toBe(derive(AMK, 'cal/v1/data').toString('hex'));
  });

  it('rejects an account key of the wrong size', async () => {
    for (const length of [0, 16, 31, 33, 64]) {
      await expectCode(importAccountKeys(new Uint8Array(length)), 'format');
      await expectCode(exportReminderKey(new Uint8Array(length)), 'format');
    }
    await expectCode(importAccountKeys('00'.repeat(32) as unknown as Uint8Array), 'format');
  });
});

describe('row ids', () => {
  const label = objectRowLabel('c7a1f0e2d3b4c5a6978801f2e3d4c5b6', 'event-1@example.com');

  it('builds the label of an object from its calendar row and its UID', () => {
    expect(label).toBe('obj\nc7a1f0e2d3b4c5a6978801f2e3d4c5b6\nevent-1@example.com');
    expect(SETTINGS_ROW_LABEL).toBe('settings');
    expect(profileRowLabel('phone')).toBe('settings\nphone');
    expect(profileRowLabel('computer')).toBe('settings\ncomputer');
    expect(CALENDAR_ALARMS_ROW_LABEL).toBe('settings\ncalendars');
  });

  it('is the first 32 hex characters of HMAC-SHA-256 under the ids key', async () => {
    const keys = await importAccountKeys(AMK);
    const idsKey = derive(AMK, 'cal/v1/ids');
    for (const text of [label, SETTINGS_ROW_LABEL, 'obj\nabc\nzażółć@example.com', '']) {
      const id = await rowId(keys, text);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(id).toBe(createHmac('sha256', idsKey).update(text, 'utf8').digest('hex').slice(0, 32));
    }
  });

  it('is deterministic per account and differs between labels and accounts', async () => {
    const keys = await importAccountKeys(AMK);
    const again = await importAccountKeys(AMK.slice());
    const other = await importAccountKeys(generateAccountKey());
    expect(await rowId(again, label)).toBe(await rowId(keys, label));
    expect(await rowId(keys, label + 'x')).not.toBe(await rowId(keys, label));
    expect(await rowId(keys, objectRowLabel('c7a1f0e2d3b4c5a6978801f2e3d4c5b7', 'event-1@example.com'))).not.toBe(await rowId(keys, label));
    expect(await rowId(other, label)).not.toBe(await rowId(keys, label));
    expect(await rowId(keys, SETTINGS_ROW_LABEL)).not.toBe(await rowId(keys, label));
    const settingsRows = [SETTINGS_ROW_LABEL, profileRowLabel('phone'), profileRowLabel('computer'), CALENDAR_ALARMS_ROW_LABEL];
    expect(new Set(await Promise.all(settingsRows.map((text) => rowId(keys, text)))).size).toBe(4);
  });

  it('draws random ids for calendar rows', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomRowId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
