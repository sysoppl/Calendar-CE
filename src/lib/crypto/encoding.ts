// Byte and text conversions for the encryption module. An encrypted calendar
// object can reach megabytes, so nothing here spreads a buffer into the
// arguments of a call or grows a string one character at a time: text is
// assembled as ASCII bytes and decoded in one step.
import { CryptoError } from './errors';

/** Bytes backed by a plain ArrayBuffer: what WebCrypto takes and what this module returns. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
// `ignoreBOM` keeps a leading U+FEFF, which makes decoding the exact inverse of encoding.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const HEX = '0123456789abcdef';
const PAD = 61; // '='

/** Value of every ASCII character in an alphabet, -1 for the ones outside it. */
function reverse(alphabet: string, fold = false): Int8Array {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charCodeAt(i)] = i;
    if (fold) table[alphabet.toUpperCase().charCodeAt(i)] = i;
  }
  return table;
}

const STANDARD_CODES = encoder.encode(STANDARD);
const URL_SAFE_CODES = encoder.encode(URL_SAFE);
const HEX_CODES = encoder.encode(HEX);
const STANDARD_VALUES = reverse(STANDARD);
const URL_SAFE_VALUES = reverse(URL_SAFE);
const HEX_VALUES = reverse(HEX, true);

function malformed(what: string): CryptoError {
  return new CryptoError('format', `Malformed ${what}`);
}

export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

/** Strict decoding: an invalid sequence is an error, not a replacement character. */
export function fromUtf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw malformed('UTF-8');
  }
}

function encodeBase64(bytes: Uint8Array, codes: Uint8Array, pad: boolean): string {
  const tail = bytes.length % 3;
  const whole = bytes.length - tail;
  const out = new Uint8Array((whole / 3) * 4 + (tail === 0 ? 0 : pad ? 4 : tail + 1));
  let o = 0;
  for (let i = 0; i < whole; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = codes[n >>> 18];
    out[o++] = codes[(n >>> 12) & 63];
    out[o++] = codes[(n >>> 6) & 63];
    out[o++] = codes[n & 63];
  }
  if (tail > 0) {
    const n = (bytes[whole] << 16) | (tail === 2 ? bytes[whole + 1] << 8 : 0);
    out[o++] = codes[n >>> 18];
    out[o++] = codes[(n >>> 12) & 63];
    if (tail === 2) out[o++] = codes[(n >>> 6) & 63];
    if (pad) out.fill(PAD, o);
  }
  return decoder.decode(out);
}

/**
 * Strict decoding: no whitespace, no characters of the other alphabet, the
 * padding exactly as the variant demands, and no stray bits in the last
 * character, so every byte string has one text form.
 */
function decodeBase64(text: string, values: Int8Array, padded: boolean, what: string): Bytes {
  if (typeof text !== 'string') throw malformed(what);
  let length = text.length;
  if (padded) {
    if (length % 4 !== 0) throw malformed(what);
    if (length > 0 && text.charCodeAt(length - 1) === PAD) length -= text.charCodeAt(length - 2) === PAD ? 2 : 1;
  }
  const tail = length % 4;
  if (tail === 1) throw malformed(what);
  const whole = length - tail;
  const out = new Uint8Array((whole / 4) * 3 + (tail === 0 ? 0 : tail - 1));
  const at = (index: number): number => {
    const code = text.charCodeAt(index);
    return code < 128 ? values[code] : -1;
  };
  // Invalid characters are -1; OR-ing every value keeps the loop free of
  // branches and one sign test at the end catches them all.
  let invalid = 0;
  let o = 0;
  for (let i = 0; i < whole; i += 4) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    const d = at(i + 3);
    invalid |= a | b | c | d;
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = (b << 4) | (c >> 2);
    out[o++] = (c << 6) | d;
  }
  if (tail > 0) {
    const a = at(whole);
    const b = at(whole + 1);
    const c = tail === 3 ? at(whole + 2) : 0;
    invalid |= a | b | c;
    out[o++] = (a << 2) | (b >> 4);
    if (tail === 3) out[o++] = (b << 4) | (c >> 2);
    if ((tail === 2 ? b & 15 : c & 3) !== 0) invalid = -1;
  }
  if (invalid < 0) throw malformed(what);
  return out;
}

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes, STANDARD_CODES, true);
}

export function fromBase64(text: string): Bytes {
  return decodeBase64(text, STANDARD_VALUES, true, 'base64');
}

/** URL-safe base64 without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes, URL_SAFE_CODES, false);
}

export function fromBase64Url(text: string): Bytes {
  return decodeBase64(text, URL_SAFE_VALUES, false, 'base64url');
}

/** Lower-case hexadecimal. */
export function toHex(bytes: Uint8Array): string {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = HEX_CODES[bytes[i] >>> 4];
    out[2 * i + 1] = HEX_CODES[bytes[i] & 15];
  }
  return decoder.decode(out);
}

/** Accepts both cases; anything else, or an odd length, is an error. */
export function fromHex(text: string): Bytes {
  if (typeof text !== 'string' || text.length % 2 !== 0) throw malformed('hex');
  const out = new Uint8Array(text.length / 2);
  let invalid = 0;
  for (let i = 0; i < out.length; i++) {
    const hi = text.charCodeAt(2 * i);
    const lo = text.charCodeAt(2 * i + 1);
    const a = hi < 128 ? HEX_VALUES[hi] : -1;
    const b = lo < 128 ? HEX_VALUES[lo] : -1;
    invalid |= a | b;
    out[i] = (a << 4) | b;
  }
  if (invalid < 0) throw malformed('hex');
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Overwrites key material that is no longer needed. Skips buffers that were never filled. */
export function wipe(...buffers: (Uint8Array | undefined)[]): void {
  for (const buffer of buffers) buffer?.fill(0);
}
