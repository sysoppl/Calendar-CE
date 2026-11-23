// Checks vectors.json, the fixed test vectors shared with the Java
// implementation in the Android app, and confirms the envelope format with a
// second implementation written against node:crypto.
//
// To regenerate the file after a deliberate protocol change:
//   CRYPTO_VECTORS=write npx vitest run src/lib/crypto/vectors.test.ts
// then run the tests again without the variable. The inputs are fixed below,
// so regenerating without a change gives the same file byte for byte.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { argon2id } from 'hash-wasm';
import { describe, expect, it } from 'vitest';
import { fromBase64, fromHex, toBase64, toHex, utf8 } from './encoding';
import { CryptoError, open, paddedLength, seal, sealWithSalt, type Context, type CryptoErrorCode, type Kind } from './envelope';
import { deriveLogin, deriveRecovery } from './kdf';
import { exportReminderKey, importAccountKeys, objectRowLabel, profileRowLabel, rowId, SETTINGS_ROW_LABEL } from './keys';
import {
  calendarIdKey,
  calendarKeys,
  deriveIdentity,
  makeCard,
  makeGrantWith,
  makeRoster,
  openGrant,
  readCard,
  readRoster,
  safetyNumber,
  signItem,
  verifyItem,
  type GrantPlace,
  type Roster,
  type ShareIdentity,
  type SignedPlace,
  type SignedValue,
} from './share';

const FILE = fileURLToPath(new URL('./vectors.json', import.meta.url));
const WRITE = process.env.CRYPTO_VECTORS === 'write';

interface EnvelopeVector {
  name: string;
  kind: Kind;
  /** 32 bytes, hex. */
  key: string;
  /** 32 bytes, hex. */
  rowSalt: string;
  context: Context;
  /** Base64. */
  plaintext: string;
  plaintextLength: number;
  paddedLength: number;
  /** Hex, for debugging an implementation step by step. */
  aad: string;
  /** Standard base64 with padding: the stored text. */
  envelope: string;
  /** The key generation in the header; absent means 0. */
  keyGen?: number;
}

interface RejectVector {
  name: string;
  kind: Kind;
  key: string;
  context: Context;
  envelope: string;
  /** The key generation the reader expects; absent means 0. */
  keyGen?: number;
  /** The code this implementation reports. Others only have to refuse. */
  error: CryptoErrorCode;
}

interface IdentityVector {
  name: string;
  userId: string;
  /** K_data, hex. */
  dataKey: string;
  kemSeed: string;
  sigSeed: string;
  /** Base64. */
  kemPublic: string;
  sigPublic: string;
  card: string;
  cardId: string;
}

interface SignatureVector {
  name: string;
  what: SignedValue;
  signer: string;
  place: SignedPlace;
  content: string;
  /** Hex of the bytes signed. */
  message: string;
  /** Base64. */
  signature: string;
}

interface SharingVectors {
  projectId: string;
  identities: IdentityVector[];
  safetyNumber: { a: string; b: string; fingerprints: Record<string, string>; number: string };
  calendar: {
    calendarId: string;
    ownerId: string;
    keys: { g: number; ck: string; dataKey: string; reminderKey: string }[];
    idsKey: string;
    rowIds: { label: string; rowId: string }[];
  };
  grant: { place: GrantPlace; generations: number[]; eseed: string; rowSalt: string; sharedSecret: string; plaintext: string; message: string; grant: string };
  roster: { roster: Roster; message: string; text: string };
  signatures: SignatureVector[];
}

interface LoginVector {
  password: string;
  /** Hex of the UTF-8 bytes after NFKC normalisation: what Argon2id is given. */
  passwordBytes: string;
  secretKey: string;
  salt: string;
  pwKey: string;
  root: string;
  authKey: string;
  kek: string;
  kekId: string;
}

interface RecoveryVector {
  recoveryKey: string;
  rkek: string;
  proof: string;
  verifier: string;
}

interface AccountKeysVector {
  accountKey: string;
  dataKey: string;
  reminderKey: string;
  idsKey: string;
}

interface RowIdVector {
  accountKey: string;
  label: string;
  rowId: string;
}

interface VectorFile {
  about: string[];
  protocol: string;
  envelopes: EnvelopeVector[];
  rejects: RejectVector[];
  kdf: { argon2id: { memoryKiB: number; iterations: number; parallelism: number; hashLength: number }; login: LoginVector[]; recovery: RecoveryVector[] };
  accountKeys: AccountKeysVector;
  rowIds: RowIdVector[];
  sharing: SharingVectors;
}

// ---------------------------------------------------------------------------
// The second implementation. It shares no code with the module under test:
// HKDF is written out with createHmac, AES-GCM comes from createCipheriv and
// createDecipheriv, and the padding rule is computed with logarithms instead
// of bit operations.

function refHkdf(ikm: Uint8Array, salt: Uint8Array, info: string | Uint8Array, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let counter = 1; blocks.length * 32 < length; counter++) {
    previous = createHmac('sha256', prk).update(previous).update(info).update(Uint8Array.of(counter)).digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

const NO_SALT = new Uint8Array(0);

function refField(value: string | Uint8Array): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  const out = Buffer.alloc(2 + bytes.length);
  out.writeUInt16BE(bytes.length, 0);
  bytes.copy(out, 2);
  return out;
}

function refAad(header: Uint8Array, ctx: Context): Buffer {
  return Buffer.concat([refField('CAL1'), refField(header), refField(ctx.projectId), refField(ctx.scope), refField(ctx.id), refField(ctx.ownerId)]);
}

function refHeader(kind: number, keyGen = 0): Buffer {
  const header = Buffer.from([1, 1, kind, 1, 0, 0, 0, 0]);
  header.writeUInt32BE(keyGen, 4);
  return header;
}

function refPaddedLength(total: number): number {
  if (total <= 8192) return Math.ceil(total / 512) * 512;
  const e = Math.floor(Math.log2(total));
  const s = Math.floor(Math.log2(e)) + 1;
  const step = 2 ** (e - s);
  return Math.ceil(total / step) * step;
}

function refPad(plaintext: Uint8Array, total = refPaddedLength(4 + plaintext.length)): Buffer {
  const out = Buffer.alloc(total);
  out.writeUInt32BE(plaintext.length, 0);
  out.set(plaintext, 4);
  return out;
}

function refRowKeys(key: Uint8Array, rowSalt: Uint8Array, aad: Uint8Array): { encKey: Buffer; commit: Buffer; nonce: Buffer } {
  const info = Buffer.concat([Buffer.from('cal/v1/row', 'utf8'), createHash('sha256').update(aad).digest()]);
  const okm = refHkdf(key, rowSalt, info, 76);
  return { encKey: okm.subarray(0, 32), commit: okm.subarray(32, 64), nonce: okm.subarray(64, 76) };
}

