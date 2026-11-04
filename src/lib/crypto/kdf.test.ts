import { createHash, createHmac } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Argon2Reply, Argon2Request } from './argon2';
import { fromHex, toHex } from './encoding';
import { CryptoError } from './errors';
import { deriveLogin, deriveRecovery, type LoginKeys } from './kdf';
import { hkdf } from './primitives';
import { formatRecoveryKey, formatSecretKey } from './secrets';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'C10123456789ABCDEFGHJKMNPQRS';
const RECOVERY = 'R10123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJK';

/** RFC 5869 written out with HMAC, as a second implementation to compare with. */
function hkdfReference(ikm: Uint8Array, info: string | Uint8Array, length: number, salt: Uint8Array = new Uint8Array(0)): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let counter = 1; blocks.length * 32 < length; counter++) {
    previous = createHmac('sha256', prk).update(previous).update(info).update(Uint8Array.of(counter)).digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

/** The login derivation spelled out step by step, with the parameters written as numbers. */
async function loginReference(password: string, secretKey: string): Promise<{ authKey: string; kek: string; kekId: string }> {
  const sk = Buffer.from(secretKey, 'ascii');
  const pwKey = await argon2id({
    password: Buffer.from(password.normalize('NFKC'), 'utf8'),
    salt: hkdfReference(sk, 'cal/v1/kdf-salt', 16),
    memorySize: 65536,
    iterations: 3,
    parallelism: 1,
    hashLength: 32,
    outputType: 'binary',
  });
  const root = hkdfReference(Buffer.concat([pwKey, sk]), 'cal/v1/root', 32);
  const kek = hkdfReference(root, 'cal/v1/kek', 32);
  return {
    authKey: hkdfReference(root, 'cal/v1/auth', 32).toString('base64url'),
    kek: kek.toString('hex'),
    kekId: hkdfReference(kek, 'cal/v1/kek-id', 8).toString('hex'),
  };
}

async function expectFormatError(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CryptoError);
  expect((error as CryptoError).code).toBe('format');
}

