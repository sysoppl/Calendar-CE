import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromBase64, fromHex, toBase64, toHex, utf8 } from './encoding';
import {
  CryptoError,
  KIND,
  MAX_PLAINTEXT_BYTES,
  open,
  openJson,
  paddedLength,
  seal,
  sealedLength,
  sealJson,
  sealWithSalt,
  type Context,
  type CryptoErrorCode,
  type Kind,
} from './envelope';
import { importAccountKeys } from './keys';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OTHER_KEY = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const SALT = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 ^ i);
const CTX: Context = { projectId: 'calendar', scope: 'objects', id: '5f1c0d6b8a9e4c3fb2a17d0e6c4b9a58', ownerId: '66f2a1b3c4d5e6f70812' };
const KINDS: Kind[] = [1, 2, 3, 4, 5];
const MESSAGE = utf8('attack at dawn');

const HEADER = 8;
const BODY = 72;
const TAG = 16;

async function expectCode(promise: Promise<unknown>, code: CryptoErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CryptoError);
  expect((error as CryptoError).code).toBe(code);
}

function hkdfKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
}

/** The envelope with one byte changed. */
function withByte(text: string, index: number, change: (byte: number) => number): string {
  const bytes = fromBase64(text);
  bytes[index] = change(bytes[index]);
  return toBase64(bytes);
}

describe('seal and open', () => {
  it('round-trips every kind with raw keys and with CryptoKeys', async () => {
    const cryptoKey = await hkdfKey(KEY);
    for (const kind of KINDS) {
      const plaintext = utf8(`a value of kind ${kind}: zażółć gęślą jaźń`);
      const fromRaw = await seal(KEY, kind, CTX, plaintext);
      const fromKey = await seal(cryptoKey, kind, CTX, plaintext);
      // The two forms of one key are interchangeable.
      for (const text of [fromRaw, fromKey]) {
        expect(await open(KEY, kind, CTX, text)).toEqual(plaintext);
        expect(await open(cryptoKey, kind, CTX, text)).toEqual(plaintext);
      }
    }
  });

  it('round-trips with the working keys of an account', async () => {
    const keys = await importAccountKeys(randomBytes(32));
    expect(await open(keys.data, KIND.object, CTX, await seal(keys.data, KIND.object, CTX, MESSAGE))).toEqual(MESSAGE);
    expect(await open(keys.reminders, KIND.reminderDigest, CTX, await seal(keys.reminders, KIND.reminderDigest, CTX, MESSAGE))).toEqual(MESSAGE);
  });

  it('round-trips an empty plaintext and one made of zero bytes', async () => {
    expect(await open(KEY, 3, CTX, await seal(KEY, 3, CTX, new Uint8Array(0)))).toHaveLength(0);
    const zeros = new Uint8Array(700);
    expect(await open(KEY, 3, CTX, await seal(KEY, 3, CTX, zeros))).toEqual(zeros);
  });

  it('takes a view into a larger buffer as it is', async () => {
    const backing = randomBytes(64);
    const view = backing.subarray(10, 30);
    expect(Buffer.from(await open(KEY, 1, CTX, await seal(KEY, 1, CTX, view))).equals(view)).toBe(true);
    const key = Buffer.concat([randomBytes(5), KEY, randomBytes(5)]).subarray(5, 37);
    expect(await open(KEY, 1, CTX, await seal(key, 1, CTX, MESSAGE))).toEqual(MESSAGE);
    // A view of another element size is sealed as its bytes, not as its elements.
    const store = Uint8Array.from(randomBytes(32));
    const words = new Uint16Array(store.buffer);
    expect(await open(KEY, 1, CTX, await seal(KEY, 1, CTX, words as unknown as Uint8Array))).toEqual(store);
  });

  it('draws a fresh salt for every encryption', async () => {
    const a = fromBase64(await seal(KEY, 1, CTX, MESSAGE));
    const b = fromBase64(await seal(KEY, 1, CTX, MESSAGE));
    expect(toHex(a.subarray(HEADER, 40))).not.toBe(toHex(b.subarray(HEADER, 40)));
    expect(toHex(a.subarray(40, BODY))).not.toBe(toHex(b.subarray(40, BODY)));
    expect(toHex(a.subarray(BODY))).not.toBe(toHex(b.subarray(BODY)));
  });

  it('is deterministic for a given salt, and changes completely with it', async () => {
    const a = await sealWithSalt(KEY, 1, CTX, MESSAGE, SALT);
    expect(await sealWithSalt(KEY, 1, CTX, MESSAGE, SALT)).toBe(a);
    const other = SALT.slice();
    other[31] ^= 1;
    const b = fromBase64(await sealWithSalt(KEY, 1, CTX, MESSAGE, other));
    expect(toHex(b.subarray(40, BODY))).not.toBe(toHex(fromBase64(a).subarray(40, BODY)));
    expect(toHex(b.subarray(BODY, BODY + 32))).not.toBe(toHex(fromBase64(a).subarray(BODY, BODY + 32)));
  });

  it('lays the envelope out as header, salt, commit and body, in standard base64', async () => {
    for (const kind of KINDS) {
      const text = await sealWithSalt(KEY, kind, CTX, MESSAGE, SALT);
      expect(text).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(text).toHaveLength(800);
      const bytes = fromBase64(text);
      expect(bytes).toHaveLength(BODY + 512 + TAG);
      expect(Array.from(bytes.subarray(0, HEADER))).toEqual([1, 1, kind, 1, 0, 0, 0, 0]);
      expect(toHex(bytes.subarray(HEADER, 40))).toBe(toHex(SALT));
    }
  });

  it('does not leak the plaintext into the envelope', async () => {
    const plaintext = utf8('SUMMARY:Very recognisable words '.repeat(20));
    const bytes = Buffer.from(fromBase64(await seal(KEY, 1, CTX, plaintext)));
    expect(bytes.includes('recognisable')).toBe(false);
    expect(bytes.includes(Buffer.from(KEY))).toBe(false);
  });

  it('hands back a buffer of its own', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    const first = await open(KEY, 1, CTX, text);
    first.fill(0);
    expect(await open(KEY, 1, CTX, text)).toEqual(MESSAGE);
    expect(first.buffer.byteLength).toBe(MESSAGE.length);
  });
});

