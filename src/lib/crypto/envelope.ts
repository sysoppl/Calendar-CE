// The envelope every encrypted value travels in (protocol v1). The layout is
// fixed byte for byte: the hosted edition's Android app opens the same
// envelopes in Java, and both sides are tested against vectors.json.
//
//   header   [version 1][suite 1][kind][padding scheme 1][key generation, u32 BE, 0]    8 bytes
//   rowSalt  random, fresh for every encryption                                         32 bytes
//   commit                                                                              32 bytes
//   body     AES-256-GCM over the padded plaintext, with the 16-byte tag appended
//
//   AAD      F("CAL1") ‖ F(header) ‖ F(projectId) ‖ F(scope) ‖ F(id) ‖ F(ownerId),
//            F(x) = byte length as u16 BE ‖ x
//   okm      HKDF(key, salt = rowSalt, info = "cal/v1/row" ‖ SHA-256(AAD), 76 bytes)
//            = encKey (32) ‖ commit (32) ‖ nonce (12)
//   padded   byte length of the plaintext as u32 BE ‖ plaintext ‖ zeros
//
// Why it is built this way:
// - A fresh salt gives every encryption its own key and nonce, so the limits
//   on how much one AES-GCM key may encrypt never come into play.
// - AES-GCM alone does not commit to its key: a ciphertext can be made to
//   open under two keys. The stored `commit` closes that gap.
// - Where a value belongs (project, table, row, owner) and what it is (kind)
//   go into both the key derivation and the AAD, so the server cannot move a
//   ciphertext to another row, table or user and have it open there.
// - Padding hides the exact size: steps of 512 bytes up to 8 KiB, then Padmé,
//   which never adds more than about 12%.
import { concat, fromBase64, fromUtf8, toBase64, utf8, wipe, type Bytes } from './encoding';
import { CryptoError } from './errors';
import { equalBytes, hkdf, hkdfKey, randomBytes, sha256 } from './primitives';

export { CryptoError } from './errors';
export type { CryptoErrorCode } from './errors';

export type Kind = 1 | 2 | 3 | 4 | 5;

/** Names for the kinds, so call sites do not carry bare numbers. */
export const KIND = { object: 1, calendar: 2, settings: 3, keyWrap: 4, reminderDigest: 5 } as const satisfies Record<string, Kind>;

/** Where a value lives. Every field is bound into the ciphertext. */
export interface Context {
  /** The name of the service's project, a fixed string (`calendar` in the vectors). */
  projectId: string;
  /** The collection the value is stored in. */
  scope: string;
  /** The value's id in that collection; for a key wrap, its slot (password or Recovery Key). */
  id: string;
  /** The id of the account that owns the value. */
  ownerId: string;
}

const VERSION = 1;
const SUITE = 1;
const PADDING = 1;

const KEY_LENGTH = 32;
const HEADER_LENGTH = 8;
const SALT_LENGTH = 32;
const COMMIT_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_OFFSET = HEADER_LENGTH;
const COMMIT_OFFSET = SALT_OFFSET + SALT_LENGTH;
const BODY_OFFSET = COMMIT_OFFSET + COMMIT_LENGTH;
const PREFIX_LENGTH = 4;
const BLOCK = 512;
const BLOCK_LIMIT = 8192;

const MAGIC = utf8('CAL1');
const ROW_INFO = utf8('cal/v1/row');
const CONTEXT_FIELDS = ['projectId', 'scope', 'id', 'ownerId'] as const;

/**
 * The largest plaintext `seal` takes. It is far above what a column can hold;
 * its purpose is to keep the length arithmetic inside 32 bits.
 */
export const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;

/** Padded size of `length` bytes, the length prefix included. */
function padTo(length: number): number {
  if (length <= BLOCK_LIMIT) return Math.ceil(length / BLOCK) * BLOCK;
  // Padmé: keep only the top bits of the length, rounding up.
  const e = 31 - Math.clz32(length);
  const s = 32 - Math.clz32(e);
  const mask = (1 << (e - s)) - 1;
  return (length + mask) & ~mask;
}

