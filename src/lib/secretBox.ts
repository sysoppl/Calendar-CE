// Keeps small secrets (CalDAV passwords) out of localStorage in clear. They
// are encrypted with an AES-GCM key that lives in IndexedDB and cannot be
// exported, so a copy of localStorage alone gives nothing away, and script
// that can read storage still cannot take the key with it.
//
// Every function answers `null` instead of throwing when the browser cannot
// do this (no IndexedDB, no WebCrypto, storage blocked): the caller then
// keeps the secret the way it did before.
import { createStore, get, update, type UseStore } from 'idb-keyval';

const VERSION = 'v1';
const KEY_NAME = 'box';

let store: UseStore | undefined;
let cached: CryptoKey | undefined;

function supported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

/** The wrapping key; made on first use when `create` is set. */
async function boxKey(create: boolean): Promise<CryptoKey | null> {
  if (cached) return cached;
  if (!supported()) return null;
  try {
    // Its own database: idb-keyval cannot add a store to one that exists.
    store ??= createStore('calendar-secrets', 'keys');
    let key = await get<CryptoKey>(KEY_NAME, store);
    if (!key && create) {
      const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // Another tab may be doing the same right now. The first key written
      // stays, and everyone reads back that one.
      await update<CryptoKey>(KEY_NAME, (current) => current ?? fresh, store);
      key = await get<CryptoKey>(KEY_NAME, store);
    }
    if (key) cached = key;
    return key ?? null;
  } catch (err) {
    // A database that failed to open stays failed; the next call tries afresh.
    store = undefined;
    throw err;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * Encrypts `value`. `label` says what the secret belongs to (an account id);
 * it is bound into the result, which then opens only with the same label.
 */
export async function sealSecret(value: string, label: string): Promise<string | null> {
  try {
    const key = await boxKey(true);
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(label) }, key, encode(value));
    const boxed = `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
    // The caller is about to forget the plain value, so be sure it comes back.
    return (await openSecret(boxed, label)) === value ? boxed : null;
  } catch {
    return null;
  }
}

/** The secret, or `null` when it cannot be read (now, or ever again if the key is gone). */
export async function openSecret(boxed: string, label: string): Promise<string | null> {
  const read = await readSecret(boxed, label);
  return 'value' in read ? read.value : null;
}

/**
 * Why a secret could not be read: `unavailable` when the key's storage could
 * not be opened this time (it may well open next time), `lost` when the key
 * is gone or the box does not open with it.
 */
export type SecretFailure = 'unavailable' | 'lost';

/** `openSecret`, telling a passing failure from a lasting one. */
export async function readSecret(boxed: string, label: string): Promise<{ value: string } | { failure: SecretFailure }> {
  const [version, iv, sealed, ...rest] = String(boxed).split('.');
  if (version !== VERSION || !iv || !sealed || rest.length) return { failure: 'lost' };
  let key: CryptoKey | null;
  try {
    // Without IndexedDB or WebCrypto now, although they were there to seal it.
    if (!supported()) return { failure: 'unavailable' };
    key = await boxKey(false);
  } catch {
    return { failure: 'unavailable' };
  }
  if (!key) return { failure: 'lost' };
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: encode(label) }, key, fromBase64(sealed));
    return { value: new TextDecoder('utf-8', { fatal: true }).decode(plain) };
  } catch {
    return { failure: 'lost' };
  }
}
