# End-to-end encryption in the hosted edition (protocol v1)

The [hosted edition](https://calendar.patryk.pro) of Calendar CE syncs your calendars through a cloud that stores
them **without being able to read them**. This document describes exactly how. The code that does it is published in
[`src/lib/crypto/`](../src/lib/crypto), with tests and fixed test vectors, so you can check every step yourself.

> The self-hosted edition in this repository doesn't use this code: it keeps your calendars on the device or on your own
> CalDAV server. The module is here for transparency. It contains only the client-side cryptography, no cloud client
> and no server code.

## Primitives

| Purpose                       | Algorithm                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| Password stretching           | Argon2id, 64 MiB, 3 passes, 1 lane, 32-byte output          |
| Key derivation                | HKDF-SHA-256 (empty salt unless stated)                      |
| Encryption                    | AES-256-GCM, 128-bit tag                                     |
| Deterministic ids             | HMAC-SHA-256                                                 |
| Randomness                    | `crypto.getRandomValues` (Web Crypto)                       |

Everything except Argon2id is the browser's built-in Web Crypto. Argon2id comes from
[`hash-wasm`](https://github.com/Daninet/hash-wasm) and runs in a Web Worker. All strings are UTF-8; `‖` means
concatenation.

## Secrets

| Secret            | Where it comes from                                    | Where it goes                                   |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **Password** `P`  | You choose it (NFKC-normalised)                        | Never leaves the device                         |
| **Secret Key** `SK` | Generated on the device at sign-up: `C1` + 26 Crockford base32 characters (130 random bits), shown as `C1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX` | Never sent. Kept on your devices and in your Recovery Kit |
| **Recovery Key** `RK` | Generated at sign-up: `R1` + 52 Crockford base32 characters (260 random bits) | Shown once, in the Recovery Kit. Never stored by the app |
| **Account key** `AMK` | 32 random bytes generated at sign-up             | Stored only *wrapped* (encrypted) with the keys below |

Parsing is forgiving: case, spaces and dashes are ignored, and `O` reads as `0`, `I`/`L` as `1`. The `C1` prefix pins
the KDF parameters, which are never read from the server, so a malicious server can't weaken them.

## From what you know to your keys

```
salt     = HKDF(SK, "cal/v1/kdf-salt", 16)
pwKey    = Argon2id(P, salt, 64 MiB, t = 3, p = 1, 32 bytes)
root     = HKDF(pwKey ‖ SK, "cal/v1/root", 32)

authKey  = base64url(HKDF(root, "cal/v1/auth", 32))     the sign-in secret the server sees
KEK      = HKDF(root, "cal/v1/kek", 32)                 wraps the account key
kekId    = hex(HKDF(KEK, "cal/v1/kek-id", 8))           names the wrap

RKEK     = HKDF(RK, "cal/v1/rk", 32)                    wraps the account key for recovery
proof    = base64url(HKDF(RK, "cal/v1/recovery-proof", 32))
verifier = hex(SHA-256(proof))                          the only trace of RK the server keeps
```

- The server never sees `P`, `SK` or the `KEK`. `authKey` and the `KEK` are separate HKDF branches of `root`, so
  knowing the sign-in secret tells nothing about the key that unwraps your data.
- Because `SK` is mixed in and never uploaded, someone who steals the server's database can't run a password-guessing
  attack, however weak the password: they would also have to guess 130 random bits.

## Working keys

```
K_data = HKDF(AMK, "cal/v1/data", 32)        calendars, events, tasks, settings
K_rem  = HKDF(AMK, "cal/v1/reminders", 32)   reminder digests
K_ids  = HKDF(AMK, "cal/v1/ids", 32)         HMAC key for row ids
```

The account key exists as bytes only while it's being wrapped or unwrapped. The app keeps the working keys as
non-extractable `CryptoKey`s: a script in the page could use them while it runs, but couldn't read them out.

The account key is stored on the server only in wrapped form, as envelopes of kind 4 (below): under the `KEK` (your
password + Secret Key) and under the `RKEK` (your Recovery Key). Changing the password or the Recovery Key re-wraps the same
account key.

## The envelope (every encrypted value)

```
header   = [version 1][suite 1][kind][padding scheme 1][key generation u32 BE = 0]     8 bytes
rowSalt  = 32 random bytes, fresh for every encryption
AAD      = F("CAL1") ‖ F(header) ‖ F(project) ‖ F(scope) ‖ F(id) ‖ F(owner)
           F(x) = byte length of x as u16 BE ‖ x
okm      = HKDF(key, salt = rowSalt, info = "cal/v1/row" ‖ SHA-256(AAD), 76)
           encKey = okm[0..32]   commit = okm[32..64]   nonce = okm[64..76]
padded   = u32 BE length(plaintext) ‖ plaintext ‖ zero bytes
body     = AES-256-GCM(encKey, nonce, padded, AAD)      tag appended
envelope = base64(header ‖ rowSalt ‖ commit ‖ body)
```

Why it's built this way:

- **A fresh key and nonce for every value.** The random `rowSalt` derives a new AES key and nonce each time, so
  nonce reuse and per-key usage limits never come into play.
- **Key commitment.** AES-GCM alone doesn't commit to its key (a ciphertext can be crafted to open under two keys).
  The stored `commit` value closes that gap and is compared in constant time before decryption.
- **Context binding.** Where a value lives (project, table, row, owner) and what it is (`kind`) go into both the key
  derivation and the AAD. The server can't move a ciphertext to another row, table or account and have it open there.
- **Size hiding.** Plaintexts are padded to multiples of 512 bytes up to 8 KiB, then with
  [Padmé](https://lbarman.ch/blog/padme/) (at most ~12% overhead). Opening checks that every padding byte is zero.

| `kind` | Value              | Key      |
| :----: | ------------------ | -------- |
| 1      | event or task (iCalendar text) | `K_data` |
| 2      | calendar (name, colour, order, …) | `K_data` |
| 3      | settings           | `K_data` |
| 4      | wrapped account key | `KEK` or `RKEK` |
| 5      | reminder list for Android | `K_rem` |

## Row ids

Events and settings rows get **deterministic, opaque ids**: `hex(HMAC-SHA-256(K_ids, label))[0..32]`, with labels such as
`"obj\n" + calendarRowId + "\n" + uid` for an event. The server sees ids it can't link back to an event's UID, and
importing the same file twice doesn't create duplicates. Calendars get random ids.

## What the service can and can't see

| Encrypted on your device | Visible to the service |
| ------------------------ | ---------------------- |
| Calendar names, colours, descriptions, order | Your e-mail address (and name, if you give one) |
| Every event and task in full: title, times, repeat rules, place, notes, guests, reminders | How many calendars and items you have, which item belongs to which calendar |
| All settings, holiday calendars, subscription addresses | Approximate sizes (after padding) |
| Your profile picture, reminder digests | When items are created, changed and deleted; your signed-in devices |

The service *can* refuse service, delete data, or hand back an older copy of an item. It *can't* read your data, or
change an item, move it or slip it into another account without your devices rejecting it.

## Known limits

- **The web app's code comes from the server.** In a browser, the app is loaded from calendar.patryk.pro at each start;
  whoever controls that server could serve code that leaks keys. A strict Content-Security-Policy blocks injected
  scripts, not a changed app. The [Android app](https://play.google.com/store/apps/details?id=pro.patryk.calendar)
  ships its code inside the signed APK and doesn't have this weakness.
- **The account key isn't rotated.** A new password or Recovery Key stops the old one from working with the service,
  but someone who already holds an old secret *and* a copy of your encrypted data from before the change can still
  open that copy.
- **Lose the password and the Recovery Kit, lose the data.** Nobody can recover it, including the service.

## Check it yourself

```sh
npm ci
npx vitest run src/lib/crypto
```

[`vectors.json`](../src/lib/crypto/vectors.json) holds fixed inputs (password, Secret Key, Recovery Key, account key,
`rowSalt`, context) and the exact expected outputs: derived keys, AAD, padded lengths and envelopes, plus malformed
envelopes that must be rejected. [`vectors.test.ts`](../src/lib/crypto/vectors.test.ts) checks the module against
them and against an independent reference implementation written with Node's own `crypto`.

Found a weakness? Please report it privately, as described in [SECURITY.md](../SECURITY.md).
