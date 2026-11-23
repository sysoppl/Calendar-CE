// Sharing a calendar between accounts (protocol v1). Everything here stays
// end-to-end encrypted: the server only ever holds cards, grants, rosters and
// sealed values it cannot read, and whatever it changes in them is caught here.
//
// Identity. Every account has one, derived from its data key, so it is the
// same on every device and never stored anywhere:
//
//   kemSeed  = HKDF(K_data, "cal/v1/share/kem", 32)   X-Wing (ML-KEM-768 + X25519) key pair: keygen(kemSeed)
//   sigSeed  = HKDF(K_data, "cal/v1/share/sig", 32)   Ed25519 key pair; sigSeed is the secret key
//   card     = {"v":1,"u":userId,"k":b64(kemPublic),"s":b64(sigPublic),"p":b64(selfSignature)}
//              selfSignature over "cal/v1/share/card" ‖ F(projectId) ‖ F(u) ‖ F(kemPublic) ‖ F(sigPublic)
//   cardId   = hex(SHA-256(kemPublic ‖ sigPublic))
//
// The safety number (Signal's numeric fingerprint) lets two people check
// that the cards they were given are each other's, which is what stops a
// server that hands out keys of its own: per person h = SHA-512(0x0000 ‖ key ‖
// utf8(userId) ‖ key), then 5199 times h = SHA-512(h ‖ key), with key =
// sigPublic ‖ kemPublic; the first 30 bytes of h as six 5-byte big-endian
// numbers mod 100000, five digits each. The two 30-digit halves, sorted, give
// 60 digits.
//
// Calendar keys. A shared calendar has a key per generation, CK_g (32 random
// bytes); a new generation starts whenever somebody loses access. Values
// sealed with a generation's keys name it in the envelope header (keyGen).
//
//   K_sdata  = HKDF(CK_g, "cal/v1/share/data", 32)        calendar and object rows
//   K_srem   = HKDF(CK_g, "cal/v1/share/reminders", 32)   the reminder digest
//   K_sids   = HKDF(CK_0, "cal/v1/share/ids", 32)         HMAC key for object row ids, always of generation 0
//
// Grant: how the owner hands the keys to a member (and to the owner's own
// other devices, as a grant to the owner):
//
//   (ct, ss) = X-Wing.encapsulate(member's kemPublic)
//   w        = envelope of kind 6 under ss, context {projectId, "share", calendarId, memberId},
//              plaintext {"v":1,"c":calendarId,"o":ownerId,"keys":[{"g":g,"k":b64(CK_g)},…]} (generation 0 always, it
//              names the rows; then the newest 63 others, 64 at most)
//   grant    = {"v":1,"c":…,"o":…,"m":…,"ct":b64(ct),"w":w,"sig":b64(sig)}, signed by the owner over
//              "cal/v1/share/grant" ‖ F(projectId) ‖ F(c) ‖ F(o) ‖ F(m) ‖ F(ct) ‖ F(utf8(w))
//
// Roster: who may read and who may write, signed by the owner:
//
//   body     = {"v":1,"c","o","n":version,"g":generation,"members":[{"u","r":"r"|"w","s":b64(sigPublic),"k":cardId}],
//               "former":[{"u","s","g":generation from which their writes no longer count}],"at":ms}
//   roster   = {"b":body as a string,"sig":b64(sign("cal/v1/share/roster" ‖ F(projectId) ‖ u32(byte length) ‖ utf8(body)))}
//
// Author signatures: every value written to a shared calendar is signed by
// whoever wrote it, so that a member who may only read cannot forge one, not
// even together with the server:
//
//   item     "cal/v1/share/item"   ‖ F(projectId) ‖ F(calendarId) ‖ F(rowId) ‖ u32(g) ‖ SHA-256(utf8(content))
//   meta     "cal/v1/share/meta"   ‖ F(projectId) ‖ F(calendarId) ‖ u32(g) ‖ SHA-256(utf8(content))
//   digest   "cal/v1/share/digest" ‖ F(projectId) ‖ F(calendarId) ‖ u32(g) ‖ SHA-256(utf8(content))
//
// F(x) = byte length as u16 BE ‖ x, as in the envelope; u32 is big-endian;
// text is UTF-8 and the labels stand in front without a length. Ed25519
// signatures are checked strictly (RFC 8032, no ZIP 215 leniency).
//
// The libraries (all MIT) are loaded the first time a function here needs
// them, so an app that never shares never downloads them: `@noble/curves`
// (Ed25519, and X25519 inside X-Wing) and `@noble/hashes` (SHA-512), both
// audited independently; and `@noble/post-quantum` (ML-KEM-768 and the X-Wing
// combiner), which has not been audited independently yet (only by its own
// author, as its README says).
import { concat, fromBase64, toBase64, toHex, utf8, wipe, type Bytes } from './encoding';
import { KIND, MAX_KEY_GENERATION, openJson, sealWithSalt, type Context } from './envelope';
import { CryptoError } from './errors';
import { hkdf, hkdfKey, randomBytes, sha256 } from './primitives';

