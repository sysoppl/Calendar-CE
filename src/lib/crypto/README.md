# `src/lib/crypto`: the hosted edition's end-to-end encryption

This folder is the client-side cryptography of [E2EE Calendar](https://calendar.patryk.pro), the hosted edition, published
so that anyone can check how it encrypts data. The Community Edition doesn't call it, so it isn't part of the app bundle.

- **Specification:** [`docs/ENCRYPTION.md`](../../../docs/ENCRYPTION.md)
- **Test vectors:** [`vectors.json`](vectors.json), checked by [`vectors.test.ts`](vectors.test.ts) against an independent
  implementation on Node's `crypto`
- **Run the tests:** `npx vitest run src/lib/crypto`

| File            | What it does                                                         |
| --------------- | -------------------------------------------------------------------- |
| `secrets.ts`    | Secret Key and Recovery Key: generate, parse, format                 |
| `kdf.ts`        | Argon2id + HKDF: password and Secret Key to sign-in secret and KEK    |
| `argon2.ts`, `kdf.worker.ts` | Argon2id (hash-wasm), off the main thread              |
| `keys.ts`       | Account key and the working keys cut from it, opaque row ids         |
| `envelope.ts`   | AES-256-GCM envelope with key commitment, context binding, padding   |
| `primitives.ts`, `encoding.ts` | HKDF, HMAC, SHA-256, constant-time compare; base64/hex/UTF-8 |

The protocol is shared with the hosted apps, so it can't change here on its own: a change to anything that alters the
bytes (and with it `vectors.json`) would no longer open existing data. Reports and reviews are very welcome; see
[SECURITY.md](../../../SECURITY.md).