/** `faults` replaces the header or the padded plaintext, to build envelopes a correct sealer never writes. */
function refSeal(key: Uint8Array, kind: number, ctx: Context, plaintext: Uint8Array, rowSalt: Uint8Array, faults: { header?: number[]; padded?: Uint8Array } = {}, keyGen = 0): string {
  const header = faults.header ? Buffer.from(faults.header) : refHeader(kind, keyGen);
  const aad = refAad(header, ctx);
  const row = refRowKeys(key, rowSalt, aad);
  const cipher = createCipheriv('aes-256-gcm', row.encKey, row.nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(faults.padded ?? refPad(plaintext)), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([header, rowSalt, row.commit, body]).toString('base64');
}

function refOpen(key: Uint8Array, kind: number, ctx: Context, text: string, keyGen = 0): Buffer {
  const envelope = Buffer.from(text, 'base64');
  const header = envelope.subarray(0, 8);
  if (!header.equals(refHeader(kind, keyGen))) throw new Error('header');
  const aad = refAad(header, ctx);
  const row = refRowKeys(key, envelope.subarray(8, 40), aad);
  if (!timingSafeEqual(row.commit, envelope.subarray(40, 72))) throw new Error('commit');
  const decipher = createDecipheriv('aes-256-gcm', row.encKey, row.nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(envelope.subarray(envelope.length - 16));
  const padded = Buffer.concat([decipher.update(envelope.subarray(72, envelope.length - 16)), decipher.final()]);
  const length = padded.readUInt32BE(0);
  if (4 + length > padded.length) throw new Error('length');
  if (padded.subarray(4 + length).some((byte) => byte !== 0)) throw new Error('padding');
  return padded.subarray(4, 4 + length);
}

async function refLogin(password: string, secretKey: string): Promise<Omit<LoginVector, 'password' | 'secretKey'>> {
  const sk = Buffer.from(secretKey, 'ascii');
  const passwordBytes = Buffer.from(password.normalize('NFKC'), 'utf8');
  const salt = refHkdf(sk, NO_SALT, 'cal/v1/kdf-salt', 16);
  const pwKey = Buffer.from(await argon2id({ password: passwordBytes, salt, memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' }));
  const root = refHkdf(Buffer.concat([pwKey, sk]), NO_SALT, 'cal/v1/root', 32);
  const kek = refHkdf(root, NO_SALT, 'cal/v1/kek', 32);
  return {
    passwordBytes: passwordBytes.toString('hex'),
    salt: salt.toString('hex'),
    pwKey: pwKey.toString('hex'),
    root: root.toString('hex'),
    authKey: refHkdf(root, NO_SALT, 'cal/v1/auth', 32).toString('base64url'),
    kek: kek.toString('hex'),
    kekId: refHkdf(kek, NO_SALT, 'cal/v1/kek-id', 8).toString('hex'),
  };
}

function refRecovery(recoveryKey: string): Omit<RecoveryVector, 'recoveryKey'> {
  const rk = Buffer.from(recoveryKey, 'ascii');
  const proof = refHkdf(rk, NO_SALT, 'cal/v1/recovery-proof', 32).toString('base64url');
  return { rkek: refHkdf(rk, NO_SALT, 'cal/v1/rk', 32).toString('hex'), proof, verifier: createHash('sha256').update(proof, 'utf8').digest('hex') };
}

function refAccountKeys(accountKey: string): AccountKeysVector {
  const amk = Buffer.from(accountKey, 'hex');
  return {
    accountKey,
    dataKey: refHkdf(amk, NO_SALT, 'cal/v1/data', 32).toString('hex'),
    reminderKey: refHkdf(amk, NO_SALT, 'cal/v1/reminders', 32).toString('hex'),
    idsKey: refHkdf(amk, NO_SALT, 'cal/v1/ids', 32).toString('hex'),
  };
}

function refRowId(idsKey: string, label: string): string {
  return createHmac('sha256', Buffer.from(idsKey, 'hex')).update(label, 'utf8').digest('hex').slice(0, 32);
}

// Sharing, with node:crypto's Ed25519 and SHA-512 (X-Wing has no second
// implementation here; its own test vectors are the library's).

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function refEdPrivate(seed: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

function refEdPublic(seed: Uint8Array): Buffer {
  return Buffer.from(createPublicKey(refEdPrivate(seed)).export({ format: 'jwk' }).x as string, 'base64url');
}

function refEdSign(seed: Uint8Array, message: Uint8Array): string {
  return edSign(null, message, refEdPrivate(seed)).toString('base64');
}

function refEdVerify(publicKey: Uint8Array, message: Uint8Array, signature: string): boolean {
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey).toString('base64url') }, format: 'jwk' });
  return edVerify(null, message, key, Buffer.from(signature, 'base64'));
}

function refU32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
}

const sha256Of = (text: string) => createHash('sha256').update(text, 'utf8').digest();

function refCardMessage(projectId: string, userId: string, kemPublic: Uint8Array, sigPublic: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from('cal/v1/share/card'), refField(projectId), refField(userId), refField(kemPublic), refField(sigPublic)]);
}

function refGrantMessage(place: GrantPlace, cipherText: Uint8Array, wrapped: string): Buffer {
  return Buffer.concat([Buffer.from('cal/v1/share/grant'), refField(place.projectId), refField(place.calendarId), refField(place.ownerId), refField(place.memberId), refField(cipherText), refField(wrapped)]);
}

function refRosterMessage(projectId: string, body: string): Buffer {
  const bytes = Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from('cal/v1/share/roster'), refField(projectId), refU32(bytes.length), bytes]);
}

function refItemMessage(what: SignedValue, place: SignedPlace, content: string): Buffer {
  const row = what === 'item' ? [refField(place.rowId!)] : [];
  return Buffer.concat([Buffer.from(`cal/v1/share/${what}`), refField(place.projectId), refField(place.calendarId), ...row, refU32(place.generation), sha256Of(content)]);
}

/** One person's half of the safety number. */
function refFingerprint(userId: string, kemPublic: Uint8Array, sigPublic: Uint8Array): string {
  const key = Buffer.concat([sigPublic, kemPublic]);
  let hash = createHash('sha512').update(Buffer.from([0, 0])).update(key).update(userId, 'utf8').update(key).digest();
  for (let i = 1; i < 5200; i++) hash = createHash('sha512').update(hash).update(key).digest();
  let digits = '';
  for (let i = 0; i < 30; i += 5) digits += String(hash.readUIntBE(i, 5) % 100000).padStart(5, '0');
  return digits;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (error === undefined) return 'accepted';
  return error instanceof CryptoError ? error.code : `unexpected ${String(error)}`;
}

// ---------------------------------------------------------------------------
// Generation. Every input is fixed, so the file is reproducible.

const PROJECT = 'calendar';
const OWNER = '66f2a1b3c4d5e6f70812';
const CALENDAR_ROW = 'c7a1f0e2d3b4c5a6978801f2e3d4c5b6';
const OBJECT_ROW = '5f1c0d6b8a9e4c3fb2a17d0e6c4b9a58';
const SETTINGS_ROW = '0b6d2f8a41c9e37d5a10f4b8c62e9d73';
const ACCOUNT_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const SECRET_KEY = 'C10123456789ABCDEFGHJKMNPQRS';
const RECOVERY_KEY = 'R10123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJK';
const PASSWORDS = ['correct horse battery staple', 'Zażółć gęślą jaźń ﬁ ① é'];

/** 32 bytes that depend only on the label. */
function fixed(label: string): Buffer {
  return createHash('sha256').update(`cal/v1 test vector: ${label}`, 'utf8').digest();
}

/** A plaintext of any size whose bytes are easy to recompute. */
function pattern(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);
}