// ---------------------------------------------------------------------------
// Sizes and limits

const KEY_LENGTH = 32;
const KEM_PUBLIC_LENGTH = 1216;
const KEM_CIPHERTEXT_LENGTH = 1120;
const SIG_PUBLIC_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
const SALT_LENGTH = 32;
const FINGERPRINT_ITERATIONS = 5200;

/** The most generations a grant carries: generation 0 always, and the newest 63 others (older ones are left out). */
export const MAX_GRANT_KEYS = 64;
/** The most people a roster lists as members, and as former members. */
export const MAX_ROSTER_MEMBERS = 20;
export const MAX_ROSTER_FORMER = 50;
/** The longest texts of each kind, in characters. */
export const MAX_CARD_LENGTH = 4096;
export const MAX_GRANT_LENGTH = 8192;
export const MAX_ROSTER_LENGTH = 16384;
/** The longest id (user, calendar, row) taken here. */
const MAX_ID_LENGTH = 128;

const SHARE_SCOPE = 'share';

// ---------------------------------------------------------------------------
// The libraries, loaded on first use

interface Libraries {
  xwing: (typeof import('@noble/post-quantum/hybrid.js'))['ml_kem768_x25519'];
  ed25519: (typeof import('@noble/curves/ed25519.js'))['ed25519'];
  sha512: (typeof import('@noble/hashes/sha2.js'))['sha512'];
}

let libraries: Promise<Libraries> | undefined;

function load(): Promise<Libraries> {
  libraries ??= Promise.all([import('@noble/post-quantum/hybrid.js'), import('@noble/curves/ed25519.js'), import('@noble/hashes/sha2.js')]).then(
    ([hybrid, curves, hashes]) => ({ xwing: hybrid.ml_kem768_x25519, ed25519: curves.ed25519, sha512: hashes.sha512 }),
    (error: unknown) => {
      // A failed download (offline) is tried again next time.
      libraries = undefined;
      throw error;
    },
  );
  return libraries;
}

// ---------------------------------------------------------------------------
// Helpers

function formatError(message: string): CryptoError {
  return new CryptoError('format', message);
}

function authError(message: string): CryptoError {
  return new CryptoError('auth', message);
}

/** A copy that is a plain `Bytes`, whatever the library handed back. */
function own(bytes: Uint8Array): Bytes {
  return Uint8Array.from(bytes);
}

