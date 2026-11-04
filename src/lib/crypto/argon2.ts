// The Argon2id call, in a module of its own so that the worker and the inline
// fallback share it and the main bundle does not carry the WebAssembly: it is
// only ever imported by the worker or through a dynamic import.
import { argon2id } from 'hash-wasm';
import type { Bytes } from './encoding';

/**
 * Pinned by the `C1` prefix of the Secret Key and never read from the server,
 * which therefore cannot talk a client into weaker settings. Memory is in KiB.
 */
export const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 } as const;

export interface Argon2Request {
  password: Uint8Array;
  salt: Uint8Array;
}

/** `hash` is missing when the derivation failed; the reason stays in the worker. */
export interface Argon2Reply {
  hash?: Bytes;
}

export async function argon2idRaw(password: Uint8Array, salt: Uint8Array): Promise<Bytes> {
  const hash = await argon2id({ password, salt, ...ARGON2, outputType: 'binary' });
  return hash as Bytes;
}