const ABOUT = [
  'Test vectors for encryption protocol v1 of Calendar. Every implementation of the protocol must reproduce them.',
  'Generated by src/lib/crypto/vectors.test.ts (CRYPTO_VECTORS=write); do not edit by hand.',
  'Encodings: "key", "rowSalt", "aad" and the key fields under "kdf" and "accountKeys" are hexadecimal; "plaintext" and "envelope" are standard base64 with padding; "authKey" and "proof" are base64url without padding; other strings are UTF-8 text.',
  'HKDF(ikm, info, len) is HKDF-SHA-256 with an empty salt (the same as a salt of 32 zero bytes) unless a salt is named.',
  'Envelope = header (8) || rowSalt (32) || commit (32) || body. header = [version 1][suite 1][kind][padding scheme 1][key generation u32 BE]; the key generation is 0 unless a vector says otherwise in "keyGen", and a reader refuses any generation but the one it expects.',
  'AAD = F("CAL1") || F(header) || F(projectId) || F(scope) || F(id) || F(ownerId), where F(x) = byte length of x as u16 BE || x and text is UTF-8.',
  'okm = HKDF-SHA-256(ikm = key, salt = rowSalt, info = "cal/v1/row" || SHA-256(AAD), 76 bytes); encKey = okm[0..32], commit = okm[32..64], nonce = okm[64..76].',
  'padded = byte length of the plaintext as u32 BE || plaintext || zero bytes. With L = 4 + length: the padded size is L rounded up to a multiple of 512 while L <= 8192; above, E = floor(log2 L), S = floor(log2 E) + 1, mask = (1 << (E - S)) - 1, size = (L + mask) & ~mask.',
  'body = AES-256-GCM(encKey, nonce, padded, AAD) with the 16-byte tag appended.',
  '"envelopes": sealing "plaintext" under "key" for "kind" and "context" with "rowSalt" gives exactly "envelope", and opening "envelope" gives "plaintext". "plaintextLength", "paddedLength" and "aad" are intermediate values for debugging.',
  '"rejects": opening "envelope" under "key" for "kind" and "context" must fail. "sealed consistently" means the commit and the tag are valid for the faulty content, so only the named check can catch it. "error" is the code of the TypeScript implementation; other implementations only have to refuse.',
  '"kdf.login": salt = HKDF(SK, "cal/v1/kdf-salt", 16); pwKey = Argon2id(passwordBytes, salt) with the parameters in "kdf.argon2id"; root = HKDF(pwKey || SK, "cal/v1/root", 32); authKey = base64url(HKDF(root, "cal/v1/auth", 32)); kek = HKDF(root, "cal/v1/kek", 32); kekId = hex(HKDF(kek, "cal/v1/kek-id", 8)). SK is the ASCII of "secretKey"; "passwordBytes" is the UTF-8 of the password after NFKC normalisation.',
  '"kdf.recovery": rkek = HKDF(RK, "cal/v1/rk", 32); proof = base64url(HKDF(RK, "cal/v1/recovery-proof", 32)); verifier = hex(SHA-256(proof as ASCII)). RK is the ASCII of "recoveryKey".',
  '"accountKeys": dataKey = HKDF(accountKey, "cal/v1/data", 32); reminderKey = HKDF(accountKey, "cal/v1/reminders", 32); idsKey = HKDF(accountKey, "cal/v1/ids", 32).',
  '"rowIds": rowId = the first 32 hexadecimal characters of HMAC-SHA-256(idsKey of "accountKey", label as UTF-8).',
  'Kinds: 1 object, 2 calendar, 3 settings, 4 key wrap, 5 reminder digest, 6 share grant.',
  '"sharing": sharing a calendar between accounts. F(x) as above; u32(n) = n as u32 BE; labels such as "cal/v1/share/card" are UTF-8 without a length; base64 is standard with padding; Ed25519 is RFC 8032 (verified strictly); X-Wing is ML-KEM-768 + X25519 (draft-connolly-cfrg-xwing-kem).',
  '"sharing.identities": kemSeed = HKDF(dataKey, "cal/v1/share/kem", 32), kemPublic = X-Wing public key of kemSeed (1216 bytes); sigSeed = HKDF(dataKey, "cal/v1/share/sig", 32), sigPublic = Ed25519 public key of sigSeed; card = JSON {"v":1,"u":userId,"k":kemPublic,"s":sigPublic,"p":Ed25519(sigSeed, "cal/v1/share/card" || F(projectId) || F(u) || F(kemPublic) || F(sigPublic))}; cardId = hex(SHA-256(kemPublic || sigPublic)).',
  '"sharing.safetyNumber": per person h = SHA-512(0x0000 || key || userId || key), then 5199 times h = SHA-512(h || key), key = sigPublic || kemPublic; the first 30 bytes of h as six 5-byte big-endian numbers mod 100000, five digits each (the fingerprint); the two fingerprints sorted ascending and joined.',
  '"sharing.calendar": per generation g, dataKey = HKDF(ck, "cal/v1/share/data", 32), reminderKey = HKDF(ck, "cal/v1/share/reminders", 32); idsKey = HKDF(ck of generation 0, "cal/v1/share/ids", 32); rowIds as "rowIds" under that idsKey.',
  '"sharing.grant": (ct, sharedSecret) = X-Wing encapsulation to the member\'s kemPublic with the randomness "eseed"; w = the envelope (kind 6, key sharedSecret, rowSalt, context {projectId, "share", calendarId, memberId}) of "plaintext"; "message" = "cal/v1/share/grant" || F(projectId) || F(calendarId) || F(ownerId) || F(memberId) || F(ct) || F(w), signed with the owner\'s sigSeed; grant = JSON {"v","c","o","m","ct","w","sig"}. The member opens it with its kemSeed.',
  '"sharing.roster": text = JSON {"b":body,"sig":Ed25519(owner, "message")}, body = JSON of {"v":1} and "roster" in the order shown, "message" = "cal/v1/share/roster" || F(projectId) || u32(byte length of body) || body.',
  '"sharing.signatures": "message" = "cal/v1/share/<what>" || F(projectId) || F(calendarId) || F(rowId) (for "item" only) || u32(generation) || SHA-256(content); "signature" = Ed25519 of the signer\'s sigSeed over it.',
];

const MEMBER = '7a0b1c2d3e4f50617283';
const FORMER = '9c2d3e4f506172839405';
const SHARED_CALENDAR = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const GRANT_ENVELOPE = 'share grant (kind 6): the keys of "sharing.grant" under its shared secret, context id = calendar id, ownerId = member id';

interface SharingResult {
  section: SharingVectors;
  /** What the envelope vectors of shared rows are made of. */
  item: { key: string; rowId: string; plaintext: Uint8Array };
  digest: { key: string; plaintext: Uint8Array };
}