function field(value: string | Uint8Array): Bytes {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  if (bytes.length > 0xffff) throw formatError('A field is too long');
  const out = new Uint8Array(2 + bytes.length);
  out[0] = bytes.length >>> 8;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function u32(value: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function checkId(value: unknown, what: string): asserts value is string {
  if (!isId(value)) throw formatError(`The ${what} is missing or too long`);
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_KEY_GENERATION;
}

function checkGeneration(value: unknown): asserts value is number {
  if (!isGeneration(value)) throw formatError('A key generation must be a whole number from 0 to 2^32 - 1');
}

/** A byte array of this length. Not `instanceof`: in a DOM test environment the arrays may come from another realm. */
function isBytes(value: unknown, length: number): value is Uint8Array {
  return ArrayBuffer.isView(value) && (value as Uint8Array).BYTES_PER_ELEMENT === 1 && value.byteLength === length;
}

/** Standard base64 of exactly `length` bytes. */
function bytesOf(value: unknown, length: number, what: string): Bytes {
  if (typeof value !== 'string') throw formatError(`The ${what} is missing`);
  const bytes = fromBase64(value);
  if (bytes.length !== length) throw formatError(`The ${what} has the wrong size`);
  return bytes;
}

function checkKey(key: Uint8Array): Uint8Array {
  if (!isBytes(key, KEY_LENGTH)) throw formatError('A calendar key must be 32 bytes');
  return key;
}

/**
 * A JSON object with exactly these members. A `v` other than 1 is reported
 * as a newer version when it is a larger whole number, so that what a newer
 * app wrote is not taken for damage.
 */
function parseObject(text: unknown, maxLength: number, keys: readonly string[], what: string, versioned = true): Record<string, unknown> {
  if (typeof text !== 'string' || text.length > maxLength) throw formatError(`The ${what} is missing or too long`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw formatError(`The ${what} is not JSON`);
  }
  return checkObject(value, keys, what, versioned);
}

function checkObject(value: unknown, keys: readonly string[], what: string, versioned = true): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw formatError(`The ${what} is not an object`);
  const record = value as Record<string, unknown>;
  if (versioned && record.v !== 1) {
    if (typeof record.v === 'number' && Number.isInteger(record.v) && record.v > 1) throw new CryptoError('version', `The ${what} was written by a newer version`);
    throw formatError(`The ${what} has no version`);
  }
  const present = Object.keys(record);
  if (present.length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) throw formatError(`The ${what} has the wrong members`);
  return record;
}

async function sign(secret: Uint8Array, message: Uint8Array): Promise<Bytes> {
  const { ed25519 } = await load();
  return own(ed25519.sign(message, secret));
}

/** Throws CryptoError('auth') unless `signature` is a valid Ed25519 signature of `message` by `publicKey`. */
async function verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array, what: string): Promise<void> {
  const { ed25519 } = await load();
  let valid = false;
  try {
    valid = ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    // A public key or signature that is not even a point on the curve.
    valid = false;
  }
  if (!valid) throw authError(`The ${what} is not signed by the right person`);
}

// ---------------------------------------------------------------------------
// Identity

/**
 * An account's sharing identity. `kemSeed` and `sigSecret` are secret: keep
 * them in memory only, and overwrite them (`forgetIdentity`) when done.
 */
export interface ShareIdentity {
  /** The X-Wing decapsulation key: the 32-byte seed of the key pair. */
  kemSeed: Bytes;
  /** The Ed25519 secret key (its 32-byte seed). */
  sigSecret: Bytes;
  /** X-Wing public key, 1216 bytes. */
  kemPublic: Bytes;
  /** Ed25519 public key, 32 bytes. */
  sigPublic: Bytes;
}

function checkIdentity(identity: ShareIdentity): void {
  if (
    !isBytes(identity?.kemSeed, KEY_LENGTH) ||
    !isBytes(identity.sigSecret, KEY_LENGTH) ||
    !isBytes(identity.kemPublic, KEM_PUBLIC_LENGTH) ||
    !isBytes(identity.sigPublic, SIG_PUBLIC_LENGTH)
  ) {
    throw formatError('Not a sharing identity');
  }
}

/**
 * The sharing identity of an account, from its data key K_data (the HKDF
 * base key of `importAccountKeys`, or its 32 raw bytes). The same key always
 * gives the same identity.
 */
export async function deriveIdentity(dataKey: CryptoKey | Uint8Array): Promise<ShareIdentity> {
  let base: CryptoKey | Uint8Array;
  if (ArrayBuffer.isView(dataKey)) base = checkKey(dataKey);
  else if (dataKey?.algorithm?.name === 'HKDF' && dataKey.usages.includes('deriveBits')) base = dataKey;
  else throw formatError('The key cannot derive an identity');
  const { xwing, ed25519 } = await load();
  const kemSeed = await hkdf(base, 'cal/v1/share/kem', KEY_LENGTH);
  const sigSecret = await hkdf(base, 'cal/v1/share/sig', KEY_LENGTH);
  try {
    const pair = xwing.keygen(kemSeed);
    const kemPublic = own(pair.publicKey);
    // The library's secret key is the seed again; this copy is not needed.
    if (pair.secretKey !== kemSeed) wipe(pair.secretKey);
    return { kemSeed, sigSecret, kemPublic, sigPublic: own(ed25519.getPublicKey(sigSecret)) };
  } catch (error) {
    wipe(kemSeed, sigSecret);
    throw error;
  }
}

/** Overwrites the secret halves of an identity. */
export function forgetIdentity(identity: ShareIdentity | undefined): void {
  wipe(identity?.kemSeed, identity?.sigSecret);
}

// ---------------------------------------------------------------------------
// Cards

