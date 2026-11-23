# End-to-end encryption in the hosted edition (protocol v1)

The [hosted edition](https://calendar.patryk.pro) of Calendar CE syncs your calendars through a cloud that stores
them **without being able to read them**. This document describes exactly how. The code that does it is published in
[`src/lib/crypto/`](../src/lib/crypto), with tests and fixed test vectors, so you can check every step yourself.

Since 1.16 the hosted edition can also share a cloud calendar or task list between accounts, to view or to edit. The
chapter [Sharing a calendar](#sharing-a-calendar) covers how the keys travel from one account to another.

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
| Key encapsulation (sharing)   | X-Wing: X25519 + ML-KEM-768, a hybrid KEM                    |
| Signatures (sharing)          | Ed25519, checked strictly (RFC 8032, no ZIP 215 leniency)    |
| Safety number (sharing)       | SHA-512, 5200 rounds per person                              |

Everything in the first five rows except Argon2id is the browser's built-in Web Crypto. Argon2id comes from
[`hash-wasm`](https://github.com/Daninet/hash-wasm) 4.12.0 and runs in a Web Worker. The three sharing rows come from
the noble libraries: X-Wing with ML-KEM-768 from
[`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) 0.7.1, Ed25519 and the X25519 inside X-Wing
from [`@noble/curves`](https://github.com/paulmillr/noble-curves) 2.4.0, SHA-512 from
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes) 2.4.0. They are loaded the first time one of them is
needed. All strings are UTF-8; `‖` means concatenation.

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
header   = [version 1][suite 1][kind][padding scheme 1][key generation u32 BE]         8 bytes
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
- **Key generation.** The last four header bytes say which key of a shared calendar sealed the value (see
  [Sharing a calendar](#sharing-a-calendar)). Until 1.16 they were always 0, and they still are for everything that
  belongs to one account. The reader names the generation it expects, and a value that carries another one is refused
  before any key is tried. The field is part of the header, so it goes into the AAD and the key derivation too.

| `kind` | Value              | Key      |
| :----: | ------------------ | -------- |
| 1      | event or task (iCalendar text) | `K_data`; in a shared calendar, `K_sdata` of the generation |
| 2      | calendar (name, colour, order, …) | `K_data`; in a shared calendar, `K_sdata` of the generation |
| 3      | settings           | `K_data` |
| 4      | wrapped account key | `KEK` or `RKEK` |
| 5      | reminder list for Android | `K_rem`; in a shared calendar, `K_srem` of the generation |
| 6      | the calendar keys inside a grant | the X-Wing shared secret of that grant |

## Row ids

Events and settings rows get **deterministic, opaque ids**: `hex(HMAC-SHA-256(K_ids, label))[0..32]`, with labels such as
`"obj\n" + calendarRowId + "\n" + uid` for an event. The server sees ids it can't link back to an event's UID, and
importing the same file twice doesn't create duplicates. Calendars get random ids.

## Sharing a calendar

Since 1.16 the owner of a cloud calendar or task list can share it with other accounts, by e-mail address, to view or
to edit. The calendar stays end-to-end encrypted: it gets keys of its own, and the owner's app hands those keys to
each member's app in a form only that member can open. The service passes everything on and stores it, and holds
none of the keys. In this chapter the *owner* is the account that shares, a *member* is an account it shares with, a
*viewer* may only read and a *writer* may also edit.

```
kemSeed  = HKDF(K_data, "cal/v1/share/kem", 32)                X-Wing key pair = keygen(kemSeed); public key 1216 bytes
sigSeed  = HKDF(K_data, "cal/v1/share/sig", 32)                Ed25519 secret key; public key 32 bytes
card     = {"v":1,"u":userId,"k":b64(kemPublic),"s":b64(sigPublic),"p":b64(selfSig)}
           selfSig = Ed25519(sigSeed, "cal/v1/share/card" ‖ F(project) ‖ F(userId) ‖ F(kemPublic) ‖ F(sigPublic))
cardId   = hex(SHA-256(kemPublic ‖ sigPublic))                 names a card

CK_g     = 32 random bytes                                     the calendar key of generation g = 0, 1, 2, …
K_sdata  = HKDF(CK_g, "cal/v1/share/data", 32)                 the calendar's details, its events and tasks
K_srem   = HKDF(CK_g, "cal/v1/share/reminders", 32)            its reminder list
K_sids   = HKDF(CK_0, "cal/v1/share/ids", 32)                  HMAC key for row ids, always from generation 0

(ct, ss) = X-Wing.encapsulate(member's kemPublic)              ct 1120 bytes, ss 32 bytes
w        = envelope of kind 6 under ss, context {project, "share", calendarId, memberId}, of
           {"v":1,"c":calendarId,"o":ownerId,"keys":[{"g":0,"k":b64(CK_0)},…]}
grant    = {"v":1,"c":calendarId,"o":ownerId,"m":memberId,"ct":b64(ct),"w":w,"sig":b64(sig)}
           sig = Ed25519(owner's sigSeed, "cal/v1/share/grant" ‖ F(project) ‖ F(c) ‖ F(o) ‖ F(m) ‖ F(ct) ‖ F(w))

body     = {"v":1,"c":calendarId,"o":ownerId,"n":version,"g":current generation,
            "members":[{"u":userId,"r":"r"|"w","s":b64(sigPublic),"k":cardId}],
            "former":[{"u":userId,"s":b64(sigPublic),"g":generation from which their writes no longer count}],
            "at":milliseconds}                                 as JSON text
roster   = {"b":body,"sig":b64(sig)}
           sig = Ed25519(owner's sigSeed, "cal/v1/share/roster" ‖ F(project) ‖ u32(byte length of body) ‖ body)

item     = Ed25519(author's sigSeed, "cal/v1/share/item"   ‖ F(project) ‖ F(calendarId) ‖ F(rowId) ‖ u32(g) ‖ SHA-256(content))
meta     = Ed25519(owner's sigSeed,  "cal/v1/share/meta"   ‖ F(project) ‖ F(calendarId) ‖ u32(g) ‖ SHA-256(content))
digest   = Ed25519(author's sigSeed, "cal/v1/share/digest" ‖ F(project) ‖ F(calendarId) ‖ u32(g) ‖ SHA-256(content))
```

`F(x)` is the envelope's (byte length as u16 BE ‖ x), `u32` is big-endian, `b64` is standard base64. A label stands in
front of a signed message without a length.

Why it's built this way:

- **The identity is derived, not stored.** Both key pairs come from `K_data`, so every device of an account has the
  same identity as soon as it has unlocked the account, and no secret half is ever uploaded or written down. Each
  purpose has its own HKDF label, so the identity is unrelated to every other key of the account.
- **A hybrid key exchange.** X-Wing combines X25519 with ML-KEM-768. Someone who records a grant today and later
  breaks one of the two still can't open it.
- **Signatures, because encryption alone doesn't say who wrote something.** Every member of a calendar holds its
  keys, viewers included. Without author signatures a viewer could write an item that opens correctly for everybody
  else. With them, a viewer can't forge one, not even together with the service.
- **Key generations, because access ends.** When somebody is removed, everything written afterwards uses a key that
  person never received.
- **Row ids from generation 0.** An item's row id is `hex(HMAC-SHA-256(K_sids, "obj\n" + calendarId + "\n" + uid))[0..32]`,
  the construction of [Row ids](#row-ids) with the calendar's id key in place of the account's. Because `K_sids`
  always comes from `CK_0`, an item keeps its id whichever generation it was last written with, and every member
  computes the same id for the same UID. This is why every grant carries `CK_0`.

### Cards and the safety number

The card is the public half of an identity: the two public keys and the account's user id, signed with the card's own
signing key. A reader checks its form, the key sizes, that it names the person expected, and the signature. That
proves that whoever made the card holds the secret key. It does not prove that the key belongs to the person: the
service passes cards on, and could pass on one of its own. Two things stand against that.

- **The first card seen is remembered.** An app notes the `cardId` of the first card it sees for a person, in the
  account's own end-to-end encrypted settings, so every device of the account knows it. If the service later presents
  a different card for that person, the app reports "keys changed": it hands nothing over to that person, and takes
  nothing new from such an owner, until the two have compared the safety number again.
- **The safety number.** It is Signal's numeric fingerprint, computed over both cards. Per person, with
  `key = sigPublic ‖ kemPublic`: `h = SHA-512(0x00 0x00 ‖ key ‖ utf8(userId) ‖ key)`, then 5199 times
  `h = SHA-512(h ‖ key)`, 5200 hashes in all. The first 30 bytes of `h` are read as six 5-byte big-endian numbers, each
  taken mod 100000 and written with five digits. That gives 30 digits per person. The two halves, sorted, give 60
  digits, shown as 12 groups of 5.

Both apps arrive at the same number only if each holds the other's real card. Two people who compare it over a
channel the service doesn't control (in person, on a call) therefore know that nobody put other keys between them.
The app records the comparison together with exactly the card the number was computed from.

### Calendar keys and generations

A calendar that becomes shared gets a new random id and a first key, `CK_0`, made by the owner's app. Its details,
events, tasks and reminder list are sealed in the same [envelope](#the-envelope-every-encrypted-value) as private
data, with three differences: the key is a working key of the calendar, the header's key generation is `g`, and the
owner in the context is always the calendar's owner, whoever writes. A reader takes `g` from the header, picks that
generation's key and opens with `g` as the expected generation.

A new generation starts whenever somebody loses access or the right to edit: removed by the owner, left, the account
gone, or changed from writer to viewer. The owner's app makes `CK_g+1`, where `g` is the highest generation it holds
or has seen in a roster or grant it verified, never a number the service names. It then signs a new roster and makes
a new grant for itself and for every member who stays. Items written before are **not** encrypted again; they stay
readable under their old generation, for the people who had it.

### The grant

A grant carries the calendar keys to one member. Only the owner's app makes one, and only for a card it has
remembered. It encapsulates a fresh secret to the member's X-Wing key, seals the list of keys under that secret in an
envelope of kind 6 that is bound to the calendar and the member, and signs the whole with the owner's signing key.
The list always holds generation 0 and the newest 63 others, 64 at most. The owner also makes a grant addressed to
itself, which is how the owner's other devices get the keys.

The member's app checks, in this order, and stops at the first failure:

1. the grant's form and sizes;
2. that it names this calendar, this owner and this member;
3. the owner's signature, with the owner's remembered card;
4. that the encapsulated secret opens with the member's own key, and the envelope with that secret, as kind 6, for
   this calendar and this member;
5. that the sealed list names the same calendar and owner again;
6. that it holds between 1 and 64 keys of 32 bytes, each generation once, generation 0 among them.

A grant that brings a different key for a generation the device already holds is refused ("keys changed"): a key is
never replaced.

### The roster

The roster is the owner's signed statement of who may read and who may write. It is signed, not encrypted: it holds
account ids, roles, public signing keys and the generation number, which the service knows anyway.

| Field | Meaning |
| ----- | ------- |
| `n` | The roster's version. One higher with every change |
| `g` | The current key generation |
| `members` | Up to 20 people: user id, role (`r` view, `w` edit), public signing key, `cardId` |
| `former` | Up to 50 people who used to be writers, each with the generation from which their writes no longer count |

A reader checks the owner's signature with the owner's remembered card, then that the roster is for this calendar
and this owner, and refuses one whose version is lower than the highest it has seen for the calendar. That highest
version is kept in the account's encrypted settings, so the service can't hand out an old roster again to a device
of an account that has seen a newer one.

A writer who leaves, is removed or becomes a viewer moves to `former` with the new generation, so that what they
wrote before still counts. A viewer never does.

### Author signatures and what a reader accepts

Every value written to a shared calendar carries its author's user id and signature inside the sealed plaintext.

| Value | Sealed as | Who may sign | Signed message |
| ----- | --------- | ------------ | -------------- |
| Event or task | kind 1, `K_sdata` | owner or a writer | `item`: calendar, row id, generation, hash of the iCalendar text |
| Calendar details (name, colour, description, the list of people) | kind 2, `K_sdata` | owner only | `meta`: calendar, generation, hash of the details |
| Reminder list for Android | kind 5, `K_srem` | owner or a writer | `digest`: calendar, generation, hash of the list |

An event or task counts only when all of this holds:

1. the envelope opens with the key of the generation its header names, for its row and the calendar's owner;
2. the plaintext names the same calendar;
3. the author is somebody whose writes count at that generation by the verified roster: the owner, a member with
   role `w`, or a former writer whose roster generation is higher than the item's; and the signature verifies with
   that person's key;
4. the generation is not lower than the one at which this device accepted the same item before.

The calendar's details count only when signed by the owner. An item that fails is not shown and is not taken for a
deletion: the device keeps the copy it has and counts the item as unreadable. The reminder list is the exception
described under [Known limits](#known-limits).

### What the app trusts

The service stores and delivers; these rules decide what a device does with what it is handed.

- **A share counts only if this account made or accepted it.** Before an app creates a shared calendar or accepts an
  invitation, it notes that in the account's end-to-end encrypted settings, with the calendar, the owner and the
  owner's card. A calendar the service lists without such a note is ignored and reported. While the notes can't be
  read, nothing new is accepted.
- **The owner's app builds the member list from what it verified and from the owner's own decisions.** A new roster
  starts from the last roster the app verified. A person joins only through an invitation the owner made, with the
  role the owner chose; a role changes only when the owner changes it. What the service says about members never
  goes into a roster. The service can cause a removal, by no longer listing someone as a member. It can never add a
  person or raise a role.
- **A device writes only with the newest generation it has seen** in a verified roster or grant. If it doesn't hold
  that key yet, the calendar is read-only on that device until the grant arrives.
- **A device never takes an item at an older generation than it accepted it at.** An older copy handed out again is
  refused.

## What the service can and can't see

| Encrypted on your device | Visible to the service |
| ------------------------ | ---------------------- |
| Calendar names, colours, descriptions, order | Your e-mail address (and name, if you give one) |
| Every event and task in full: title, times, repeat rules, place, notes, guests, reminders | How many calendars and items you have, which item belongs to which calendar |
| All settings, holiday calendars, subscription addresses | Approximate sizes (after padding) |
| Your profile picture, reminder digests | When items are created, changed and deleted; your signed-in devices |
| A shared calendar's name, colour and description, its events and tasks, its reminder list, and the list of people kept inside it (their addresses and names) | Which accounts share a calendar, who owns it, each person's role (view or edit), the state of each invitation and membership, and when each changed |
| The calendar keys of every generation. Each account's sharing secrets are never stored at all | Each account's card (public keys only) and the signed roster (account ids, roles, public signing keys, the generation number) |
| | A keyed hash of an invited e-mail address, until the invitation is matched to an account or ends |

The service *can* refuse service, delete data, or hand back an older copy of an item. It *can't* read your data, or
change an item, move it or slip it into another account without your devices rejecting it.

For a shared calendar the service *can* also take a person out (the owner's app then starts a new key generation), and
withhold or delay invitations, grants, rosters and items. It *can't* read the calendar, add a person to it, raise
anyone's role, or make a device accept an item that nobody with the right to edit signed. Whether it could deliver
keys of its own at the first hand-over depends on the safety number: see the first sharing point below.

## Known limits

- **The web app's code comes from the server.** In a browser, the app is loaded from calendar.patryk.pro at each start;
  whoever controls that server could serve code that leaks keys. A strict Content-Security-Policy blocks injected
  scripts, not a changed app. The [Android app](https://play.google.com/store/apps/details?id=pro.patryk.calendar)
  ships its code inside the signed APK and doesn't have this weakness.
- **The account key isn't rotated.** A new password or Recovery Key stops the old one from working with the service,
  but someone who already holds an old secret *and* a copy of your encrypted data from before the change can still
  open that copy.
- **Lose the password and the Recovery Kit, lose the data.** Nobody can recover it, including the service.

Sharing adds these:

- **The first hand-over trusts the service, unless you compare the safety number.** The service passes the cards on.
  If two people never compare the safety number, the owner's app encapsulates the calendar keys to whichever card the
  service delivered first. A card that changes later is detected and blocks the hand-over.
- **Removing someone doesn't take anything back.** Their devices keep what they already had, including the keys of
  the generations up to their removal. Items written before the removal are not encrypted again; they stay under their
  old generation. Only what is written afterwards uses the new key.
- **A removed writer together with the service can still forge items at old generations.** A person who could edit
  stays in the roster as a former writer, so that what they wrote still counts, and they still hold the old keys. If
  the service stores it for them, an item sealed and signed at a generation from before their removal is accepted by
  a device that has not yet accepted that item at a higher generation. A removed viewer can't do this: a viewer's
  signature never counts.
- **Nobody checks the author's signature of a shared reminder list.** The Android app, the one reader that acts on
  it, checks that the list opens with the right key for the right calendar, not who signed it. The phone is only
  given reminder keys from the generation in use onwards, so the writer is someone in the calendar now. That includes
  viewers: a viewer together with the service could give the others' phones wrong reminders. They could not change an
  event.
- **The service can withhold or delay, and deletions are not authenticated.** As for private data, the service can
  make an item look deleted, or not deliver it.
- **A device shown only old data keeps acting on old state.** The service can keep handing a device an old roster and
  old items. What bounds this is what was seen before: the highest roster version and generation the account has
  seen, and the generation at which the device accepted each item. A device that was never shown anything newer can't
  tell.
- **The post-quantum half has not been independently audited.** ML-KEM-768 and the X-Wing combiner come from
  `@noble/post-quantum`, which has so far been audited only by its own author, and X-Wing itself is still a draft
  specification (draft-connolly-cfrg-xwing-kem). The classical half (X25519) and the signatures (Ed25519) come from
  `@noble/curves`, which has been audited independently. X-Wing is a hybrid: an attacker has to break both halves.
- **A roster keeps only the newest 50 former writers.** When one more joins them, the oldest entry is dropped, and
  what that person wrote is no longer accepted until somebody who may edit saves it again.
- **A writer can change or delete any item of the calendar.** That is what the right to edit means; there is no
  history of items.
- **A card can't be replaced.** An account's sharing identity lasts as long as its account key, which isn't rotated.

## Check it yourself

```sh
npm ci
npx vitest run src/lib/crypto
```

[`vectors.json`](../src/lib/crypto/vectors.json) holds fixed inputs (password, Secret Key, Recovery Key, account key,
`rowSalt`, context) and the exact expected outputs: derived keys, AAD, padded lengths and envelopes, plus malformed
envelopes that must be rejected. [`vectors.test.ts`](../src/lib/crypto/vectors.test.ts) checks the module against
them and against an independent reference implementation written with Node's own `crypto`.

Sharing has its own tests in [`share.test.ts`](../src/lib/crypto/share.test.ts): identities, cards, the safety number,
calendar keys, grants, rosters and author signatures, each with the changed, misdirected and malformed inputs that
must be refused. The `sharing` section of `vectors.json` fixes two identities with their cards, their safety number,
three key generations with their working keys and row ids, one grant (made with fixed randomness), one roster and one
signature of each kind with the exact bytes that were signed. To run only these:

```sh
npx vitest run src/lib/crypto/share.test.ts src/lib/crypto/vectors.test.ts
```

Found a weakness? Please report it privately, as described in [SECURITY.md](../SECURITY.md).