async function generateSharing(ownerDataKey: string, ics: string, digestJson: string): Promise<SharingResult> {
  const people = [
    { name: 'owner', userId: OWNER, dataKey: ownerDataKey },
    { name: 'member', userId: MEMBER, dataKey: fixed('data key: member').toString('hex') },
  ];
  const identities: IdentityVector[] = [];
  const derived: ShareIdentity[] = [];
  for (const p of people) {
    const identity = await deriveIdentity(fromHex(p.dataKey));
    derived.push(identity);
    identities.push({
      ...p,
      kemSeed: toHex(identity.kemSeed),
      sigSeed: toHex(identity.sigSecret),
      kemPublic: toBase64(identity.kemPublic),
      sigPublic: toBase64(identity.sigPublic),
      card: await makeCard(identity, PROJECT, p.userId),
      cardId: createHash('sha256').update(identity.kemPublic).update(identity.sigPublic).digest('hex'),
    });
  }
  const [owner, member] = derived;
  const ownerCard = await readCard(identities[0].card, PROJECT, OWNER);
  const memberCard = await readCard(identities[1].card, PROJECT, MEMBER);
  const number = await safetyNumber(ownerCard, memberCard);
  const fingerprints = { owner: refFingerprint(OWNER, owner.kemPublic, owner.sigPublic), member: refFingerprint(MEMBER, member.kemPublic, member.sigPublic) };
  expect(number).toBe([fingerprints.owner, fingerprints.member].sort().join(''));

  const cks = [0, 1, 2].map((g) => fixed(`calendar key: generation ${g}`));
  const keys = cks.map((ck, g) => ({ g, ck: ck.toString('hex'), dataKey: refHkdf(ck, NO_SALT, 'cal/v1/share/data', 32).toString('hex'), reminderKey: refHkdf(ck, NO_SALT, 'cal/v1/share/reminders', 32).toString('hex') }));
  const idsKey = refHkdf(cks[0], NO_SALT, 'cal/v1/share/ids', 32).toString('hex');
  expect(toHex(await calendarIdKey(cks[0]))).toBe(idsKey);
  const rowIds = [objectRowLabel(SHARED_CALENDAR, '8d3f2c1e-5a7b-4c9d-9e1f-0a2b3c4d5e6f'), objectRowLabel(SHARED_CALENDAR, 'zażółć-gęślą@example.com')].map((label) => ({ label, rowId: refRowId(idsKey, label) }));

  const place: GrantPlace = { projectId: PROJECT, calendarId: SHARED_CALENDAR, ownerId: OWNER, memberId: MEMBER };
  const eseed = Buffer.concat([fixed('eseed: grant, first half'), fixed('eseed: grant, second half')]);
  const grantSalt = fixed(`rowSalt: ${GRANT_ENVELOPE}`);
  const grantText = await makeGrantWith(owner, place, memberCard, cks.map((k, g) => ({ g, k: Uint8Array.from(k) })), eseed, grantSalt);
  const grant = JSON.parse(grantText) as { ct: string; w: string; sig: string };
  const sharedSecret = Buffer.from(ml_kem768_x25519.decapsulate(fromBase64(grant.ct), member.kemSeed));
  const grantPlaintext = refOpen(sharedSecret, 6, { projectId: PROJECT, scope: 'share', id: SHARED_CALENDAR, ownerId: MEMBER }, grant.w).toString('utf8');
  const grantMessage = refGrantMessage(place, fromBase64(grant.ct), grant.w);
  expect(refEdVerify(owner.sigPublic, grantMessage, grant.sig)).toBe(true);

  const roster: Roster = {
    c: SHARED_CALENDAR,
    o: OWNER,
    n: 4,
    g: 2,
    members: [
      { u: OWNER, r: 'w', s: identities[0].sigPublic, k: identities[0].cardId },
      { u: MEMBER, r: 'w', s: identities[1].sigPublic, k: identities[1].cardId },
    ],
    former: [{ u: FORMER, s: refEdPublic(fixed('sig seed: former member')).toString('base64'), g: 1 }],
    at: 1767600000000,
  };
  const rosterText = await makeRoster(owner, PROJECT, roster);
  const rosterMessage = refRosterMessage(PROJECT, (JSON.parse(rosterText) as { b: string }).b);

  const meta = JSON.stringify({
    name: 'Praca',
    color: '#9171f0',
    description: 'Spotkania i terminy',
    components: ['VEVENT', 'VTODO'],
    people: [
      { u: OWNER, e: 'owner@example.com' },
      { u: MEMBER, e: 'member@example.com', n: 'Ola' },
    ],
  });
  const signed: { name: string; what: SignedValue; signer: ShareIdentity; signerId: string; place: SignedPlace; content: string }[] = [
    { name: 'item: an event written by the member', what: 'item', signer: member, signerId: MEMBER, place: { projectId: PROJECT, calendarId: SHARED_CALENDAR, rowId: rowIds[0].rowId, generation: 2 }, content: ics },
    { name: 'meta: the calendar\'s own row, written by the owner', what: 'meta', signer: owner, signerId: OWNER, place: { projectId: PROJECT, calendarId: SHARED_CALENDAR, generation: 2 }, content: meta },
    { name: 'digest: the reminder digest, written by the owner', what: 'digest', signer: owner, signerId: OWNER, place: { projectId: PROJECT, calendarId: SHARED_CALENDAR, generation: 2 }, content: digestJson },
  ];
  const signatures: SignatureVector[] = [];
  for (const s of signed) {
    signatures.push({ name: s.name, what: s.what, signer: s.signerId, place: s.place, content: s.content, message: refItemMessage(s.what, s.place, s.content).toString('hex'), signature: await signItem(s.signer, s.what, s.place, s.content) });
  }
  const json = (value: unknown): Uint8Array => utf8(JSON.stringify(value));

  return {
    section: {
      projectId: PROJECT,
      identities,
      safetyNumber: { a: OWNER, b: MEMBER, fingerprints, number },
      calendar: { calendarId: SHARED_CALENDAR, ownerId: OWNER, keys, idsKey, rowIds },
      grant: { place, generations: [0, 1, 2], eseed: eseed.toString('hex'), rowSalt: grantSalt.toString('hex'), sharedSecret: sharedSecret.toString('hex'), plaintext: grantPlaintext, message: grantMessage.toString('hex'), grant: grantText },
      roster: { roster, message: rosterMessage.toString('hex'), text: rosterText },
      signatures,
    },
    item: { key: keys[2].dataKey, rowId: rowIds[0].rowId, plaintext: json({ c: SHARED_CALENDAR, d: ics, a: MEMBER, s: signatures[0].signature }) },
    digest: { key: keys[2].reminderKey, plaintext: json({ m: digestJson, a: OWNER, s: signatures[2].signature }) },
  };
}