/** A card that was read and checked. */
export interface ShareCard {
  userId: string;
  kemPublic: Bytes;
  sigPublic: Bytes;
  /** `cardId` of the card. */
  id: string;
}

function cardMessage(projectId: string, userId: string, kemPublic: Uint8Array, sigPublic: Uint8Array): Bytes {
  return concat(utf8('cal/v1/share/card'), field(projectId), field(userId), field(kemPublic), field(sigPublic));
}

function checkCard(card: ShareCard, what: string): void {
  if (!isId(card?.userId) || !isBytes(card.kemPublic, KEM_PUBLIC_LENGTH) || !isBytes(card.sigPublic, SIG_PUBLIC_LENGTH)) throw formatError(`The ${what} is not a card`);
}

/** The public card of an identity, signed by itself, as text. */
export async function makeCard(identity: ShareIdentity, projectId: string, userId: string): Promise<string> {
  checkIdentity(identity);
  checkId(projectId, 'project id');
  checkId(userId, 'user id');
  const signature = await sign(identity.sigSecret, cardMessage(projectId, userId, identity.kemPublic, identity.sigPublic));
  return JSON.stringify({ v: 1, u: userId, k: toBase64(identity.kemPublic), s: toBase64(identity.sigPublic), p: toBase64(signature) });
}

/**
 * Reads a card and checks that it is whole, that it is `expectUserId`'s and
 * that it is signed by its own key. That proves the card was made by whoever
 * holds the key, not that this is the person's real key: only pinning the
 * first card seen and the safety number do that.
 */
export async function readCard(text: string, projectId: string, expectUserId: string): Promise<ShareCard> {
  checkId(projectId, 'project id');
  const card = parseObject(text, MAX_CARD_LENGTH, ['v', 'u', 'k', 's', 'p'], 'card');
  checkId(card.u, 'user id of the card');
  const kemPublic = bytesOf(card.k, KEM_PUBLIC_LENGTH, 'encryption key of the card');
  const sigPublic = bytesOf(card.s, SIG_PUBLIC_LENGTH, 'signing key of the card');
  const signature = bytesOf(card.p, SIGNATURE_LENGTH, 'signature of the card');
  if (card.u !== expectUserId) throw authError('The card belongs to another person');
  await verifySignature(sigPublic, cardMessage(projectId, card.u, kemPublic, sigPublic), signature, 'card');
  return { userId: card.u, kemPublic, sigPublic, id: await cardId({ kemPublic, sigPublic }) };
}

/** The id of a card: hex SHA-256 of its two public keys. */
export async function cardId(card: { kemPublic: Uint8Array; sigPublic: Uint8Array }): Promise<string> {
  if (!isBytes(card?.kemPublic, KEM_PUBLIC_LENGTH) || !isBytes(card.sigPublic, SIG_PUBLIC_LENGTH)) throw formatError('Not the keys of a card');
  return toHex(await sha256(concat(card.kemPublic, card.sigPublic)));
}

// ---------------------------------------------------------------------------
// Safety number

/** One person's 30 digits. */
async function fingerprint(card: ShareCard): Promise<string> {
  const { sha512 } = await load();
  const key = concat(card.sigPublic, card.kemPublic);
  let hash = sha512.create().update(Uint8Array.of(0, 0)).update(key).update(utf8(card.userId)).update(key).digest();
  for (let i = 1; i < FINGERPRINT_ITERATIONS; i++) hash = sha512.create().update(hash).update(key).digest();
  let digits = '';
  for (let chunk = 0; chunk < 6; chunk++) {
    const at = chunk * 5;
    // Five bytes are 40 bits, well inside what a double holds exactly.
    const value = hash[at] * 2 ** 32 + (((hash[at + 1] << 24) | (hash[at + 2] << 16) | (hash[at + 3] << 8) | hash[at + 4]) >>> 0);
    digits += String(value % 100000).padStart(5, '0');
  }
  return digits;
}

/**
 * The safety number of two people: 60 digits, the same whichever of the two
 * computes it, meant to be shown as 12 groups of 5. It changes when either
 * card changes.
 */
export async function safetyNumber(a: ShareCard, b: ShareCard): Promise<string> {
  checkCard(a, 'first card');
  checkCard(b, 'second card');
  const halves = [await fingerprint(a), await fingerprint(b)].sort();
  return halves.join('');
}

// ---------------------------------------------------------------------------
// Calendar keys