describe('padding', () => {
  it('pads to steps of 512 bytes up to 8192 and with Padmé above', () => {
    const sizes: [number, number][] = [
      [0, 512],
      [1, 512],
      [507, 512],
      [508, 512],
      [509, 1024],
      [1020, 1024],
      [1021, 1536],
      [8187, 8192],
      [8188, 8192],
      // From here on the last E - S bits of the length are rounded away.
      [8189, 8704],
      [8700, 8704],
      [8701, 9216],
      [16379, 16384],
      [16380, 16384],
      [16381, 17408],
      [20000, 20480],
      [65532, 65536],
      [65533, 67584],
      [524288, 540672],
      [1048576, 1081344],
    ];
    for (const [plaintext, padded] of sizes) expect([plaintext, paddedLength(plaintext)]).toEqual([plaintext, padded]);
  });

  it('never shrinks, never goes down as the plaintext grows, and stays within the promised overhead', () => {
    let previous = 0;
    for (let length = 0; length < 300_000; length += length < 20_000 ? 1 : 97) {
      const total = length + 4;
      const padded = paddedLength(length);
      expect(padded).toBeGreaterThanOrEqual(total);
      expect(padded).toBeGreaterThanOrEqual(previous);
      expect(padded - total).toBeLessThan(Math.max(512, total * 0.12));
      // A padded size is a fixed point: padding it again changes nothing.
      expect(paddedLength(padded - 4)).toBe(padded);
      previous = padded;
    }
  });

  it('produces envelopes of exactly the padded size', async () => {
    for (const length of [0, 1, 507, 508, 509, 1020, 1021, 8188, 8189, 16380, 16381, 20000]) {
      const plaintext = randomBytes(length);
      const text = await seal(KEY, 1, CTX, plaintext);
      expect(fromBase64(text)).toHaveLength(BODY + paddedLength(length) + TAG);
      expect(text).toHaveLength(sealedLength(length));
      expect(Buffer.from(await open(KEY, 1, CTX, text)).equals(plaintext)).toBe(true);
    }
  });

  it('gives plaintexts of different sizes the same length', async () => {
    const short = await seal(KEY, 1, CTX, randomBytes(3));
    const long = await seal(KEY, 1, CTX, randomBytes(500));
    expect(short).toHaveLength(long.length);
  });
});

