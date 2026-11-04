// The WebCrypto calls the rest of the module is built from.
import { utf8, type Bytes } from './encoding';

// RFC 5869 defines a missing salt as HashLen zero bytes. Passing them
// explicitly gives the same output and avoids engines that dislike an empty
// salt.
const NO_SALT = new Uint8Array(32);

/** Key material as a non-extractable HKDF base key. */
export function hkdfKey(ikm: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
}

/** HKDF-SHA-256. `length` is in bytes; `info` given as text is encoded as UTF-8. */
export async function hkdf(ikm: CryptoKey | Uint8Array, info: string | Uint8Array, length: number, salt: Uint8Array = NO_SALT): Promise<Bytes> {
  const key = ArrayBuffer.isView(ikm) ? await hkdfKey(ikm) : ikm;
  const params = { name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: (typeof info === 'string' ? utf8(info) : info) as Bytes };
  return new Uint8Array(await crypto.subtle.deriveBits(params, key, length * 8));
}

export async function sha256(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as Bytes));
}

/** Key material as a non-extractable HMAC-SHA-256 signing key. */
export function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as Bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmac(key: CryptoKey, data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as Bytes));
}

/** `getRandomValues` fills at most 65 536 bytes per call; every size used here is far below. */
export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Comparison whose duration does not depend on where the inputs differ: every
 * byte is visited and the differences are accumulated, with no early exit.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