async function generate(): Promise<VectorFile> {
  const accountKeys = refAccountKeys(ACCOUNT_KEY);
  const amk = fromHex(ACCOUNT_KEY);
  expect(toHex(await exportReminderKey(amk))).toBe(accountKeys.reminderKey);

  const login: LoginVector[] = [];
  for (const password of PASSWORDS) {
    const keys = await deriveLogin(password, SECRET_KEY);
    const reference = await refLogin(password, SECRET_KEY);
    login.push({ password, secretKey: SECRET_KEY, ...reference, authKey: keys.authKey, kek: toHex(keys.kek), kekId: keys.kekId });
  }
  const recoveryKeys = await deriveRecovery(RECOVERY_KEY);
  const recovery: RecoveryVector[] = [{ recoveryKey: RECOVERY_KEY, rkek: toHex(recoveryKeys.rkek), proof: recoveryKeys.proof, verifier: recoveryKeys.verifier }];

  const object = {
    c: CALENDAR_ROW,
    d: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Example//Calendar//EN',
      'BEGIN:VEVENT',
      'UID:8d3f2c1e-5a7b-4c9d-9e1f-0a2b3c4d5e6f',
      'DTSTAMP:20260105T080000Z',
      'DTSTART;TZID=Europe/Warsaw:20260112T090000',
      'DTEND;TZID=Europe/Warsaw:20260112T093000',
      'SUMMARY:Zażółć gęślą jaźń',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
  };
  const calendar = { name: 'Praca', color: '#9171f0', description: 'Spotkania i terminy', components: ['VEVENT', 'VTODO'], order: 1, visible: true };
  const settings = {
    v: 1,
    updatedAt: 1767600000000,
    settings: { language: 'pl', weekStart: 1, theme: 'daylight' },
    generated: [{ id: 'holidays-pl', name: 'Święta', color: '#2d772a', visible: true, order: 2, holidayCountry: 'PL' }],
  };
  const digest = {
    v: 1,
    at: 1767600000000,
    until: 1771488000000,
    items: [
      { k: '8d3f2c1e-5a7b-4c9d-9e1f-0a2b3c4d5e6f|1768204800000|900', t: 1768203900000, title: 'Dentysta', start: 1768204800000, end: 1768206600000, allDay: false, location: 'ul. Długa 5' },
      { k: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b|1768262400000|0', t: 1768262400000, title: 'Zapłacić rachunki', start: 1768262400000, end: 1768348800000, allDay: true, task: true },
    ],
  };
  const json = (value: unknown): Uint8Array => utf8(JSON.stringify(value));
  const row = (scope: string, id: string): Context => ({ projectId: PROJECT, scope, id, ownerId: OWNER });
  const sharing = await generateSharing(accountKeys.dataKey, object.d, JSON.stringify(digest));
  const grant = sharing.section.grant;

  const cases: { name: string; kind: Kind; key: string; context: Context; plaintext: Uint8Array; keyGen?: number }[] = [
    { name: 'object (kind 1): an event, under the data key of "accountKeys"', kind: 1, key: accountKeys.dataKey, context: row('objects', OBJECT_ROW), plaintext: json(object) },
    { name: 'calendar (kind 2): calendar metadata, under the data key', kind: 2, key: accountKeys.dataKey, context: row('calendars', CALENDAR_ROW), plaintext: json(calendar) },
    { name: 'settings (kind 3): the settings row, under the data key', kind: 3, key: accountKeys.dataKey, context: row('settings', SETTINGS_ROW), plaintext: json(settings) },
    { name: 'key wrap (kind 4): the account key in the password slot, under the kek of the first "kdf.login" vector', kind: 4, key: login[0].kek, context: row('prefs', 'pw'), plaintext: amk },
    { name: 'key wrap (kind 4): the account key in the recovery slot, under the rkek of "kdf.recovery"', kind: 4, key: recovery[0].rkek, context: row('prefs', 'rk'), plaintext: amk },
    { name: 'reminder digest (kind 5): under the reminder key of "accountKeys", row id = calendar row id', kind: 5, key: accountKeys.reminderKey, context: row('reminders', CALENDAR_ROW), plaintext: json(digest) },
    { name: 'empty plaintext', kind: 3, key: fixed('key: empty').toString('hex'), context: row('settings', SETTINGS_ROW), plaintext: new Uint8Array(0) },
    { name: 'plaintext ending in zero bytes: only the length prefix tells them from padding', kind: 1, key: fixed('key: zeros').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: Uint8Array.of(1, 2, 3, 0, 0, 0) },
    { name: '507 bytes: one byte short of filling the first 512-byte block', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(507) },
    { name: '508 bytes: fills the first 512-byte block exactly, no padding at all', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(508) },
    { name: '509 bytes: one byte into the second block', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(509) },
    { name: '8188 bytes: the largest plaintext padded in 512-byte steps (8192)', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(8188) },
    { name: '8189 bytes: the smallest plaintext padded with Padme (8704)', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(8189) },
    { name: '20000 bytes: Padme rounding to a multiple of 1024 (20480), which rounding to 512 would get wrong', kind: 1, key: fixed('key: sizes').toString('hex'), context: row('objects', OBJECT_ROW), plaintext: pattern(20000) },
    {
      name: 'context with text outside ASCII: the field lengths count UTF-8 bytes, not characters',
      kind: 2,
      key: fixed('key: unicode').toString('hex'),
      context: { projectId: 'kalendarz-żółw', scope: 'calendars', id: 'wiersz-ąę-📅', ownerId: 'użytkownik-1' },
      plaintext: json({ name: 'Dom', color: '#069c8d', components: ['VEVENT'], order: 0, visible: true }),
    },
    {
      name: 'shared object (kind 1): the event of "sharing.signatures" with its author and signature, under the data key of generation 2 of "sharing.calendar", key generation 2, ownerId = the calendar owner',
      kind: 1,
      key: sharing.item.key,
      context: row('sharedObjects', sharing.item.rowId),
      plaintext: sharing.item.plaintext,
      keyGen: 2,
    },
    {
      name: 'shared reminder digest (kind 5): the digest of "sharing.signatures", signed, under the reminder key of generation 2, key generation 2, row id = calendar id',
      kind: 5,
      key: sharing.digest.key,
      context: row('sharedReminders', SHARED_CALENDAR),
      plaintext: sharing.digest.plaintext,
      keyGen: 2,
    },
    {
      name: 'key generation 4294967294 (0xfffffffe): the header holds an unsigned 32-bit number',
      kind: 2,
      key: fixed('key: generations').toString('hex'),
      context: row('sharedCalendars', SHARED_CALENDAR),
      plaintext: utf8('key generation 4294967294'),
      keyGen: 0xfffffffe,
    },
    {
      name: GRANT_ENVELOPE,
      kind: 6,
      key: grant.sharedSecret,
      context: { projectId: PROJECT, scope: 'share', id: SHARED_CALENDAR, ownerId: MEMBER },
      plaintext: utf8(grant.plaintext),
    },
  ];

  const envelopes: EnvelopeVector[] = [];
  for (const item of cases) {
    const rowSalt = fixed(`rowSalt: ${item.name}`);
    const keyGen = item.keyGen ?? 0;
    const envelope = await sealWithSalt(fromHex(item.key), item.kind, item.context, item.plaintext, rowSalt, keyGen);
    envelopes.push({
      name: item.name,
      kind: item.kind,
      key: item.key,
      rowSalt: rowSalt.toString('hex'),
      context: item.context,
      plaintext: toBase64(item.plaintext),
      plaintextLength: item.plaintext.length,
      paddedLength: paddedLength(item.plaintext.length),
      aad: refAad(refHeader(item.kind, keyGen), item.context).toString('hex'),
      envelope,
      // Only where it is not 0, so that the vectors of generation 0 stay as they were.
      ...(keyGen ? { keyGen } : {}),
    });
  }
  // The grant's envelope is exactly the one in the grant.
  expect(envelopes.at(-1)!.envelope).toBe((JSON.parse(grant.grant) as { w: string }).w);

  // Rejections all start from one valid envelope.
  const key = fixed('key: rejects');
  const keyHex = key.toString('hex');
  const context = row('objects', OBJECT_ROW);
  const message = utf8('attack at dawn');
  const salt = fixed('rowSalt: rejects');
  const valid = await sealWithSalt(key, 1, context, message, salt);
  const changedIn = (text: string, index: number, change: (byte: number) => number): string => {
    const bytes = fromBase64(text);
    bytes[index] = change(bytes[index]);
    return toBase64(bytes);
  };
  const changed = (index: number, change: (byte: number) => number): string => changedIn(valid, index, change);
  const flip = (byte: number): number => byte ^ 1;
  const nonZeroPadding = refPad(message);
  nonZeroPadding[511] = 1;
  const nonZeroAfterData = refPad(message);
  nonZeroAfterData[4 + message.length] = 0x80;
  const prefixTooLarge = refPad(message);
  prefixTooLarge.writeUInt32BE(509, 0);
  const prefixHuge = refPad(message);
  prefixHuge.writeUInt32BE(0xffffffff, 0);

  const base = { kind: 1 as Kind, key: keyHex, context };
  const rejects: RejectVector[] = [
    { name: 'version byte 2, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { header: [2, 1, 1, 1, 0, 0, 0, 0] }), error: 'version' },
    { name: 'suite byte 2, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { header: [1, 2, 1, 1, 0, 0, 0, 0] }), error: 'version' },
    { name: 'padding scheme byte 2, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { header: [1, 1, 1, 2, 0, 0, 0, 0] }), error: 'version' },
    { name: 'non-zero last padding byte, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { padded: nonZeroPadding }), error: 'format' },
    { name: 'non-zero first padding byte, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { padded: nonZeroAfterData }), error: 'format' },
    { name: 'length prefix one byte past the end of the block, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { padded: prefixTooLarge }), error: 'format' },
    { name: 'length prefix 0xffffffff, sealed consistently', ...base, envelope: refSeal(key, 1, context, message, salt, { padded: prefixHuge }), error: 'format' },
    { name: 'a valid envelope of kind 2 where kind 1 is asked for', ...base, envelope: await sealWithSalt(key, 2, context, message, salt), error: 'auth' },
    { name: 'kind byte changed from 1 to 5 after sealing, kind 5 asked for', ...base, kind: 5, envelope: changed(2, () => 5), error: 'auth' },
    { name: 'wrong key', ...base, key: fixed('key: another').toString('hex'), envelope: valid, error: 'auth' },
    { name: 'wrong projectId', ...base, context: { ...context, projectId: 'calendar2' }, envelope: valid, error: 'auth' },
    { name: 'wrong scope', ...base, context: { ...context, scope: 'calendars' }, envelope: valid, error: 'auth' },
    { name: 'wrong id', ...base, context: { ...context, id: CALENDAR_ROW }, envelope: valid, error: 'auth' },
    { name: 'wrong ownerId', ...base, context: { ...context, ownerId: '66f2a1b3c4d5e6f70813' }, envelope: valid, error: 'auth' },
    { name: 'the same characters split differently between scope and id', ...base, context: { ...context, scope: 'object', id: `s${OBJECT_ROW}` }, envelope: valid, error: 'auth' },
    { name: 'one bit changed in the row salt', ...base, envelope: changed(8, flip), error: 'auth' },
    { name: 'one bit changed in the commit', ...base, envelope: changed(71, flip), error: 'auth' },
    { name: 'one bit changed in the ciphertext', ...base, envelope: changed(72, flip), error: 'auth' },
    { name: 'one bit changed in the tag', ...base, envelope: changed(599, flip), error: 'auth' },
    { name: 'key generation changed from 0 to 1 after sealing', ...base, envelope: changed(7, () => 1), error: 'version' },
    { name: 'truncated inside the commit (71 bytes)', ...base, envelope: toBase64(fromBase64(valid).subarray(0, 71)), error: 'format' },
    { name: 'truncated by one byte', ...base, envelope: toBase64(fromBase64(valid).subarray(0, 599)), error: 'format' },
    { name: 'empty text', ...base, envelope: '', error: 'format' },
    { name: 'not base64: one character replaced with an asterisk', ...base, envelope: `${valid.slice(0, 100)}*${valid.slice(101)}`, error: 'format' },
    { name: 'key generation 2, sealed consistently, where generation 0 is expected', ...base, envelope: refSeal(key, 1, context, message, salt, {}, 2), error: 'version' },
    { name: 'key generation 2, sealed consistently, where generation 3 is expected', ...base, keyGen: 3, envelope: refSeal(key, 1, context, message, salt, {}, 2), error: 'version' },
    { name: 'key generation changed from 2 to 3 after sealing, generation 3 expected', ...base, keyGen: 3, envelope: changedIn(refSeal(key, 1, context, message, salt, {}, 2), 7, () => 3), error: 'auth' },
    { name: 'a valid share grant (kind 6) where kind 1 is asked for', ...base, envelope: await sealWithSalt(key, 6, context, message, salt), error: 'auth' },
  ];

  const rowIds: RowIdVector[] = [];
  const keys = await importAccountKeys(amk);
  for (const label of [objectRowLabel(CALENDAR_ROW, '8d3f2c1e-5a7b-4c9d-9e1f-0a2b3c4d5e6f'), SETTINGS_ROW_LABEL, objectRowLabel(CALENDAR_ROW, 'zażółć-gęślą@example.com'), profileRowLabel('phone'), profileRowLabel('computer')]) {
    rowIds.push({ accountKey: ACCOUNT_KEY, label, rowId: await rowId(keys, label) });
  }

  return {
    about: ABOUT,
    protocol: 'cal/v1',
    envelopes,
    rejects,
    kdf: { argon2id: { memoryKiB: 65536, iterations: 3, parallelism: 1, hashLength: 32 }, login, recovery },
    accountKeys,
    rowIds,
    sharing: sharing.section,
  };
}

describe.runIf(WRITE)('vectors.json (writing)', () => {
  it('writes the file', { timeout: 120_000 }, async () => {
    writeFileSync(FILE, `${JSON.stringify(await generate(), null, 2)}\n`);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(WRITE)('vectors.json', () => {
  const vectors = (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { envelopes: [], rejects: [], kdf: { login: [], recovery: [] }, rowIds: [] }) as VectorFile;

  it('is exactly what the generator produces today', { timeout: 120_000 }, async () => {
    expect(existsSync(FILE)).toBe(true);
    // Compared as data, not as text: a checkout may change the line endings.
    expect(vectors).toEqual(JSON.parse(JSON.stringify(await generate())));
  });

  it('covers every kind, the empty plaintext and the padding boundaries', () => {
    expect(vectors.envelopes.length).toBeGreaterThanOrEqual(6);
    expect([...new Set(vectors.envelopes.map((v) => v.kind))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(vectors.envelopes.filter((v) => v.keyGen !== undefined).map((v) => v.keyGen)).toEqual([2, 2, 0xfffffffe]);
    const lengths = vectors.envelopes.map((v) => v.plaintextLength);
    for (const length of [0, 507, 508, 509, 8188, 8189]) expect(lengths).toContain(length);
    expect(Math.max(...lengths)).toBeGreaterThan(16384);
    expect(vectors.kdf.login.length).toBeGreaterThanOrEqual(1);
    expect(vectors.kdf.recovery.length).toBeGreaterThanOrEqual(1);
    expect(vectors.rowIds.length).toBeGreaterThanOrEqual(1);
  });

  it('reproduces every envelope from its inputs and opens it again', async () => {
    // The envelopes are checked side by side: each step is a round trip to
    // WebCrypto's threads, and some 300 of them one after another took more
    // than the test's time on a busy machine (each waits for the scheduler).
    await Promise.all(
      vectors.envelopes.map(async (v) => {
        const key = fromHex(v.key);
        const plaintext = fromBase64(v.plaintext);
        expect(plaintext, v.name).toHaveLength(v.plaintextLength);
        expect(paddedLength(v.plaintextLength), v.name).toBe(v.paddedLength);
        expect(fromBase64(v.envelope), v.name).toHaveLength(72 + v.paddedLength + 16);
        const keyGen = v.keyGen ?? 0;
        expect(await sealWithSalt(key, v.kind, v.context, plaintext, fromHex(v.rowSalt), keyGen), v.name).toBe(v.envelope);
        expect(toHex(await open(key, v.kind, v.context, v.envelope, keyGen)), v.name).toBe(toHex(plaintext));
        // The same with the key as a non-extractable CryptoKey, the form the app holds.
        const cryptoKey = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits']);
        expect(await sealWithSalt(cryptoKey, v.kind, v.context, plaintext, fromHex(v.rowSalt), keyGen), v.name).toBe(v.envelope);
        expect(toHex(await open(cryptoKey, v.kind, v.context, v.envelope, keyGen)), v.name).toBe(toHex(plaintext));
        // A reader that expects another generation refuses it.
        expect(await codeOf(open(key, v.kind, v.context, v.envelope, keyGen === 0 ? 1 : 0)), v.name).toBe('version');
      }),
    );
  });

  it('agrees with the node:crypto implementation on every envelope', () => {
    for (const v of vectors.envelopes) {
      const key = fromHex(v.key);
      const plaintext = fromBase64(v.plaintext);
      const keyGen = v.keyGen ?? 0;
      expect(refAad(refHeader(v.kind, keyGen), v.context).toString('hex'), v.name).toBe(v.aad);
      expect(refPaddedLength(4 + v.plaintextLength), v.name).toBe(v.paddedLength);
      expect(refSeal(key, v.kind, v.context, plaintext, fromHex(v.rowSalt), {}, keyGen), v.name).toBe(v.envelope);
      expect(refOpen(key, v.kind, v.context, v.envelope, keyGen).toString('hex'), v.name).toBe(toHex(plaintext));
    }
  });

  it('refuses every reject vector, in both implementations', async () => {
    expect(vectors.rejects.length).toBeGreaterThanOrEqual(20);
    for (const v of vectors.rejects) {
      expect(await codeOf(open(fromHex(v.key), v.kind, v.context, v.envelope, v.keyGen ?? 0)), v.name).toBe(v.error);
      expect(() => refOpen(fromHex(v.key), v.kind, v.context, v.envelope, v.keyGen ?? 0), v.name).toThrow();
    }
  });

  it('reproduces the sharing identities and cards, and checks them with node:crypto', async () => {
    const s = vectors.sharing;
    expect(s.identities.map((i) => i.userId)).toEqual([OWNER, MEMBER]);
    for (const v of s.identities) {
      const dataKey = fromHex(v.dataKey);
      expect(refHkdf(dataKey, NO_SALT, 'cal/v1/share/kem', 32).toString('hex'), v.name).toBe(v.kemSeed);
      expect(refHkdf(dataKey, NO_SALT, 'cal/v1/share/sig', 32).toString('hex'), v.name).toBe(v.sigSeed);
      expect(refEdPublic(fromHex(v.sigSeed)).toString('base64'), v.name).toBe(v.sigPublic);
      expect(toBase64(ml_kem768_x25519.keygen(fromHex(v.kemSeed)).publicKey), v.name).toBe(v.kemPublic);
      const identity = await deriveIdentity(await crypto.subtle.importKey('raw', dataKey, 'HKDF', false, ['deriveBits']));
      expect({ kemSeed: toHex(identity.kemSeed), sigSeed: toHex(identity.sigSecret), kemPublic: toBase64(identity.kemPublic), sigPublic: toBase64(identity.sigPublic) }).toEqual({
        kemSeed: v.kemSeed,
        sigSeed: v.sigSeed,
        kemPublic: v.kemPublic,
        sigPublic: v.sigPublic,
      });
      expect(await makeCard(identity, s.projectId, v.userId)).toBe(v.card);
      const card = JSON.parse(v.card) as { v: number; u: string; k: string; s: string; p: string };
      expect(card).toEqual({ v: 1, u: v.userId, k: v.kemPublic, s: v.sigPublic, p: card.p });
      const kemPublic = fromBase64(v.kemPublic);
      const sigPublic = fromBase64(v.sigPublic);
      expect(refEdSign(fromHex(v.sigSeed), refCardMessage(s.projectId, v.userId, kemPublic, sigPublic))).toBe(card.p);
      expect(createHash('sha256').update(kemPublic).update(sigPublic).digest('hex')).toBe(v.cardId);
      expect((await readCard(v.card, s.projectId, v.userId)).id).toBe(v.cardId);
    }
  });

  it('reproduces the safety number', async () => {
    const s = vectors.sharing;
    const [owner, member] = await Promise.all(s.identities.map((i) => readCard(i.card, s.projectId, i.userId)));
    expect(refFingerprint(owner.userId, owner.kemPublic, owner.sigPublic)).toBe(s.safetyNumber.fingerprints.owner);
    expect(refFingerprint(member.userId, member.kemPublic, member.sigPublic)).toBe(s.safetyNumber.fingerprints.member);
    expect(s.safetyNumber.number).toBe([s.safetyNumber.fingerprints.owner, s.safetyNumber.fingerprints.member].sort().join(''));
    expect(await safetyNumber(owner, member)).toBe(s.safetyNumber.number);
    expect(await safetyNumber(member, owner)).toBe(s.safetyNumber.number);
  });

  it('reproduces the calendar keys and the row ids of a shared calendar', async () => {
    const c = vectors.sharing.calendar;
    for (const k of c.keys) {
      const ck = fromHex(k.ck);
      expect(refHkdf(ck, NO_SALT, 'cal/v1/share/data', 32).toString('hex')).toBe(k.dataKey);
      expect(refHkdf(ck, NO_SALT, 'cal/v1/share/reminders', 32).toString('hex')).toBe(k.reminderKey);
      const keys = await calendarKeys(ck);
      expect(toHex(keys.remindersRaw)).toBe(k.reminderKey);
      const ctx: Context = { projectId: PROJECT, scope: 'sharedObjects', id: OBJECT_ROW, ownerId: OWNER };
      expect(refOpen(fromHex(k.dataKey), 1, ctx, await seal(keys.data, 1, ctx, utf8('x'), k.g), k.g).toString('utf8')).toBe('x');
    }
    expect(toHex(await calendarIdKey(fromHex(c.keys[0].ck)))).toBe(c.idsKey);
    expect(refHkdf(fromHex(c.keys[0].ck), NO_SALT, 'cal/v1/share/ids', 32).toString('hex')).toBe(c.idsKey);
    for (const r of c.rowIds) expect(refRowId(c.idsKey, r.label)).toBe(r.rowId);
  });

  it('reproduces the grant from its fixed randomness, and the member opens it', async () => {
    const s = vectors.sharing;
    const g = s.grant;
    const [ownerVector, memberVector] = s.identities;
    const owner = await deriveIdentity(fromHex(ownerVector.dataKey));
    const member = await deriveIdentity(fromHex(memberVector.dataKey));
    const ownerCard = await readCard(ownerVector.card, s.projectId, ownerVector.userId);
    const memberCard = await readCard(memberVector.card, s.projectId, memberVector.userId);
    const keys = s.calendar.keys.filter((k) => g.generations.includes(k.g)).map((k) => ({ g: k.g, k: fromHex(k.ck) }));
    expect(await makeGrantWith(owner, g.place, memberCard, keys, fromHex(g.eseed), fromHex(g.rowSalt))).toBe(g.grant);
    const grant = JSON.parse(g.grant) as { v: number; c: string; o: string; m: string; ct: string; w: string; sig: string };
    expect(Object.keys(grant)).toEqual(['v', 'c', 'o', 'm', 'ct', 'w', 'sig']);
    expect({ c: grant.c, o: grant.o, m: grant.m }).toEqual({ c: g.place.calendarId, o: g.place.ownerId, m: g.place.memberId });
    // The decapsulation with the member's seed gives the stored shared secret, which opens w.
    expect(toHex(ml_kem768_x25519.decapsulate(fromBase64(grant.ct), fromHex(memberVector.kemSeed)))).toBe(g.sharedSecret);
    const ctx: Context = { projectId: s.projectId, scope: 'share', id: g.place.calendarId, ownerId: g.place.memberId };
    expect(refOpen(fromHex(g.sharedSecret), 6, ctx, grant.w).toString('utf8')).toBe(g.plaintext);
    expect(JSON.parse(g.plaintext)).toEqual({ v: 1, c: g.place.calendarId, o: g.place.ownerId, keys: keys.map((k) => ({ g: k.g, k: toBase64(k.k) })) });
    expect(refGrantMessage(g.place, fromBase64(grant.ct), grant.w).toString('hex')).toBe(g.message);
    expect(refEdVerify(ownerCard.sigPublic, fromHex(g.message), grant.sig)).toBe(true);
    const opened = await openGrant(member, g.grant, g.place, ownerCard);
    expect(opened.map((k) => ({ g: k.g, k: toHex(k.k) }))).toEqual(keys.map((k) => ({ g: k.g, k: toHex(k.k) })));
  });

  it('reproduces the roster and the author signatures', async () => {
    const s = vectors.sharing;
    const owner = await deriveIdentity(fromHex(s.identities[0].dataKey));
    const member = await deriveIdentity(fromHex(s.identities[1].dataKey));
    const ownerCard = await readCard(s.identities[0].card, s.projectId, OWNER);
    expect(await makeRoster(owner, s.projectId, s.roster.roster)).toBe(s.roster.text);
    const outer = JSON.parse(s.roster.text) as { b: string; sig: string };
    expect(JSON.parse(outer.b)).toEqual({ v: 1, ...s.roster.roster });
    expect(refRosterMessage(s.projectId, outer.b).toString('hex')).toBe(s.roster.message);
    expect(refEdVerify(ownerCard.sigPublic, fromHex(s.roster.message), outer.sig)).toBe(true);
    expect(await readRoster(s.roster.text, { projectId: s.projectId, calendarId: s.roster.roster.c, ownerId: OWNER, ownerCard })).toEqual(s.roster.roster);
    const seeds: Record<string, ShareIdentity> = { [OWNER]: owner, [MEMBER]: member };
    for (const v of s.signatures) {
      expect(refItemMessage(v.what, v.place, v.content).toString('hex'), v.name).toBe(v.message);
      expect(await signItem(seeds[v.signer], v.what, v.place, v.content), v.name).toBe(v.signature);
      expect(refEdSign(seeds[v.signer].sigSecret, fromHex(v.message)), v.name).toBe(v.signature);
      await verifyItem(seeds[v.signer].sigPublic, v.what, v.place, v.content, v.signature);
    }
    // The shared rows among the envelope vectors carry these signatures.
    const item = vectors.envelopes.find((v) => v.context.scope === 'sharedObjects')!;
    expect(JSON.parse(Buffer.from(item.plaintext, 'base64').toString('utf8'))).toMatchObject({ c: s.calendar.calendarId, a: MEMBER, s: s.signatures[0].signature, d: s.signatures[0].content });
    const digestRow = vectors.envelopes.find((v) => v.context.scope === 'sharedReminders')!;
    expect(JSON.parse(Buffer.from(digestRow.plaintext, 'base64').toString('utf8'))).toEqual({ m: s.signatures[2].content, a: OWNER, s: s.signatures[2].signature });
    expect(digestRow.key).toBe(s.calendar.keys[2].reminderKey);
  });

  it('derives the login vectors', { timeout: 60_000 }, async () => {
    for (const v of vectors.kdf.login) {
      const keys = await deriveLogin(v.password, v.secretKey);
      expect({ authKey: keys.authKey, kek: toHex(keys.kek), kekId: keys.kekId }).toEqual({ authKey: v.authKey, kek: v.kek, kekId: v.kekId });
      expect(await refLogin(v.password, v.secretKey)).toEqual({ passwordBytes: v.passwordBytes, salt: v.salt, pwKey: v.pwKey, root: v.root, authKey: v.authKey, kek: v.kek, kekId: v.kekId });
      expect(v.authKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(v.kekId).toMatch(/^[0-9a-f]{16}$/);
    }
    // The second password only differs from its NFKC form in how it is typed.
    expect(vectors.kdf.login.some((v) => Buffer.from(v.password, 'utf8').toString('hex') !== v.passwordBytes)).toBe(true);
  });

  it('derives the recovery vectors', async () => {
    for (const v of vectors.kdf.recovery) {
      const keys = await deriveRecovery(v.recoveryKey);
      expect({ rkek: toHex(keys.rkek), proof: keys.proof, verifier: keys.verifier }).toEqual({ rkek: v.rkek, proof: v.proof, verifier: v.verifier });
      expect(refRecovery(v.recoveryKey)).toEqual({ rkek: v.rkek, proof: v.proof, verifier: v.verifier });
    }
  });

  it('derives the working keys and the row ids', async () => {
    const v = vectors.accountKeys;
    const amk = fromHex(v.accountKey);
    expect(refAccountKeys(v.accountKey)).toEqual(v);
    expect(toHex(await exportReminderKey(amk))).toBe(v.reminderKey);
    // The data and ids keys cannot be exported, so they are checked by what they do.
    const keys = await importAccountKeys(amk);
    const ctx: Context = { projectId: PROJECT, scope: 'objects', id: OBJECT_ROW, ownerId: OWNER };
    const plaintext = utf8('sealed with the working key');
    expect(refOpen(fromHex(v.dataKey), 1, ctx, await seal(keys.data, 1, ctx, plaintext)).toString('hex')).toBe(toHex(plaintext));
    expect(refOpen(fromHex(v.reminderKey), 5, ctx, await seal(keys.reminders, 5, ctx, plaintext)).toString('hex')).toBe(toHex(plaintext));
    for (const id of vectors.rowIds) {
      expect(id.accountKey).toBe(v.accountKey);
      expect(await rowId(keys, id.label), id.label).toBe(id.rowId);
      expect(refRowId(v.idsKey, id.label), id.label).toBe(id.rowId);
    }
  });

  it('ties the key wraps to the derived keys: unwrapping gives the account key back', async () => {
    const login = await deriveLogin(vectors.kdf.login[0].password, vectors.kdf.login[0].secretKey);
    const recovery = await deriveRecovery(vectors.kdf.recovery[0].recoveryKey);
    const wraps = vectors.envelopes.filter((v) => v.kind === 4);
    const pw = wraps.find((v) => v.context.id === 'pw')!;
    const rk = wraps.find((v) => v.context.id === 'rk')!;
    expect(toHex(await open(login.kek, 4, pw.context, pw.envelope))).toBe(vectors.accountKeys.accountKey);
    expect(toHex(await open(recovery.rkek, 4, rk.context, rk.envelope))).toBe(vectors.accountKeys.accountKey);
    // A slot opens only under its own key and its own name.
    expect(await codeOf(open(recovery.rkek, 4, pw.context, pw.envelope))).toBe('auth');
    expect(await codeOf(open(login.kek, 4, rk.context, pw.envelope))).toBe('auth');
  });
});

describe.skipIf(WRITE)('two implementations of the envelope', () => {
  const ctx: Context = { projectId: PROJECT, scope: 'objects', id: OBJECT_ROW, ownerId: OWNER };

  it('produce and open the same envelopes for random inputs', async () => {
    const lengths = [0, 1, 31, 32, 507, 508, 509, 1019, 1020, 1021, 4096, 8187, 8188, 8189, 8700, 8701, 16379, 16380, 16381, 33000, 70000];
    // Side by side, for the reason given above: WebCrypto's round trips one after another are slow on a busy machine.
    await Promise.all(
      lengths.map(async (length, index) => {
        const key = randomBytes(32);
        const salt = randomBytes(32);
        const plaintext = randomBytes(length);
        const kind = ((index % 6) + 1) as Kind;
        // Generation 0 for every third, others spread over the 32 bits.
        const keyGen = index % 3 === 0 ? 0 : Math.imul(index, 0x9e3779b1) >>> 0;
        const place: Context = { ...ctx, id: `row-${index}-ż`, ownerId: `user-${length}` };
        const text = await sealWithSalt(key, kind, place, plaintext, salt, keyGen);
        expect(refSeal(key, kind, place, plaintext, salt, {}, keyGen), `length ${length}`).toBe(text);
        expect(refOpen(key, kind, place, text, keyGen).equals(plaintext), `length ${length}`).toBe(true);
        // And the other direction, with an envelope the module did not write.
        const foreign = refSeal(key, kind, place, plaintext, randomBytes(32), {}, keyGen);
        expect(Buffer.from(await open(key, kind, place, foreign, keyGen)).equals(plaintext), `length ${length}`).toBe(true);
        expect(paddedLength(length), `length ${length}`).toBe(refPaddedLength(4 + length));
      }),
    );
  });

  it('agree on the padded size over a wide range', () => {
    for (let length = 0; length < 2_000_000; length += length < 70_000 ? 1 : 1009) {
      if (paddedLength(length) !== refPaddedLength(4 + length)) expect.fail(`padded size differs for ${length} bytes`);
    }
  });

  it('refuses padding that is longer than the scheme prescribes, even when sealed consistently', async () => {
    const key = fixed('key: strictness');
    const salt = fixed('rowSalt: strictness');
    const message = utf8('attack at dawn');
    // A whole block too many: the prefix is right and every padding byte is zero.
    expect(await codeOf(open(key, 1, ctx, refSeal(key, 1, ctx, message, salt, { padded: refPad(message, 1024) })))).toBe('format');
    // Above 8192 the next size up is a different rounding step.
    const large = pattern(9000);
    expect(await codeOf(open(key, 1, ctx, refSeal(key, 1, ctx, large, salt, { padded: refPad(large, 9728) })))).toBe('format');
    expect(await codeOf(open(key, 1, ctx, refSeal(key, 1, ctx, large, salt, { padded: refPad(large, 9216) })))).toBe('accepted');
    // The length prefix claims less than was sealed: the rest is not zero.
    const shortened = refPad(message);
    shortened.writeUInt32BE(message.length - 1, 0);
    expect(await codeOf(open(key, 1, ctx, refSeal(key, 1, ctx, message, salt, { padded: shortened })))).toBe('format');
  });

  it('refuses a key generation other than 0, even when sealed consistently', async () => {
    const key = fixed('key: strictness');
    const salt = fixed('rowSalt: strictness');
    const text = refSeal(key, 1, ctx, utf8('attack at dawn'), salt, { header: [1, 1, 1, 1, 0, 0, 0, 1] });
    expect(await codeOf(open(key, 1, ctx, text))).toBe('version');
    expect(await codeOf(open(key, 1, ctx, refSeal(key, 1, ctx, utf8('attack at dawn'), salt, { header: [1, 1, 1, 1, 1, 0, 0, 0] })))).toBe('version');
  });

  it('refuses an unknown kind byte even when sealed consistently', async () => {
    const key = fixed('key: strictness');
    const salt = fixed('rowSalt: strictness');
    for (const kind of [0, 7, 255]) {
      const text = refSeal(key, kind, ctx, utf8('attack at dawn'), salt);
      for (const asked of [1, 2, 3, 4, 5, 6] as Kind[]) expect(await codeOf(open(key, asked, ctx, text))).toBe('auth');
    }
  });
});