/** Size in bytes of the padded plaintext inside an envelope, for a plaintext of the given size. */
export function paddedLength(plaintextBytes: number): number {
  return padTo(PREFIX_LENGTH + plaintextBytes);
}

/** Length of the text `seal` returns for a plaintext of the given size, to check against a column limit. */
export function sealedLength(plaintextBytes: number): number {
  return Math.ceil((BODY_OFFSET + paddedLength(plaintextBytes) + TAG_LENGTH) / 3) * 4;
}

function checkKind(kind: Kind): void {
  if (!Number.isInteger(kind) || kind < 1 || kind > 5) throw new CryptoError('format', 'Unknown kind of value');
}

function field(bytes: Uint8Array): Bytes {
  if (bytes.length > 0xffff) throw new CryptoError('format', 'A context field is too long');
  const out = new Uint8Array(2 + bytes.length);
  out[0] = bytes.length >>> 8;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function associatedData(header: Uint8Array, ctx: Context): Bytes {
  const parts = [field(MAGIC), field(header)];
  for (const name of CONTEXT_FIELDS) {
    const value = ctx?.[name];
    // An empty field is always a caller's mistake (an id that was not loaded
    // yet), and sealing with it would bind the value to no place at all.
    if (typeof value !== 'string' || value === '') throw new CryptoError('format', `Context field ${name} is missing`);
    parts.push(field(utf8(value)));
  }
  return concat(...parts);
}

async function baseKey(key: CryptoKey | Uint8Array): Promise<CryptoKey> {
  if (ArrayBuffer.isView(key)) {
    if (key.byteLength !== KEY_LENGTH) throw new CryptoError('format', 'A raw key must be 32 bytes');
    return hkdfKey(key);
  }
  if (key?.algorithm?.name !== 'HKDF' || !key.usages.includes('deriveBits')) throw new CryptoError('format', 'The key cannot derive row keys');
  return key;
}

interface RowKeys {
  key: CryptoKey;
  commit: Bytes;
  nonce: Bytes;
}

async function rowKeys(key: CryptoKey | Uint8Array, rowSalt: Uint8Array, aad: Uint8Array): Promise<RowKeys> {
  const info = concat(ROW_INFO, await sha256(aad));
  const okm = await hkdf(await baseKey(key), info, KEY_LENGTH + COMMIT_LENGTH + NONCE_LENGTH, rowSalt);
  try {
    return {
      key: await crypto.subtle.importKey('raw', okm.subarray(0, KEY_LENGTH), 'AES-GCM', false, ['encrypt', 'decrypt']),
      commit: okm.slice(KEY_LENGTH, KEY_LENGTH + COMMIT_LENGTH),
      nonce: okm.slice(KEY_LENGTH + COMMIT_LENGTH),
    };
  } finally {
    wipe(okm);
  }
}

/**
 * `seal` with the salt given instead of drawn. For test vectors only: a salt
 * used twice under one key and context repeats the key and the nonce.
 */
export async function sealWithSalt(key: CryptoKey | Uint8Array, kind: Kind, ctx: Context, plaintext: Uint8Array, rowSalt: Uint8Array): Promise<string> {
  checkKind(kind);
  if (!ArrayBuffer.isView(plaintext)) throw new CryptoError('format', 'The plaintext must be bytes');
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new CryptoError('format', 'The plaintext is too large');
  if (rowSalt.length !== SALT_LENGTH) throw new CryptoError('format', 'The row salt must be 32 bytes');
  // Whatever kind of view was passed, what gets sealed is its bytes.
  const bytes = new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const header = Uint8Array.of(VERSION, SUITE, kind, PADDING, 0, 0, 0, 0);
  const aad = associatedData(header, ctx);
  const row = await rowKeys(key, rowSalt, aad);
  const padded = new Uint8Array(paddedLength(bytes.length));
  new DataView(padded.buffer).setUint32(0, bytes.length);
  padded.set(bytes, PREFIX_LENGTH);
  try {
    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: row.nonce, additionalData: aad, tagLength: TAG_LENGTH * 8 }, row.key, padded);
    return toBase64(concat(header, rowSalt, row.commit, new Uint8Array(body)));
  } finally {
    wipe(padded);
  }
}