describe('tampering', () => {
  // 600 derivations and decryptions. Started together rather than one after
  // another: each step of WebCrypto waits for a thread-pool round trip, which
  // on a loaded machine took long enough for 600 in a row to pass 30 s.
  it('rejects a change to any single byte of the envelope', { timeout: 30_000 }, async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    const length = fromBase64(text).length;
    expect(length).toBe(600);
    await Promise.all(
      Array.from({ length }, (_, index) => {
        // A different bit in every position, so all eight are exercised.
        const tampered = withByte(text, index, (byte) => byte ^ (1 << index % 8));
        // The version, suite and padding bytes and the key generation name a
        // scheme; the kind and everything after the header are authenticated.
        const code: CryptoErrorCode = index === 2 || index >= HEADER ? 'auth' : 'version';
        return expectCode(open(KEY, 1, CTX, tampered), code);
      }),
    );
  });

  it('rejects unknown versions, suites, padding schemes and key generations', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    for (const value of [0, 2, 255]) {
      await expectCode(open(KEY, 1, CTX, withByte(text, 0, () => value)), 'version');
      await expectCode(open(KEY, 1, CTX, withByte(text, 1, () => value)), 'version');
      await expectCode(open(KEY, 1, CTX, withByte(text, 3, () => value)), 'version');
    }
    for (const index of [4, 5, 6, 7]) await expectCode(open(KEY, 1, CTX, withByte(text, index, () => 1)), 'version');
  });

  it('rejects a kind byte that was changed, whatever kind is asked for', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    for (const value of [0, 2, 5, 6, 255]) {
      const tampered = withByte(text, 2, () => value);
      for (const kind of KINDS) await expectCode(open(KEY, kind, CTX, tampered), 'auth');
    }
  });

  it('rejects parts taken from another envelope of the same key and place', async () => {
    const a = fromBase64(await seal(KEY, 1, CTX, MESSAGE));
    const b = fromBase64(await seal(KEY, 1, CTX, MESSAGE));
    const splice = (from: number, to: number): string => {
      const mixed = a.slice();
      mixed.set(b.subarray(from, to), from);
      return toBase64(mixed);
    };
    await expectCode(open(KEY, 1, CTX, splice(HEADER, 40)), 'auth'); // salt
    await expectCode(open(KEY, 1, CTX, splice(40, BODY)), 'auth'); // commit
    await expectCode(open(KEY, 1, CTX, splice(BODY, a.length)), 'auth'); // body and tag
    await expectCode(open(KEY, 1, CTX, splice(a.length - TAG, a.length)), 'auth'); // tag
    await expectCode(open(KEY, 1, CTX, splice(HEADER, BODY)), 'auth'); // salt and commit, with the wrong body
  });

  it('rejects truncated envelopes', async () => {
    const bytes = fromBase64(await seal(KEY, 1, CTX, randomBytes(600)));
    expect(bytes).toHaveLength(BODY + 1024 + TAG);
    for (const length of [0, 1, 7, 8, 9, 39, 40, 71, 72, 73, 87, 88, 89, 599, 601, 1111]) {
      await expectCode(open(KEY, 1, CTX, toBase64(bytes.subarray(0, length))), 'format');
    }
    // A whole block cut off leaves a possible length; it then fails authentication.
    await expectCode(open(KEY, 1, CTX, toBase64(bytes.subarray(0, 600))), 'auth');
  });

  it('rejects extended envelopes', async () => {
    const bytes = fromBase64(await seal(KEY, 1, CTX, MESSAGE));
    const extended = (extra: number): string => {
      const out = new Uint8Array(bytes.length + extra);
      out.set(bytes);
      return toBase64(out);
    };
    await expectCode(open(KEY, 1, CTX, extended(1)), 'format');
    await expectCode(open(KEY, 1, CTX, extended(16)), 'format');
    await expectCode(open(KEY, 1, CTX, extended(512)), 'auth');
  });

  it('rejects text that is not standard base64', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    const bad = ['', 'not an envelope', text + '\n', ' ' + text, text.slice(0, -1), text + '=', text.replace(/\+/g, '-').replace(/\//g, '_'), text.slice(0, 400) + '\n' + text.slice(400)];
    for (const candidate of bad) await expectCode(open(KEY, 1, CTX, candidate), 'format');
    await expectCode(open(KEY, 1, CTX, undefined as unknown as string), 'format');
    await expectCode(open(KEY, 1, CTX, fromBase64(text) as unknown as string), 'format');
  });
});