/** The key of a new generation: 32 random bytes. The caller owns them. */
export function generateCalendarKey(): Bytes {
  return randomBytes(KEY_LENGTH);
}

/** The working keys of one generation of a shared calendar. */
export interface CalendarKeys {
  /** HKDF base key for `seal`/`open` of the calendar's rows (K_sdata). */
  data: CryptoKey;
  /** HKDF base key for `seal`/`open` of its reminder digest (K_srem). */
  reminders: CryptoKey;
  /** K_srem as raw bytes, for the hosted edition's Android app, which opens the digest natively. The caller owns them. */
  remindersRaw: Bytes;
}

/** The working keys of a generation's key CK_g. The key is left as it is: the caller owns it. */
export async function calendarKeys(ck: Uint8Array): Promise<CalendarKeys> {
  const base = await hkdfKey(checkKey(ck));
  let data: Bytes | undefined;
  let remindersRaw: Bytes | undefined;
  try {
    data = await hkdf(base, 'cal/v1/share/data', KEY_LENGTH);
    remindersRaw = await hkdf(base, 'cal/v1/share/reminders', KEY_LENGTH);
    return { data: await hkdfKey(data), reminders: await hkdfKey(remindersRaw), remindersRaw };
  } catch (error) {
    wipe(remindersRaw);
    throw error;
  } finally {
    wipe(data);
  }
}

/**
 * K_sids, the HMAC key for the object ids of a shared calendar, as raw bytes
 * (the same HMAC as `rowId`, under this key). Always from the key of
 * generation 0, so that an object keeps its id across generations.
 */
export async function calendarIdKey(ck0: Uint8Array): Promise<Bytes> {
  return hkdf(checkKey(ck0), 'cal/v1/share/ids', KEY_LENGTH);
}

// ---------------------------------------------------------------------------
// Grants

/** One generation's calendar key. */
export interface GenerationKey {
  g: number;
  /** CK_g, 32 bytes. */
  k: Bytes;
}

/** Whom a grant is for. `memberId` is the owner's own id for the owner's grant. */
export interface GrantPlace {
  projectId: string;
  calendarId: string;
  ownerId: string;
  memberId: string;
}

function checkPlace(place: GrantPlace): void {
  checkId(place?.projectId, 'project id');
  checkId(place.calendarId, 'calendar id');
  checkId(place.ownerId, 'owner id');
  checkId(place.memberId, 'member id');
}

function grantContext(place: GrantPlace): Context {
  return { projectId: place.projectId, scope: SHARE_SCOPE, id: place.calendarId, ownerId: place.memberId };
}

function grantMessage(place: GrantPlace, cipherText: Uint8Array, wrapped: string): Bytes {
  return concat(utf8('cal/v1/share/grant'), field(place.projectId), field(place.calendarId), field(place.ownerId), field(place.memberId), field(cipherText), field(utf8(wrapped)));
}

/**
 * The keys sorted by generation, without duplicates: generation 0 always (the
 * object row ids are derived from it, `calendarIdKey`), and the newest
 * `MAX_GRANT_KEYS - 1` others.
 */
function grantKeys(keys: readonly GenerationKey[]): GenerationKey[] {
  if (!Array.isArray(keys) || keys.length === 0) throw formatError('A grant needs at least one key');
  const sorted = [...keys].sort((a, b) => a.g - b.g);
  for (let i = 0; i < sorted.length; i++) {
    checkGeneration(sorted[i]?.g);
    checkKey(sorted[i].k);
    if (i > 0 && sorted[i].g === sorted[i - 1].g) throw formatError('A generation is given twice');
  }
  if (sorted[0].g !== 0) throw formatError('A grant needs the key of generation 0');
  return [sorted[0], ...sorted.slice(1).slice(-(MAX_GRANT_KEYS - 1))];
}

/**
 * `makeGrant` with the randomness given instead of drawn. For test vectors
 * only: the same `eseed` twice gives the same shared secret twice.
 */