/**
 * Encrypts `plaintext` for one place. `key` is one of the account's working
 * keys, or 32 raw bytes (a KEK or RKEK wrapping the account key). Returns
 * standard base64.
 */
export function seal(key: CryptoKey | Uint8Array, kind: Kind, ctx: Context, plaintext: Uint8Array): Promise<string> {
  return sealWithSalt(key, kind, ctx, plaintext, randomBytes(SALT_LENGTH));
}

/**
 * Opens an envelope, which must be of this `kind` and sealed for this exact
 * context. Throws `CryptoError`; the result is a fresh buffer the caller owns.
 */
export async function open(key: CryptoKey | Uint8Array, kind: Kind, ctx: Context, text: string): Promise<Bytes> {
  checkKind(kind);
  const envelope = fromBase64(text);
  if (envelope.length < HEADER_LENGTH) throw new CryptoError('format', 'The envelope is truncated');
  // The scheme is checked before anything else, so that a value written by a
  // newer app is reported as such and not as damaged.
  if (envelope[0] !== VERSION) throw new CryptoError('version', 'Unknown envelope version');
  if (envelope[1] !== SUITE) throw new CryptoError('version', 'Unknown cipher suite');
  if (envelope[3] !== PADDING) throw new CryptoError('version', 'Unknown padding scheme');
  if ((envelope[4] | envelope[5] | envelope[6] | envelope[7]) !== 0) throw new CryptoError('version', 'Unknown key generation');
  const paddedSize = envelope.length - BODY_OFFSET - TAG_LENGTH;
  if (paddedSize < BLOCK || padTo(paddedSize) !== paddedSize) throw new CryptoError('format', 'The envelope is truncated or has an impossible length');
  if (envelope[2] !== kind) throw new CryptoError('auth', 'The envelope holds another kind of value');

  const aad = associatedData(envelope.subarray(0, HEADER_LENGTH), ctx);
  const row = await rowKeys(key, envelope.subarray(SALT_OFFSET, COMMIT_OFFSET), aad);
  if (!equalBytes(row.commit, envelope.subarray(COMMIT_OFFSET, BODY_OFFSET))) {
    throw new CryptoError('auth', 'Wrong key or wrong place for this envelope');
  }
  let padded: Bytes;
  try {
    const params = { name: 'AES-GCM', iv: row.nonce, additionalData: aad, tagLength: TAG_LENGTH * 8 };
    padded = new Uint8Array(await crypto.subtle.decrypt(params, row.key, envelope.subarray(BODY_OFFSET)));
  } catch {
    throw new CryptoError('auth', 'The envelope failed authentication');
  }
  try {
    const length = new DataView(padded.buffer).getUint32(0);
    // The padded size must be exactly what this length pads to, which also
    // covers a prefix that points past the end.
    if (length > padded.length - PREFIX_LENGTH || padTo(PREFIX_LENGTH + length) !== padded.length) {
      throw new CryptoError('format', 'Wrong length prefix');
    }
    let rest = 0;
    for (let i = PREFIX_LENGTH + length; i < padded.length; i++) rest |= padded[i];
    if (rest !== 0) throw new CryptoError('format', 'Non-zero padding');
    return padded.slice(PREFIX_LENGTH, PREFIX_LENGTH + length);
  } finally {
    wipe(padded);
  }
}

/** `seal` for a value stored as JSON. */
export async function sealJson(key: CryptoKey | Uint8Array, kind: Kind, ctx: Context, value: unknown): Promise<string> {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new CryptoError('format', 'The value has no JSON form');
  const bytes = utf8(json);
  try {
    return await seal(key, kind, ctx, bytes);
  } finally {
    wipe(bytes);
  }
}

/** `open` for a value stored as JSON. The shape of the result is the caller's to check. */
export async function openJson<T = unknown>(key: CryptoKey | Uint8Array, kind: Kind, ctx: Context, text: string): Promise<T> {
  const bytes = await open(key, kind, ctx, text);
  try {
    return JSON.parse(fromUtf8(bytes)) as T;
  } catch {
    throw new CryptoError('format', 'The value is not JSON');
  } finally {
    wipe(bytes);
  }
}