describe('wrong key or wrong place', () => {
  it('rejects another key', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    await expectCode(open(OTHER_KEY, 1, CTX, text), 'auth');
    await expectCode(open(await hkdfKey(OTHER_KEY), 1, CTX, text), 'auth');
    for (const index of [0, 15, 31]) {
      const near = KEY.slice();
      near[index] ^= 0x80;
      await expectCode(open(near, 1, CTX, text), 'auth');
    }
  });

  it('rejects every context field that differs', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    for (const field of ['projectId', 'scope', 'id', 'ownerId'] as const) {
      await expectCode(open(KEY, 1, { ...CTX, [field]: CTX[field] + 'x' }, text), 'auth');
      await expectCode(open(KEY, 1, { ...CTX, [field]: CTX[field].slice(0, -1) }, text), 'auth');
      await expectCode(open(KEY, 1, { ...CTX, [field]: CTX[field].toUpperCase() + '!' }, text), 'auth');
      await expectCode(open(KEY, 1, { ...CTX, [field]: 'x' + CTX[field].slice(1) }, text), 'auth');
    }
    expect(await open(KEY, 1, { ...CTX }, text)).toEqual(MESSAGE);
  });

  it('keeps the fields apart: the same characters split differently are another place', async () => {
    const text = await seal(KEY, 1, { projectId: 'calendar', scope: 'ab', id: 'cd', ownerId: 'ef' }, MESSAGE);
    await expectCode(open(KEY, 1, { projectId: 'calendar', scope: 'a', id: 'bcd', ownerId: 'ef' }, text), 'auth');
    await expectCode(open(KEY, 1, { projectId: 'calendar', scope: 'abc', id: 'd', ownerId: 'ef' }, text), 'auth');
    await expectCode(open(KEY, 1, { projectId: 'calendar', scope: 'ab', id: 'c', ownerId: 'def' }, text), 'auth');
    await expectCode(open(KEY, 1, { projectId: 'calendara', scope: 'b', id: 'cd', ownerId: 'ef' }, text), 'auth');
    await expectCode(open(KEY, 1, { projectId: 'calendar', scope: 'cd', id: 'ab', ownerId: 'ef' }, text), 'auth');
  });

  it('counts the bytes of a field, not its characters', async () => {
    const ctx: Context = { projectId: 'calendar', scope: 'objects', id: 'wiersz-ąę-📅', ownerId: 'użytkownik' };
    const text = await seal(KEY, 1, ctx, MESSAGE);
    expect(await open(KEY, 1, ctx, text)).toEqual(MESSAGE);
    await expectCode(open(KEY, 1, { ...ctx, id: 'wiersz-ae-📅' }, text), 'auth');
  });

  it('rejects a value of another kind', async () => {
    for (const sealed of KINDS) {
      const text = await seal(KEY, sealed, CTX, MESSAGE);
      for (const asked of KINDS) {
        if (asked === sealed) expect(await open(KEY, asked, CTX, text)).toEqual(MESSAGE);
        else await expectCode(open(KEY, asked, CTX, text), 'auth');
      }
    }
  });

  it('refuses keys it cannot use', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    const keys = await importAccountKeys(randomBytes(32));
    const aes = await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const bad = [new Uint8Array(0), new Uint8Array(16), new Uint8Array(31), new Uint8Array(33), keys.ids, aes, null, undefined, 'key'] as unknown as Uint8Array[];
    for (const key of bad) {
      await expectCode(seal(key, 1, CTX, MESSAGE), 'format');
      await expectCode(open(key, 1, CTX, text), 'format');
    }
  });

  it('refuses a context with a missing, empty or oversized field', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    const bad = [
      { ...CTX, projectId: '' },
      { ...CTX, scope: '' },
      { ...CTX, id: '' },
      { ...CTX, ownerId: '' },
      { ...CTX, id: undefined },
      { ...CTX, ownerId: null },
      { ...CTX, id: 42 },
      { projectId: 'calendar', scope: 'objects', id: 'x' },
      { ...CTX, id: 'x'.repeat(65536) },
      { ...CTX, id: 'ż'.repeat(32768) },
      undefined,
    ] as unknown as Context[];
    for (const ctx of bad) {
      await expectCode(seal(KEY, 1, ctx, MESSAGE), 'format');
      await expectCode(open(KEY, 1, ctx, text), 'format');
    }
    const longest = { ...CTX, id: 'x'.repeat(65535) };
    expect(await open(KEY, 1, longest, await seal(KEY, 1, longest, MESSAGE))).toEqual(MESSAGE);
  });

  it('refuses a kind that does not exist', async () => {
    const text = await seal(KEY, 1, CTX, MESSAGE);
    for (const kind of [0, 6, 1.5, -1, NaN, '1', undefined] as unknown as Kind[]) {
      await expectCode(seal(KEY, kind, CTX, MESSAGE), 'format');
      await expectCode(open(KEY, kind, CTX, text), 'format');
    }
  });

  it('refuses a plaintext that is not bytes, and a salt of the wrong size', async () => {
    await expectCode(seal(KEY, 1, CTX, 'text' as unknown as Uint8Array), 'format');
    await expectCode(seal(KEY, 1, CTX, [1, 2, 3] as unknown as Uint8Array), 'format');
    await expectCode(sealWithSalt(KEY, 1, CTX, MESSAGE, SALT.subarray(0, 31)), 'format');
    await expectCode(sealWithSalt(KEY, 1, CTX, MESSAGE, new Uint8Array(33)), 'format');
  });
});