export async function makeGrantWith(owner: ShareIdentity, place: GrantPlace, member: ShareCard, keys: readonly GenerationKey[], eseed: Uint8Array | undefined, rowSalt: Uint8Array): Promise<string> {
  checkIdentity(owner);
  checkPlace(place);
  checkCard(member, 'member card');
  if (member.userId !== place.memberId) throw formatError('The card is not the member\'s');
  const kept = grantKeys(keys);
  const { xwing } = await load();
  let sealed: { cipherText: Uint8Array; sharedSecret: Uint8Array };
  try {
    sealed = eseed === undefined ? xwing.encapsulate(member.kemPublic) : xwing.encapsulate(member.kemPublic, eseed);
  } catch {
    throw formatError('The encryption key of the card cannot be used');
  }
  const cipherText = own(sealed.cipherText);
  const plaintext = utf8(JSON.stringify({ v: 1, c: place.calendarId, o: place.ownerId, keys: kept.map(({ g, k }) => ({ g, k: toBase64(k) })) }));
  let wrapped: string;
  try {
    wrapped = await sealWithSalt(sealed.sharedSecret, KIND.shareGrant, grantContext(place), plaintext, rowSalt);
  } finally {
    wipe(plaintext, sealed.sharedSecret);
  }
  const signature = await sign(owner.sigSecret, grantMessage(place, cipherText, wrapped));
  const text = JSON.stringify({ v: 1, c: place.calendarId, o: place.ownerId, m: place.memberId, ct: toBase64(cipherText), w: wrapped, sig: toBase64(signature) });
  if (text.length > MAX_GRANT_LENGTH) throw formatError('The grant is too long');
  return text;
}

/**
 * A grant of the calendar's keys for `member`, whose card the owner has
 * checked and pinned: generation 0, which `keys` must hold, and the newest
 * 63 others of `keys`. Made by the owner only, signed with the owner's
 * identity.
 */
export function makeGrant(owner: ShareIdentity, place: GrantPlace, member: ShareCard, keys: readonly GenerationKey[]): Promise<string> {
  return makeGrantWith(owner, place, member, keys, undefined, randomBytes(SALT_LENGTH));
}

/**
 * Opens a grant meant for this identity: checks the owner's signature with the
 * owner's pinned card first, then decapsulates and opens the keys. Returns
 * them sorted by generation (generation 0 always first: a grant without it
 * is refused, CryptoError 'format'); the caller owns the key bytes.
 */
