// From what a person knows to the keys of an account (protocol v1).
//
//   salt     = HKDF(SK, "cal/v1/kdf-salt", 16)
//   pwKey    = Argon2id(password, salt, 64 MiB, 3 passes, 1 lane, 32 bytes)
//   root     = HKDF(pwKey ‖ SK, "cal/v1/root", 32)
//   authKey  = base64url(HKDF(root, "cal/v1/auth", 32))    the password the server sees
//   KEK      = HKDF(root, "cal/v1/kek", 32)                wraps the account key
//   kekId    = hex(HKDF(KEK, "cal/v1/kek-id", 8))          names the key slot
//
//   RKEK     = HKDF(RK, "cal/v1/rk", 32)                   wraps the account key for recovery
//   proof    = base64url(HKDF(RK, "cal/v1/recovery-proof", 32))
//   verifier = hex(SHA-256(proof))                         the only part the server stores
//
// The server never sees the password, the Secret Key or the KEK: authKey and
// the KEK are separate branches of the root, so neither leads to the other.
import type { Argon2Reply, Argon2Request } from './argon2';
import { concat, toBase64Url, toHex, utf8, wipe, type Bytes } from './encoding';
import { CryptoError, KdfError } from './errors';
import { hkdf, hkdfKey, sha256 } from './primitives';
import { parseRecoveryKey, parseSecretKey } from './secrets';

const PW_KEY_LENGTH = 32;

export interface LoginKeys {
  /** 43 base64url characters. */
  authKey: string;
  /** 32 raw bytes; overwrite them once the account key is wrapped or unwrapped. */
  kek: Bytes;
  /** 16 hexadecimal characters. */
  kekId: string;
}

export interface RecoveryKeys {
  /** 32 raw bytes; overwrite them once the account key is wrapped or unwrapped. */
  rkek: Bytes;
  /** 43 base64url characters. */
  proof: string;
  /** 64 hexadecimal characters. */
  verifier: string;
}

function stretchInWorker(password: Uint8Array, salt: Uint8Array): Promise<Bytes> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });
    const fail = () => {
      worker.terminate();
      reject(new Error('The key derivation worker failed'));
    };
    worker.onmessage = (event: MessageEvent<Argon2Reply>) => {
      const hash = event.data?.hash;
      if (hash?.length !== PW_KEY_LENGTH) return fail();
      worker.terminate();
      resolve(hash);
    };
    worker.onerror = (event) => {
      // Handled here; without this the browser also reports it as uncaught.
      event.preventDefault();
      fail();
    };
    worker.onmessageerror = fail;
    // Copied, not transferred: the caller still needs the password bytes if
    // the worker fails, and overwrites its own copy afterwards.
    worker.postMessage({ password, salt } satisfies Argon2Request);
  });
}

async function stretch(password: Uint8Array, salt: Uint8Array): Promise<Bytes> {
  if (typeof Worker !== 'undefined') {
    try {
      return await stretchInWorker(password, salt);
    } catch {
      // The worker could not start or run (a policy that forbids workers, an
      // old WebView). The same work on this thread freezes the interface for
      // a moment but gives the same key.
    }
  }
  try {
    const { argon2idRaw } = await import('./argon2');
    return await argon2idRaw(password, salt);
  } catch (cause) {
    throw new KdfError('Key derivation could not run', { cause });
  }
}

/**
 * Derives what signing in needs from the password and the Secret Key. The
 * Secret Key may be in any form `parseSecretKey` accepts. Slow on purpose:
 * about a fifth of a second on a laptop, more on a phone, so show progress.
 * Throws `CryptoError('format')` for a malformed Secret Key or an empty
 * password and `KdfError` when Argon2 cannot run.
 */
export async function deriveLogin(password: string, secretKey: string): Promise<LoginKeys> {
  const canonical = parseSecretKey(secretKey);
  if (!canonical) throw new CryptoError('format', 'Malformed Secret Key');
  if (typeof password !== 'string') throw new CryptoError('format', 'Missing password');
  const pw = utf8(password.normalize('NFKC'));
  if (pw.length === 0) throw new CryptoError('format', 'Missing password');
  const sk = utf8(canonical);
  let salt: Bytes | undefined;
  let pwKey: Bytes | undefined;
  let ikm: Bytes | undefined;
  let root: Bytes | undefined;
  let auth: Bytes | undefined;
  try {
    salt = await hkdf(sk, 'cal/v1/kdf-salt', 16);
    pwKey = await stretch(pw, salt);
    ikm = concat(pwKey, sk);
    root = await hkdf(ikm, 'cal/v1/root', 32);
    const rootKey = await hkdfKey(root);
    auth = await hkdf(rootKey, 'cal/v1/auth', 32);
    const kek = await hkdf(rootKey, 'cal/v1/kek', 32);
    const kekId = toHex(await hkdf(kek, 'cal/v1/kek-id', 8));
    return { authKey: toBase64Url(auth), kek, kekId };
  } finally {
    wipe(pw, sk, salt, pwKey, ikm, root, auth);
  }
}

/**
 * Derives what recovery needs from the Recovery Key, in any form
 * `parseRecoveryKey` accepts. Fast: the key has 260 random bits, so there is
 * nothing to stretch. Throws `CryptoError('format')` for a malformed key.
 */
export async function deriveRecovery(recoveryKey: string): Promise<RecoveryKeys> {
  const canonical = parseRecoveryKey(recoveryKey);
  if (!canonical) throw new CryptoError('format', 'Malformed Recovery Key');
  const rk = utf8(canonical);
  let raw: Bytes | undefined;
  try {
    const base = await hkdfKey(rk);
    const rkek = await hkdf(base, 'cal/v1/rk', 32);
    raw = await hkdf(base, 'cal/v1/recovery-proof', 32);
    const proof = toBase64Url(raw);
    return { rkek, proof, verifier: toHex(await sha256(utf8(proof))) };
  } finally {
    wipe(rk, raw);
  }
}