describe('JSON values', () => {
  const value = { c: 'c7a1f0e2d3b4c5a6978801f2e3d4c5b6', d: 'BEGIN:VCALENDAR\r\nSUMMARY:Zażółć gęślą jaźń 📅\r\nEND:VCALENDAR\r\n', n: [1, 2.5, null, true] };

  it('round-trips', async () => {
    const text = await sealJson(KEY, 1, CTX, value);
    expect(await openJson(KEY, 1, CTX, text)).toEqual(value);
    // The plaintext is the UTF-8 of the JSON text, nothing else.
    expect(Buffer.from(await open(KEY, 1, CTX, text)).toString('utf8')).toBe(JSON.stringify(value));
    expect(await openJson(KEY, 3, CTX, await sealJson(KEY, 3, CTX, null))).toBeNull();
    expect(await openJson<string>(KEY, 3, CTX, await sealJson(KEY, 3, CTX, 'text'))).toBe('text');
  });

  it('rejects a plaintext that is not JSON or not UTF-8', async () => {
    await expectCode(openJson(KEY, 1, CTX, await seal(KEY, 1, CTX, utf8('{"c": '))), 'format');
    await expectCode(openJson(KEY, 1, CTX, await seal(KEY, 1, CTX, new Uint8Array(0))), 'format');
    await expectCode(openJson(KEY, 1, CTX, await seal(KEY, 1, CTX, fromHex('7b22c3287d'))), 'format');
    await expectCode(openJson(KEY, 4, CTX, await seal(KEY, 4, CTX, randomBytes(32))), 'format');
  });

  it('refuses values without a JSON form', async () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    for (const bad of [undefined, () => 1, Symbol('x'), loop, 10n]) await expectCode(sealJson(KEY, 1, CTX, bad), 'format');
  });

  it('passes the errors of open through', async () => {
    const text = await sealJson(KEY, 1, CTX, value);
    await expectCode(openJson(OTHER_KEY, 1, CTX, text), 'auth');
    await expectCode(openJson(KEY, 1, CTX, withByte(text, 0, () => 2)), 'version');
    await expectCode(openJson(KEY, 1, CTX, text.slice(0, -4)), 'format');
  });
});

describe('large values', () => {
  it('round-trips one mebibyte', async () => {
    const plaintext = randomBytes(1024 * 1024);
    const text = await seal(KEY, 1, CTX, plaintext);
    expect(text).toHaveLength(sealedLength(plaintext.length));
    expect(fromBase64(text)).toHaveLength(BODY + 1081344 + TAG);
    expect(Buffer.from(await open(KEY, 1, CTX, text)).equals(plaintext)).toBe(true);
    // One changed byte in the middle of a megabyte is still caught.
    await expectCode(open(KEY, 1, CTX, withByte(text, 600_000, (byte) => byte ^ 1)), 'auth');
  });

  it('round-trips an object at the 512 KiB cap as JSON', async () => {
    const line = 'DESCRIPTION:Zażółć gęślą jaźń\r\n';
    const ics = line.repeat(Math.floor((512 * 1024) / Buffer.byteLength(line)));
    const stored = await openJson<{ c: string; d: string }>(KEY, 1, CTX, await sealJson(KEY, 1, CTX, { c: CTX.id, d: ics }));
    expect(stored.c).toBe(CTX.id);
    expect(stored.d).toBe(ics);
  });

  it('refuses a plaintext above its own limit', async () => {
    await expectCode(seal(KEY, 1, CTX, new Uint8Array(MAX_PLAINTEXT_BYTES + 1)), 'format');
  });
});