describe('primitives', () => {
  it('HKDF matches RFC 5869, test case 1', async () => {
    const okm = await hkdf(fromHex('0b'.repeat(22)), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42, fromHex('000102030405060708090a0b0c'));
    expect(toHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('HKDF without a salt matches RFC 5869, test case 3', async () => {
    const okm = await hkdf(fromHex('0b'.repeat(22)), new Uint8Array(0), 42);
    expect(toHex(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });

  it('HKDF agrees with the HMAC construction for the lengths the protocol uses', async () => {
    const ikm = fromHex('00112233445566778899aabbccddeeff'.repeat(2));
    const salt = fromHex('a5'.repeat(32));
    for (const length of [8, 16, 32, 76]) {
      expect(toHex(await hkdf(ikm, 'cal/v1/test', length))).toBe(hkdfReference(ikm, 'cal/v1/test', length).toString('hex'));
      expect(toHex(await hkdf(ikm, 'cal/v1/test', length, salt))).toBe(hkdfReference(ikm, 'cal/v1/test', length, salt).toString('hex'));
    }
  });

  it('Argon2id matches the vectors of the reference implementation', { timeout: 30_000 }, async () => {
    // From the test suite of the reference C implementation (version 0x13).
    const options = { password: 'password', salt: 'somesalt', iterations: 2, parallelism: 1, hashLength: 32, outputType: 'hex' } as const;
    expect(await argon2id({ ...options, memorySize: 256 })).toBe('9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe');
    expect(await argon2id({ ...options, memorySize: 65536 })).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });
});

describe('deriveLogin', { timeout: 60_000 }, () => {
  let keys: LoginKeys;

  beforeAll(async () => {
    keys = await deriveLogin(PASSWORD, SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the three values in their documented shapes', () => {
    expect(keys.authKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys.kek).toBeInstanceOf(Uint8Array);
    expect(keys.kek).toHaveLength(32);
    expect(keys.kekId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('follows the derivation of the protocol, with the pinned Argon2id parameters', async () => {
    const reference = await loginReference(PASSWORD, SECRET);
    expect({ authKey: keys.authKey, kek: toHex(keys.kek), kekId: keys.kekId }).toEqual(reference);
  });

  it('is deterministic and accepts the Secret Key as people type it', async () => {
    const again = await deriveLogin(PASSWORD, formatSecretKey(SECRET).toLowerCase());
    expect(again.authKey).toBe(keys.authKey);
    expect(again.kekId).toBe(keys.kekId);
    expect(toHex(again.kek)).toBe(toHex(keys.kek));
  });

  it('normalises the password to NFKC', async () => {
    // A ligature and a composed letter against their plain spellings.
    const composed = await deriveLogin('ﬁn café', SECRET);
    const plain = await deriveLogin('fin café', SECRET);
    expect(composed.authKey).toBe(plain.authKey);
    expect(toHex(composed.kek)).toBe(toHex(plain.kek));
    expect(composed).toMatchObject({ authKey: (await loginReference('fin café', SECRET)).authKey });
  });

  it('changes everything when the password or the Secret Key changes', async () => {
    const otherPassword = await deriveLogin(PASSWORD + ' ', SECRET);
    const otherSecret = await deriveLogin(PASSWORD, SECRET.slice(0, -1) + 'T');
    for (const other of [otherPassword, otherSecret]) {
      expect(other.authKey).not.toBe(keys.authKey);
      expect(other.kekId).not.toBe(keys.kekId);
      expect(toHex(other.kek)).not.toBe(toHex(keys.kek));
    }
    expect(otherPassword.authKey).not.toBe(otherSecret.authKey);
  });

  it('keeps the server password apart from the key that wraps the account key', () => {
    const auth = Buffer.from(keys.authKey, 'base64url');
    expect(auth).toHaveLength(32);
    expect(auth.equals(Buffer.from(keys.kek))).toBe(false);
    expect(keys.kekId).not.toBe(toHex(keys.kek.subarray(0, 8)));
  });

  it('rejects a malformed Secret Key and a missing password before doing any work', async () => {
    await expectFormatError(deriveLogin(PASSWORD, ''));
    await expectFormatError(deriveLogin(PASSWORD, SECRET.slice(0, -1)));
    await expectFormatError(deriveLogin(PASSWORD, SECRET.replace('C1', 'C2')));
    await expectFormatError(deriveLogin(PASSWORD, SECRET.slice(0, -1) + 'U'));
    await expectFormatError(deriveLogin(PASSWORD, RECOVERY));
    await expectFormatError(deriveLogin('', SECRET));
    await expectFormatError(deriveLogin(undefined as unknown as string, SECRET));
  });

  it('never puts a secret into an error message', async () => {
    const secret = SECRET.slice(0, -1) + 'U';
    const error = await deriveLogin('hunter2-hunter2', secret).catch((err: Error) => err);
    expect(String((error as Error).message)).not.toContain('hunter2');
    expect(String((error as Error).message)).not.toContain(secret.slice(2));
  });

  describe('with a Worker', () => {
    type Mode = 'run' | 'throw' | 'error' | 'empty';
    let mode: Mode = 'run';
    let workers: FakeWorker[] = [];
    let current: FakeWorker | undefined;

    // What the worker script sees as `self`. The script is a module and runs
    // once, so every fake worker shares this scope.
    const scope = {
      onmessage: null as ((event: { data: Argon2Request }) => void) | null,
      postMessage(message: Argon2Reply, transfer: Transferable[] = []) {
        const target = current;
        const copy = structuredClone(message, { transfer });
        setTimeout(() => target?.deliver(copy), 0);
      },
    };

    class FakeWorker {
      onmessage: ((event: { data: Argon2Reply }) => void) | null = null;
      onerror: ((event: { preventDefault: () => void }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      received: Argon2Request | undefined;
      prevented = vi.fn();

      constructor(
        readonly url: URL,
        readonly options: WorkerOptions,
      ) {
        if (mode === 'throw') throw new Error('Workers are not allowed here');
        workers.push(this);
      }

      postMessage(message: Argon2Request): void {
        // A real worker gets a copy; the page keeps its own buffers.
        this.received = structuredClone(message);
        current = this;
        if (mode === 'error') setTimeout(() => this.onerror?.({ preventDefault: this.prevented }), 0);
        else if (mode === 'empty') setTimeout(() => this.deliver({}), 0);
        else void import('./kdf.worker').then(() => scope.onmessage?.({ data: this.received! }));
      }

      deliver(message: Argon2Reply): void {
        if (!this.terminated) this.onmessage?.({ data: message });
      }

      terminate(): void {
        this.terminated = true;
      }
    }

    function install(next: Mode): void {
      mode = next;
      workers = [];
      vi.stubGlobal('self', scope);
      vi.stubGlobal('Worker', FakeWorker);
    }

    it('runs Argon2 in a module worker and ends it afterwards', async () => {
      install('run');
      const result = await deriveLogin(PASSWORD, SECRET);
      expect(result.authKey).toBe(keys.authKey);
      expect(toHex(result.kek)).toBe(toHex(keys.kek));
      expect(workers).toHaveLength(1);
      expect(workers[0].url.href).toMatch(/\/kdf\.worker\.ts$/);
      expect(workers[0].options).toEqual({ type: 'module' });
      expect(workers[0].terminated).toBe(true);
      // The worker was handed the password and the salt, and cleared its copy of the password.
      expect(workers[0].received!.salt).toHaveLength(16);
      expect(workers[0].received!.password).toHaveLength(PASSWORD.length);
      expect(workers[0].received!.password.every((byte) => byte === 0)).toBe(true);
    });

    it('falls back to this thread when a worker cannot be created', async () => {
      install('throw');
      const result = await deriveLogin(PASSWORD, SECRET);
      expect(result.authKey).toBe(keys.authKey);
      expect(workers).toHaveLength(0);
    });

    it('falls back to this thread when the worker fails to load or crashes', async () => {
      install('error');
      const result = await deriveLogin(PASSWORD, SECRET);
      expect(result.authKey).toBe(keys.authKey);
      expect(workers[0].terminated).toBe(true);
      expect(workers[0].prevented).toHaveBeenCalled();
    });

    it('falls back to this thread when the worker reports a failure', async () => {
      install('empty');
      const result = await deriveLogin(PASSWORD, SECRET);
      expect(result.authKey).toBe(keys.authKey);
      expect(workers[0].terminated).toBe(true);
    });
  });

  it('reports a KdfError when Argon2 cannot run at all', async () => {
    vi.resetModules();
    vi.doMock('./argon2', () => ({ argon2idRaw: () => Promise.reject(new Error('WebAssembly is blocked')) }));
    try {
      const fresh = await import('./kdf');
      const errors = await import('./errors');
      const error = await fresh.deriveLogin(PASSWORD, SECRET).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(errors.KdfError);
      expect(error).not.toBeInstanceOf(errors.CryptoError);
    } finally {
      vi.doUnmock('./argon2');
      vi.resetModules();
    }
  });
});

describe('deriveRecovery', () => {
  it('follows the derivation of the protocol', async () => {
    const keys = await deriveRecovery(RECOVERY);
    const rk = Buffer.from(RECOVERY, 'ascii');
    const proof = hkdfReference(rk, 'cal/v1/recovery-proof', 32).toString('base64url');
    expect(keys.proof).toBe(proof);
    expect(keys.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys.verifier).toBe(createHash('sha256').update(proof, 'utf8').digest('hex'));
    expect(keys.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(toHex(keys.rkek)).toBe(hkdfReference(rk, 'cal/v1/rk', 32).toString('hex'));
    // The proof goes to the server, the wrapping key must not follow from it.
    expect(Buffer.from(keys.proof, 'base64url').equals(Buffer.from(keys.rkek))).toBe(false);
  });

  it('accepts the key as people type it and rejects what is not a Recovery Key', async () => {
    const keys = await deriveRecovery(RECOVERY);
    const typed = await deriveRecovery(formatRecoveryKey(RECOVERY).toLowerCase().replace(/-/g, ' '));
    expect(typed).toEqual(keys);
    await expectFormatError(deriveRecovery(''));
    await expectFormatError(deriveRecovery(RECOVERY.slice(0, -1)));
    await expectFormatError(deriveRecovery(SECRET));
    await expectFormatError(deriveRecovery(RECOVERY.replace('W', 'U')));
  });

  it('gives unrelated values for another key', async () => {
    const a = await deriveRecovery(RECOVERY);
    const b = await deriveRecovery(RECOVERY.slice(0, -1) + '0');
    expect(b.proof).not.toBe(a.proof);
    expect(b.verifier).not.toBe(a.verifier);
    expect(toHex(b.rkek)).not.toBe(toHex(a.rkek));
  });
});
