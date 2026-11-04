import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { concat, fromBase64, fromBase64Url, fromHex, fromUtf8, toBase64, toBase64Url, toHex, utf8, wipe } from './encoding';
import { CryptoError } from './errors';

function expectFormatError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CryptoError);
  expect((caught as CryptoError).code).toBe('format');
}

describe('base64', () => {
  it('matches the RFC 4648 examples', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, encoded] of cases) {
      expect(toBase64(utf8(text))).toBe(encoded);
      expect(fromUtf8(fromBase64(encoded))).toBe(text);
    }
  });

  it('agrees with the platform encoder for every short length', () => {
    for (let length = 0; length <= 67; length++) {
      const bytes = randomBytes(length);
      expect(toBase64(bytes)).toBe(bytes.toString('base64'));
      expect(toBase64Url(bytes)).toBe(bytes.toString('base64url'));
      expect(Buffer.from(fromBase64(bytes.toString('base64'))).equals(bytes)).toBe(true);
      expect(Buffer.from(fromBase64Url(bytes.toString('base64url'))).equals(bytes)).toBe(true);
    }
  });

  it('uses the right alphabet and padding for each variant', () => {
    const bytes = Uint8Array.of(0xfb, 0xff, 0xfe);
    expect(toBase64(bytes)).toBe('+//+');
    expect(toBase64Url(bytes)).toBe('-__-');
    expect(toBase64(Uint8Array.of(0xfb, 0xff))).toBe('+/8=');
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
    expect(toBase64Url(new Uint8Array(32))).toHaveLength(43);
  });

  it('handles buffers of several megabytes', () => {
    const bytes = randomBytes(4 * 1024 * 1024 + 1);
    const text = toBase64(bytes);
    expect(text).toBe(bytes.toString('base64'));
    expect(Buffer.from(fromBase64(text)).equals(bytes)).toBe(true);
    const url = toBase64Url(bytes);
    expect(url).toBe(bytes.toString('base64url'));
    expect(Buffer.from(fromBase64Url(url)).equals(bytes)).toBe(true);
  });

  it('rejects everything that is not canonical standard base64', () => {
    const bad = [
      'Zg', // padding missing
      'Zg=', // padding too short
      'Zg===', // padding too long
      'Zm8==', // one character too many
      'Z', // a single character carries no byte
      'Z===',
      '====',
      '=',
      'Zm9v=', // padding after a full group
      'Zm=v', // padding in the middle
      'Zm9v Zm9v', // whitespace
      'Zm9v\n',
      ' Zm9v',
      'Zm9-', // the other alphabet
      'Zm9_',
      'Zm9vé', // not ASCII
      'Zm9ł',
      'Zh==', // stray bits after the last byte
      'Zm9=',
    ];
    for (const text of bad) expectFormatError(() => fromBase64(text));
    expectFormatError(() => fromBase64(undefined as unknown as string));
    expectFormatError(() => fromBase64(new Uint8Array(4) as unknown as string));
  });

  it('rejects everything that is not canonical base64url', () => {
    for (const text of ['Zg==', 'Zm8=', 'Z', 'Zm9vZ', 'Zm9+', 'Zm9/', 'Zm 9v', 'Zh', 'Zm9', 'Żm9v']) {
      expectFormatError(() => fromBase64Url(text));
    }
    expect(fromUtf8(fromBase64Url('Zm8'))).toBe('fo');
    expect(fromBase64Url('')).toHaveLength(0);
  });
});

describe('hex', () => {
  it('round-trips and writes lower case', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = toHex(bytes);
    expect(text).toBe(Buffer.from(bytes).toString('hex'));
    expect(fromHex(text)).toEqual(bytes);
    expect(fromHex(text.toUpperCase())).toEqual(bytes);
    expect(toHex(new Uint8Array(0))).toBe('');
    expect(fromHex('')).toHaveLength(0);
  });

  it('rejects malformed input', () => {
    for (const text of ['0', 'abc', '0g', 'zz', '0x00', ' 00', '00 ', 'é00', '0١']) expectFormatError(() => fromHex(text));
    expectFormatError(() => fromHex(null as unknown as string));
  });

  it('handles a megabyte', () => {
    const bytes = randomBytes(1024 * 1024);
    const text = toHex(bytes);
    expect(text).toBe(bytes.toString('hex'));
    expect(Buffer.from(fromHex(text)).equals(bytes)).toBe(true);
  });
});

describe('utf8', () => {
  it('round-trips text, including a leading byte order mark', () => {
    for (const text of ['', 'plain', 'zażółć gęślą jaźń', '📅 日程', '﻿with a mark', 'a\u0000b']) {
      expect(fromUtf8(utf8(text))).toBe(text);
    }
    expect(Array.from(utf8('ż'))).toEqual([0xc5, 0xbc]);
  });

  it('rejects bytes that are not UTF-8', () => {
    for (const bytes of [[0xff], [0xc3], [0xc3, 0x28], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80]]) {
      expectFormatError(() => fromUtf8(Uint8Array.from(bytes)));
    }
    // The decoder is shared; an error must not leave it in a broken state.
    expect(fromUtf8(utf8('still fine'))).toBe('still fine');
  });
});

describe('buffers', () => {
  it('concatenates', () => {
    expect(Array.from(concat(Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)))).toEqual([1, 2, 3]);
    expect(concat()).toHaveLength(0);
  });

  it('wipes in place and skips missing buffers', () => {
    const a = Uint8Array.of(1, 2, 3);
    const b = Uint8Array.of(4);
    wipe(a, undefined, b);
    expect(Array.from(a)).toEqual([0, 0, 0]);
    expect(Array.from(b)).toEqual([0]);
  });
});