export async function openGrant(member: ShareIdentity, text: string, place: GrantPlace, ownerCard: ShareCard): Promise<GenerationKey[]> {
  checkIdentity(member);
  checkPlace(place);
  checkCard(ownerCard, 'owner card');
  const grant = parseObject(text, MAX_GRANT_LENGTH, ['v', 'c', 'o', 'm', 'ct', 'w', 'sig'], 'grant');
  checkId(grant.c, 'calendar id of the grant');
  checkId(grant.o, 'owner id of the grant');
  checkId(grant.m, 'member id of the grant');
  const cipherText = bytesOf(grant.ct, KEM_CIPHERTEXT_LENGTH, 'ciphertext of the grant');
  if (typeof grant.w !== 'string') throw formatError('The grant holds no keys');
  const signature = bytesOf(grant.sig, SIGNATURE_LENGTH, 'signature of the grant');
  if (grant.c !== place.calendarId || grant.o !== place.ownerId || grant.m !== place.memberId) throw authError('The grant is for another calendar or person');
  if (ownerCard.userId !== place.ownerId) throw authError('The card is not the owner\'s');
  await verifySignature(ownerCard.sigPublic, grantMessage(place, cipherText, grant.w), signature, 'grant');

  const { xwing } = await load();
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = xwing.decapsulate(cipherText, member.kemSeed);
  } catch {
    throw authError('The grant cannot be opened with this identity');
  }
  let inner: unknown;
  try {
    inner = await openJson(sharedSecret, KIND.shareGrant, grantContext(place), grant.w);
  } finally {
    wipe(sharedSecret);
  }
  const body = checkObject(inner, ['v', 'c', 'o', 'keys'], 'grant');
  if (body.c !== place.calendarId || body.o !== place.ownerId) throw authError('The grant is for another calendar or person');
  const list = body.keys;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_GRANT_KEYS) throw formatError('The grant has no keys or too many');
  const keys: GenerationKey[] = [];
  try {
    for (const entry of list) {
      const item = checkObject(entry, ['g', 'k'], 'key of the grant', false);
      if (!isGeneration(item.g)) throw formatError('A key of the grant has no generation');
      keys.push({ g: item.g, k: bytesOf(item.k, KEY_LENGTH, 'key of the grant') });
    }
    keys.sort((a, b) => a.g - b.g);
    for (let i = 1; i < keys.length; i++) if (keys[i].g === keys[i - 1].g) throw formatError('A generation is in the grant twice');
    if (keys[0].g !== 0) throw formatError('The grant has no key of generation 0');
    return keys;
  } catch (error) {
    wipe(...keys.map((key) => key.k));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rosters

export interface RosterMember {
  /** User id. */
  u: string;
  /** `r` reads only, `w` reads and writes. */
  r: 'r' | 'w';
  /** Ed25519 public key, standard base64. */
  s: string;
  /** `cardId` of the member's pinned card. */
  k: string;
}

export interface RosterFormer {
  u: string;
  s: string;
  /** The generation from which this person's writes no longer count. */
  g: number;
}

/** What a roster says (its body), without the version of the format. */
export interface Roster {
  /** Calendar id. */
  c: string;
  /** Owner's user id. */
  o: string;
  /** Version of the roster, one higher with every change. */
  n: number;
  /** The current key generation. */
  g: number;
  members: RosterMember[];
  former: RosterFormer[];
  /** When it was made, in ms. */
  at: number;
}

const HEX_ID = /^[0-9a-f]{64}$/;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function checkSigKey(value: unknown): void {
  bytesOf(value, SIG_PUBLIC_LENGTH, 'signing key in the roster');
}

/** The roster in its normal form, or CryptoError('format'). */
function checkRoster(roster: Roster): Roster {
  if (typeof roster !== 'object' || roster === null) throw formatError('Not a roster');
  checkId(roster.c, 'calendar id of the roster');
  checkId(roster.o, 'owner id of the roster');
  if (!isCount(roster.n) || !isCount(roster.at)) throw formatError('The roster has no version or time');
  if (!isGeneration(roster.g)) throw formatError('The roster has no generation');
  if (!Array.isArray(roster.members) || roster.members.length > MAX_ROSTER_MEMBERS) throw formatError('The roster has no members or too many');
  if (!Array.isArray(roster.former) || roster.former.length > MAX_ROSTER_FORMER) throw formatError('The roster has too many former members');
  const seen = new Set<string>();
  const members = roster.members.map((entry): RosterMember => {
    const m = checkObject(entry, ['u', 'r', 's', 'k'], 'member of the roster', false);
    checkId(m.u, 'member id');
    if (seen.has(m.u)) throw formatError('A member is in the roster twice');
    seen.add(m.u);
    const role = m.r;
    if (role !== 'r' && role !== 'w') throw formatError('A member of the roster has no role');
    checkSigKey(m.s);
    if (typeof m.k !== 'string' || !HEX_ID.test(m.k)) throw formatError('A member of the roster has no card id');
    return { u: m.u, r: role, s: m.s as string, k: m.k };
  });
  const former = roster.former.map((entry): RosterFormer => {
    const f = checkObject(entry, ['u', 's', 'g'], 'former member of the roster', false);
    checkId(f.u, 'former member id');
    checkSigKey(f.s);
    if (!isGeneration(f.g)) throw formatError('A former member of the roster has no generation');
    return { u: f.u, s: f.s as string, g: f.g };
  });
  return { c: roster.c, o: roster.o, n: roster.n, g: roster.g, members, former, at: roster.at };
}

function rosterMessage(projectId: string, body: Uint8Array): Bytes {
  return concat(utf8('cal/v1/share/roster'), field(projectId), u32(body.length), body);
}

/** A roster signed by the owner, as text. */
export async function makeRoster(owner: ShareIdentity, projectId: string, roster: Roster): Promise<string> {
  checkIdentity(owner);
  checkId(projectId, 'project id');
  const r = checkRoster(roster);
  const body = JSON.stringify({ v: 1, c: r.c, o: r.o, n: r.n, g: r.g, members: r.members, former: r.former, at: r.at });
  const signature = await sign(owner.sigSecret, rosterMessage(projectId, utf8(body)));
  const text = JSON.stringify({ b: body, sig: toBase64(signature) });
  if (text.length > MAX_ROSTER_LENGTH) throw formatError('The roster is too long');
  return text;
}

export interface RosterExpectation {
  projectId: string;
  calendarId: string;
  ownerId: string;
  /** The owner's pinned card. */
  ownerCard: ShareCard;
  /** The highest roster version seen for this calendar: an older one is refused. */
  minVersion?: number;
}

/**
 * Reads a roster: checks the owner's signature with the pinned card first,
 * then that it is this calendar's and this owner's, and not older than
 * `minVersion`.
 */
export async function readRoster(text: string, expect: RosterExpectation): Promise<Roster> {
  checkId(expect?.projectId, 'project id');
  checkId(expect.calendarId, 'calendar id');
  checkId(expect.ownerId, 'owner id');
  checkCard(expect.ownerCard, 'owner card');
  const outer = parseObject(text, MAX_ROSTER_LENGTH, ['b', 'sig'], 'roster', false);
  if (typeof outer.b !== 'string') throw formatError('The roster is missing');
  const signature = bytesOf(outer.sig, SIGNATURE_LENGTH, 'signature of the roster');
  if (expect.ownerCard.userId !== expect.ownerId) throw authError('The card is not the owner\'s');
  await verifySignature(expect.ownerCard.sigPublic, rosterMessage(expect.projectId, utf8(outer.b)), signature, 'roster');
  const body = parseObject(outer.b, MAX_ROSTER_LENGTH, ['v', 'c', 'o', 'n', 'g', 'members', 'former', 'at'], 'roster');
  const roster = checkRoster(body as unknown as Roster);
  if (roster.c !== expect.calendarId || roster.o !== expect.ownerId) throw authError('The roster is for another calendar or owner');
  if (expect.minVersion !== undefined && roster.n < expect.minVersion) throw authError('The roster is older than one already seen');
  return roster;
}

/**
 * The signing keys whose signature makes a value of generation `generation`
 * by `authorId` count: the owner's; a member's who may write; a former
 * member's whose writes stopped counting only after that generation. Empty
 * when nobody of that id may have written it.
 */
export function authorKeys(roster: Roster, ownerCard: ShareCard, authorId: string, generation: number): Bytes[] {
  const keys: Bytes[] = [];
  if (authorId === roster.o && ownerCard.userId === roster.o) keys.push(ownerCard.sigPublic);
  for (const m of roster.members) if (m.u === authorId && m.r === 'w') keys.push(fromBase64(m.s));
  for (const f of roster.former) if (f.u === authorId && f.g > generation) keys.push(fromBase64(f.s));
  return keys;
}

// ---------------------------------------------------------------------------
// Author signatures

/** What is signed: an object row (`item`), the calendar's own row (`meta`), or its reminder digest (`digest`). */
export type SignedValue = 'item' | 'meta' | 'digest';

export interface SignedPlace {
  projectId: string;
  calendarId: string;
  /** The key generation the value is sealed with. */
  generation: number;
  /** The row id: for `item` only. */
  rowId?: string;
}

async function itemMessage(what: SignedValue, place: SignedPlace, content: string): Promise<Bytes> {
  if (what !== 'item' && what !== 'meta' && what !== 'digest') throw formatError('Unknown kind of signed value');
  checkId(place?.projectId, 'project id');
  checkId(place.calendarId, 'calendar id');
  checkGeneration(place.generation);
  if (typeof content !== 'string') throw formatError('The signed content must be text');
  const parts = [utf8(`cal/v1/share/${what}`), field(place.projectId), field(place.calendarId)];
  if (what === 'item') {
    checkId(place.rowId, 'row id');
    parts.push(field(place.rowId));
  } else if (place.rowId !== undefined) {
    throw formatError('Only an item names its row');
  }
  parts.push(u32(place.generation), await sha256(utf8(content)));
  return concat(...parts);
}

/** The author's signature (standard base64) of a value written to a shared calendar. */
export async function signItem(author: ShareIdentity, what: SignedValue, place: SignedPlace, content: string): Promise<string> {
  checkIdentity(author);
  return toBase64(await sign(author.sigSecret, await itemMessage(what, place, content)));
}

/**
 * Checks an author's signature. `keys` are the keys that count for the author
 * (`authorKeys`); one of them has to have made it. Throws CryptoError('auth')
 * otherwise, 'format' for a signature that is not one.
 */
export async function verifyItem(keys: Uint8Array | readonly Uint8Array[], what: SignedValue, place: SignedPlace, content: string, signature: string): Promise<void> {
  const message = await itemMessage(what, place, content);
  const bytes = bytesOf(signature, SIGNATURE_LENGTH, 'signature');
  const list = ArrayBuffer.isView(keys) ? [keys] : keys;
  for (const key of list) {
    if (!isBytes(key, SIG_PUBLIC_LENGTH)) continue;
    try {
      await verifySignature(key, message, bytes, 'value');
      return;
    } catch {
      // Try the next key.
    }
  }
  throw authError('The value is not signed by someone who may write it');
}
