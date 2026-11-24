import { createHash, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { concat, fromBase64, fromHex, toBase64, toHex, utf8 } from './encoding';
import { KIND, open, openJson, seal, sealJson, type Context } from './envelope';
import { CryptoError, type CryptoErrorCode } from './errors';
import { exportReminderKey, importAccountKeys } from './keys';
import {
  authorKeys,
  calendarIdKey,
  calendarKeys,
  cardId,
  deriveIdentity,
  forgetIdentity,
  generateCalendarKey,
  makeCard,
  makeGrant,
  makeRoster,
  makeWithheldGrant,
  MAX_GRANT_KEYS,
  openGrant,
  readCard,
  readRoster,
  safetyNumber,
  signItem,
  verifyItem,
  type GenerationKey,
  type GrantPlace,
  type Roster,
  type ShareCard,
  type ShareIdentity,
  type SignedPlace,
} from './share';

const PROJECT = 'calendar';
const OWNER = '66f2a1b3c4d5e6f70812';
const MEMBER = '7a0b1c2d3e4f50617283';
const STRANGER = '8b1c2d3e4f5061728394';
const CALENDAR = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const ROW = '5f1c0d6b8a9e4c3fb2a17d0e6c4b9a58';

const amkOf = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n) & 0xff);

/** HKDF-SHA-256 without a salt, from the platform instead of WebCrypto. */
function derive(ikm: Uint8Array, info: string): string {
  return Buffer.from(hkdfSync('sha256', ikm, new Uint8Array(0), info, 32)).toString('hex');
}

async function codeOf(promise: Promise<unknown>): Promise<CryptoErrorCode | 'accepted' | string> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (error === undefined) return 'accepted';
  return error instanceof CryptoError ? error.code : `unexpected ${String(error)}`;
}

interface Person {
  id: string;
  identity: ShareIdentity;
  cardText: string;
  card: ShareCard;
}

async function person(id: string, n: number): Promise<Person> {
  const keys = await importAccountKeys(amkOf(n));
  const identity = await deriveIdentity(keys.data);
  const cardText = await makeCard(identity, PROJECT, id);
  return { id, identity, cardText, card: await readCard(cardText, PROJECT, id) };
}

const owner = await person(OWNER, 1);
const member = await person(MEMBER, 2);
const stranger = await person(STRANGER, 3);

/**
 * A grant made by hand as the format says, signed by `signer`, with whatever
 * keys are given (makeGrant refuses some): for the checks of openGrant.
 */
async function handMadeGrant(signer: ShareIdentity, at: GrantPlace, to: ShareCard, keyList: readonly GenerationKey[]): Promise<string> {
  const { ml_kem768_x25519 } = await import('@noble/post-quantum/hybrid.js');
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(to.kemPublic);
  const ctx: Context = { projectId: at.projectId, scope: 'share', id: at.calendarId, ownerId: at.memberId };
  const plaintext = { v: 1, c: at.calendarId, o: at.ownerId, keys: keyList.map(({ g, k }) => ({ g, k: toBase64(k) })) };
  const w = await seal(Uint8Array.from(sharedSecret), KIND.shareGrant, ctx, utf8(JSON.stringify(plaintext)));
  const f = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? utf8(value) : value;
    return concat(Uint8Array.of(bytes.length >>> 8, bytes.length & 0xff), bytes);
  };
  const message = concat(utf8('cal/v1/share/grant'), f(at.projectId), f(at.calendarId), f(at.ownerId), f(at.memberId), f(cipherText), f(utf8(w)));
  const sig = ed25519.sign(message, signer.sigSecret);
  return JSON.stringify({ v: 1, c: at.calendarId, o: at.ownerId, m: at.memberId, ct: toBase64(cipherText), w, sig: toBase64(sig) });
}

/** The card text with members changed. */
function editCard(text: string, change: (card: Record<string, unknown>) => void): string {
  const card = JSON.parse(text) as Record<string, unknown>;
  change(card);
  return JSON.stringify(card);
}

describe('identity', () => {
  it('is derived from the data key alone, the same from the CryptoKey and from its bytes', async () => {
    const amk = amkOf(1);
    const keys = await importAccountKeys(amk);
    const again = await deriveIdentity((await importAccountKeys(amk.slice())).data);
    const raw = await deriveIdentity(fromHex(derive(amk, 'cal/v1/data')));
    for (const other of [again, raw]) {
      expect(toHex(other.kemSeed)).toBe(toHex(owner.identity.kemSeed));
      expect(toHex(other.sigSecret)).toBe(toHex(owner.identity.sigSecret));
      expect(toHex(other.kemPublic)).toBe(toHex(owner.identity.kemPublic));
      expect(toHex(other.sigPublic)).toBe(toHex(owner.identity.sigPublic));
    }
    expect(owner.identity.kemSeed).toHaveLength(32);
    expect(owner.identity.sigSecret).toHaveLength(32);
    expect(owner.identity.kemPublic).toHaveLength(1216);
    expect(owner.identity.sigPublic).toHaveLength(32);
    // The seeds are HKDF of K_data with their own labels.
    const dataKey = fromHex(derive(amk, 'cal/v1/data'));
    expect(toHex(owner.identity.kemSeed)).toBe(derive(dataKey, 'cal/v1/share/kem'));
    expect(toHex(owner.identity.sigSecret)).toBe(derive(dataKey, 'cal/v1/share/sig'));
    expect(keys.data.extractable).toBe(false);
  });

  it('differs between accounts and from every other key of the account', async () => {
    const amk = amkOf(1);
    const others = [
      derive(amk, 'cal/v1/data'),
      toHex(await exportReminderKey(amk)),
      derive(amk, 'cal/v1/ids'),
      toHex(amk),
      toHex(member.identity.kemSeed),
      toHex(member.identity.sigSecret),
    ];
    const mine = [toHex(owner.identity.kemSeed), toHex(owner.identity.sigSecret)];
    expect(new Set([...mine, ...others]).size).toBe(mine.length + others.length);
    expect(toHex(member.identity.kemPublic)).not.toBe(toHex(owner.identity.kemPublic));
    expect(toHex(member.identity.sigPublic)).not.toBe(toHex(owner.identity.sigPublic));
  });

  it('refuses keys it cannot derive from', async () => {
    const aes = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
    for (const bad of [new Uint8Array(31), new Uint8Array(33), aes, null, 'key']) expect(await codeOf(deriveIdentity(bad as unknown as CryptoKey))).toBe('format');
  });

  it('can be forgotten', async () => {
    const identity = await deriveIdentity(amkOf(9));
    forgetIdentity(identity);
    expect(identity.kemSeed.every((b) => b === 0)).toBe(true);
    expect(identity.sigSecret.every((b) => b === 0)).toBe(true);
    forgetIdentity(undefined);
  });
});

describe('cards', () => {
  it('carry the user id and both public keys, signed by the card itself', async () => {
    const card = JSON.parse(owner.cardText) as Record<string, unknown>;
    expect(Object.keys(card)).toEqual(['v', 'u', 'k', 's', 'p']);
    expect(card).toMatchObject({ v: 1, u: OWNER, k: toBase64(owner.identity.kemPublic), s: toBase64(owner.identity.sigPublic) });
    expect(owner.card.userId).toBe(OWNER);
    expect(toHex(owner.card.kemPublic)).toBe(toHex(owner.identity.kemPublic));
    expect(toHex(owner.card.sigPublic)).toBe(toHex(owner.identity.sigPublic));
    // Ed25519 signs deterministically: the same identity makes the same card.
    expect(await makeCard(owner.identity, PROJECT, OWNER)).toBe(owner.cardText);
  });

  it('have an id that is the SHA-256 of the two public keys', async () => {
    const expected = createHash('sha256').update(owner.identity.kemPublic).update(owner.identity.sigPublic).digest('hex');
    expect(owner.card.id).toBe(expected);
    expect(await cardId(owner.identity)).toBe(expected);
    expect(member.card.id).not.toBe(owner.card.id);
  });

  it('are refused for another person, another project or with a signature that does not hold', async () => {
    expect(await codeOf(readCard(owner.cardText, PROJECT, MEMBER))).toBe('auth');
    expect(await codeOf(readCard(owner.cardText, 'calendar2', OWNER))).toBe('auth');
    // The user id changed to someone else's: the signature covers it.
    expect(await codeOf(readCard(editCard(owner.cardText, (c) => (c.u = MEMBER)), PROJECT, MEMBER))).toBe('auth');
    // Another person's encryption key put into the card (a server swapping keys).
    expect(await codeOf(readCard(editCard(owner.cardText, (c) => (c.k = toBase64(member.identity.kemPublic))), PROJECT, OWNER))).toBe('auth');
    // Another signing key, and its signature over the original content: still not the card's own.
    const forged = editCard(owner.cardText, (c) => {
      c.s = toBase64(member.identity.sigPublic);
    });
    expect(await codeOf(readCard(forged, PROJECT, OWNER))).toBe('auth');
    const signature = fromBase64((JSON.parse(owner.cardText) as { p: string }).p);
    signature[10] ^= 1;
    expect(await codeOf(readCard(editCard(owner.cardText, (c) => (c.p = toBase64(signature))), PROJECT, OWNER))).toBe('auth');
    // A card of another person, made correctly by them, is theirs only.
    expect(await codeOf(readCard(member.cardText, PROJECT, OWNER))).toBe('auth');
  });

  it('are refused when malformed, and as newer when a later version wrote them', async () => {
    const cases: [string, CryptoErrorCode][] = [
      ['', 'format'],
      ['not json', 'format'],
      ['[]', 'format'],
      ['null', 'format'],
      [editCard(owner.cardText, (c) => (c.v = 2)), 'version'],
      [editCard(owner.cardText, (c) => (c.v = '1')), 'format'],
      [editCard(owner.cardText, (c) => delete c.v), 'format'],
      [editCard(owner.cardText, (c) => (c.x = 1)), 'format'],
      [editCard(owner.cardText, (c) => delete c.p), 'format'],
      [editCard(owner.cardText, (c) => (c.k = toBase64(owner.identity.kemPublic.subarray(0, 1215)))), 'format'],
      [editCard(owner.cardText, (c) => (c.s = toBase64(new Uint8Array(33)))), 'format'],
      [editCard(owner.cardText, (c) => (c.p = 'not base64!')), 'format'],
      [editCard(owner.cardText, (c) => (c.u = '')), 'format'],
      [editCard(owner.cardText, (c) => (c.u = 42)), 'format'],
      [owner.cardText + ' '.repeat(5000), 'format'],
    ];
    for (const [text, code] of cases) expect(await codeOf(readCard(text, PROJECT, OWNER)), text.slice(0, 60)).toBe(code);
    expect(await codeOf(readCard(owner.cardText, '', OWNER))).toBe('format');
  });

  it('are made only from a whole identity and real ids', async () => {
    expect(await codeOf(makeCard({ ...owner.identity, kemPublic: new Uint8Array(10) }, PROJECT, OWNER))).toBe('format');
    expect(await codeOf(makeCard(owner.identity, PROJECT, ''))).toBe('format');
    expect(await codeOf(makeCard(owner.identity, '', OWNER))).toBe('format');
  });
});

describe('safety number', () => {
  /** Signal's numeric fingerprint, written out with node:crypto. */
  function half(card: ShareCard): string {
    const key = Buffer.concat([card.sigPublic, card.kemPublic]);
    let hash = createHash('sha512').update(Buffer.from([0, 0])).update(key).update(card.userId, 'utf8').update(key).digest();
    for (let i = 1; i < 5200; i++) hash = createHash('sha512').update(hash).update(key).digest();
    let digits = '';
    for (let i = 0; i < 30; i += 5) digits += String(Number(hash.readUIntBE(i, 5) % 100000)).padStart(5, '0');
    return digits;
  }

  it('is 60 digits, the same from both sides, and the reference construction', async () => {
    const number = await safetyNumber(owner.card, member.card);
    expect(number).toMatch(/^\d{60}$/);
    expect(await safetyNumber(member.card, owner.card)).toBe(number);
    expect(number).toBe([half(owner.card), half(member.card)].sort().join(''));
  });

  it('changes when either card changes', async () => {
    const number = await safetyNumber(owner.card, member.card);
    expect(await safetyNumber(owner.card, stranger.card)).not.toBe(number);
    expect(await safetyNumber(stranger.card, member.card)).not.toBe(number);
    // The same keys under another user id, and one key swapped.
    expect(await safetyNumber({ ...owner.card, userId: STRANGER }, member.card)).not.toBe(number);
    expect(await safetyNumber({ ...owner.card, kemPublic: stranger.card.kemPublic }, member.card)).not.toBe(number);
    expect(await safetyNumber({ ...owner.card, sigPublic: stranger.card.sigPublic }, member.card)).not.toBe(number);
    expect(await safetyNumber(owner.card, { ...member.card, kemPublic: stranger.card.kemPublic })).not.toBe(number);
  });

  it('refuses what is not a card', async () => {
    expect(await codeOf(safetyNumber({ ...owner.card, sigPublic: new Uint8Array(31) }, member.card))).toBe('format');
    expect(await codeOf(safetyNumber(owner.card, null as unknown as ShareCard))).toBe('format');
  });
});

describe('calendar keys', () => {
  it('are 32 random bytes per generation', () => {
    const a = generateCalendarKey();
    expect(a).toHaveLength(32);
    expect(toHex(a)).not.toBe(toHex(generateCalendarKey()));
  });

  it('give the data, reminder and id keys with their own labels', async () => {
    const ck = generateCalendarKey();
    const keys = await calendarKeys(ck);
    const ctx: Context = { projectId: PROJECT, scope: 'sharedObjects', id: ROW, ownerId: OWNER };
    const plaintext = utf8('a shared event');
    expect(toHex(keys.remindersRaw)).toBe(derive(ck, 'cal/v1/share/reminders'));
    expect(await open(fromHex(derive(ck, 'cal/v1/share/data')), 1, ctx, await seal(keys.data, 1, ctx, plaintext, 3), 3)).toEqual(plaintext);
    expect(await open(keys.reminders, 5, ctx, await seal(keys.remindersRaw, 5, ctx, plaintext, 3), 3)).toEqual(plaintext);
    expect(toHex(await calendarIdKey(ck))).toBe(derive(ck, 'cal/v1/share/ids'));
    expect(keys.data.extractable).toBe(false);
    // Neither the calendar key itself nor another generation opens what K_sdata sealed.
    const sealed = await seal(keys.data, 1, ctx, plaintext);
    expect(await codeOf(open(ck, 1, ctx, sealed))).toBe('auth');
    expect(await codeOf(open((await calendarKeys(generateCalendarKey())).data, 1, ctx, sealed))).toBe('auth');
    expect(await codeOf(open(keys.reminders, 1, ctx, sealed))).toBe('auth');
  });

  it('seal values of one generation that another generation number does not open', async () => {
    const keys = await calendarKeys(generateCalendarKey());
    const ctx: Context = { projectId: PROJECT, scope: 'sharedObjects', id: ROW, ownerId: OWNER };
    const text = await sealJson(keys.data, KIND.object, ctx, { c: CALENDAR }, 2);
    expect(await openJson(keys.data, KIND.object, ctx, text, 2)).toEqual({ c: CALENDAR });
    expect(await codeOf(openJson(keys.data, KIND.object, ctx, text, 1))).toBe('version');
    expect(await codeOf(openJson(keys.data, KIND.object, ctx, text))).toBe('version');
    // Sealed for the owner of the calendar: a member's id in its place does not open it.
    expect(await codeOf(openJson(keys.data, KIND.object, { ...ctx, ownerId: MEMBER }, text, 2))).toBe('auth');
  });

  it('refuse a key of the wrong size', async () => {
    for (const length of [0, 16, 31, 33]) {
      expect(await codeOf(calendarKeys(new Uint8Array(length)))).toBe('format');
      expect(await codeOf(calendarIdKey(new Uint8Array(length)))).toBe('format');
    }
  });
});

describe('grants', () => {
  const place: GrantPlace = { projectId: PROJECT, calendarId: CALENDAR, ownerId: OWNER, memberId: MEMBER };
  const keys: GenerationKey[] = [
    { g: 0, k: generateCalendarKey() },
    { g: 1, k: generateCalendarKey() },
  ];

  it('hand every generation to the member, and only to the member', async () => {
    const text = await makeGrant(owner.identity, place, member.card, keys);
    const grant = JSON.parse(text) as Record<string, string | number>;
    expect(Object.keys(grant)).toEqual(['v', 'c', 'o', 'm', 'ct', 'w', 'sig']);
    expect(grant).toMatchObject({ v: 1, c: CALENDAR, o: OWNER, m: MEMBER });
    expect(fromBase64(grant.ct as string)).toHaveLength(1120);
    const opened = await openGrant(member.identity, text, place, owner.card);
    expect(opened.map((k) => [k.g, toHex(k.k)])).toEqual(keys.map((k) => [k.g, toHex(k.k)]));
    // Not a key in sight in the text.
    for (const key of keys) expect(text).not.toContain(toBase64(key.k));
    // Another identity cannot open it, even when it claims to be the member.
    expect(await codeOf(openGrant(stranger.identity, text, place, owner.card))).toBe('auth');
    expect(await codeOf(openGrant(owner.identity, text, place, owner.card))).toBe('auth');
  });

  it('are made fresh every time', async () => {
    const a = JSON.parse(await makeGrant(owner.identity, place, member.card, keys)) as Record<string, string>;
    const b = JSON.parse(await makeGrant(owner.identity, place, member.card, keys)) as Record<string, string>;
    expect(a.ct).not.toBe(b.ct);
    expect(a.w).not.toBe(b.w);
  });

  it('can be withheld: a grant in the right form, signed by the owner, that nobody can open', async () => {
    const text = await makeWithheldGrant(owner.identity, place);
    const grant = JSON.parse(text) as Record<string, string | number>;
    // The same form as any grant (what the server checks of one), for the member named.
    expect(Object.keys(grant)).toEqual(['v', 'c', 'o', 'm', 'ct', 'w', 'sig']);
    expect(grant).toMatchObject({ v: 1, c: CALENDAR, o: OWNER, m: MEMBER });
    expect(fromBase64(grant.ct as string)).toHaveLength(1120);
    // The member's app sees the owner's signature but cannot open it, nor can anybody else.
    for (const who of [member, owner, stranger]) expect(await codeOf(openGrant(who.identity, text, place, owner.card))).toBe('auth');
    // Each one is new.
    expect(JSON.parse(await makeWithheldGrant(owner.identity, place)).ct).not.toBe(grant.ct);
    // Made only for a real place.
    expect(await codeOf(makeWithheldGrant(owner.identity, { ...place, memberId: '' }))).toBe('format');
  });

  it('work for the owner, as a grant to the owner\'s other devices', async () => {
    const own = { ...place, memberId: OWNER };
    const text = await makeGrant(owner.identity, own, owner.card, keys);
    expect((await openGrant(owner.identity, text, own, owner.card)).map((k) => k.g)).toEqual([0, 1]);
    expect(await codeOf(openGrant(owner.identity, text, place, owner.card))).toBe('auth');
  });

  it('are refused for another member, calendar or owner', async () => {
    const text = await makeGrant(owner.identity, place, member.card, keys);
    expect(await codeOf(openGrant(member.identity, text, { ...place, memberId: STRANGER }, owner.card))).toBe('auth');
    expect(await codeOf(openGrant(member.identity, text, { ...place, calendarId: 'ffffffffffffffffffffffffffffffff' }, owner.card))).toBe('auth');
    expect(await codeOf(openGrant(member.identity, text, { ...place, ownerId: STRANGER }, stranger.card))).toBe('auth');
    expect(await codeOf(openGrant(member.identity, text, { ...place, projectId: 'calendar2' }, owner.card))).toBe('auth');
    // The fields of the grant changed to fit another place: the signature covers them.
    const moved = JSON.stringify({ ...JSON.parse(text), c: 'ffffffffffffffffffffffffffffffff' });
    expect(await codeOf(openGrant(member.identity, moved, { ...place, calendarId: 'ffffffffffffffffffffffffffffffff' }, owner.card))).toBe('auth');
  });

  it('are refused when signed by someone else than the owner', async () => {
    // Someone (the server, or a member) makes a grant in the owner's name with keys of their own.
    const forged = await makeGrant(stranger.identity, place, member.card, [{ g: 0, k: generateCalendarKey() }]);
    expect(await codeOf(openGrant(member.identity, forged, place, owner.card))).toBe('auth');
    // The owner's card must be the owner's.
    const text = await makeGrant(owner.identity, place, member.card, keys);
    expect(await codeOf(openGrant(member.identity, text, place, stranger.card))).toBe('auth');
    expect(await codeOf(openGrant(member.identity, text, place, member.card))).toBe('auth');
  });

  it('are refused when any part was changed', async () => {
    const text = await makeGrant(owner.identity, place, member.card, keys);
    const grant = JSON.parse(text) as Record<string, string>;
    const other = JSON.parse(await makeGrant(owner.identity, place, member.card, keys)) as Record<string, string>;
    const flip = (b64: string, at: number) => {
      const bytes = fromBase64(b64);
      bytes[at] ^= 1;
      return toBase64(bytes);
    };
    const changed = [
      { ...grant, ct: flip(grant.ct, 0) },
      { ...grant, ct: flip(grant.ct, 1119) },
      { ...grant, w: flip(grant.w, 100) },
      { ...grant, sig: flip(grant.sig, 5) },
      // Halves of two genuine grants put together.
      { ...grant, ct: other.ct },
      { ...grant, w: other.w },
    ];
    for (const c of changed) expect(await codeOf(openGrant(member.identity, JSON.stringify(c), place, owner.card))).toBe('auth');
  });

  it('are refused when malformed or newer', async () => {
    const grant = JSON.parse(await makeGrant(owner.identity, place, member.card, keys)) as Record<string, unknown>;
    const cases: [unknown, CryptoErrorCode][] = [
      [{ ...grant, v: 2 }, 'version'],
      [{ ...grant, extra: 1 }, 'format'],
      [{ ...grant, ct: toBase64(new Uint8Array(1119)) }, 'format'],
      [{ ...grant, sig: 'AAAA' }, 'format'],
      [{ ...grant, w: 42 }, 'format'],
      [{ ...grant, c: '' }, 'format'],
    ];
    for (const [value, code] of cases) expect(await codeOf(openGrant(member.identity, JSON.stringify(value), place, owner.card))).toBe(code);
    expect(await codeOf(openGrant(member.identity, 'x'.repeat(9000), place, owner.card))).toBe('format');
  });

  it('keep generation 0 and the newest 63 others, in order, each once', async () => {
    const many = Array.from({ length: 70 }, (_, g) => ({ g, k: generateCalendarKey() })).reverse();
    const text = await makeGrant(owner.identity, place, member.card, many);
    const opened = await openGrant(member.identity, text, place, owner.card);
    expect(opened).toHaveLength(MAX_GRANT_KEYS);
    // Generation 0 names the object rows (calendarIdKey), so it is never dropped; 1 to 6 are.
    expect(opened.map((k) => k.g)).toEqual([0, ...Array.from({ length: 63 }, (_, i) => i + 7)]);
    expect(toHex(opened[0].k)).toBe(toHex(many.find((k) => k.g === 0)!.k));
    // Exactly 64 are all kept.
    const exactly = Array.from({ length: MAX_GRANT_KEYS }, (_, g) => ({ g, k: generateCalendarKey() }));
    expect((await openGrant(member.identity, await makeGrant(owner.identity, place, member.card, exactly), place, owner.card)).map((k) => k.g)).toEqual(exactly.map((k) => k.g));
    expect(await codeOf(makeGrant(owner.identity, place, member.card, [keys[0], keys[0]]))).toBe('format');
    expect(await codeOf(makeGrant(owner.identity, place, member.card, []))).toBe('format');
    expect(await codeOf(makeGrant(owner.identity, place, member.card, [{ g: -1, k: keys[0].k }]))).toBe('format');
    expect(await codeOf(makeGrant(owner.identity, place, member.card, [{ g: 0, k: new Uint8Array(16) }]))).toBe('format');
  });

  it('are not made without generation 0', async () => {
    expect(await codeOf(makeGrant(owner.identity, place, member.card, [keys[1]]))).toBe('format');
    expect(await codeOf(makeGrant(owner.identity, place, member.card, Array.from({ length: 70 }, (_, i) => ({ g: i + 1, k: generateCalendarKey() }))))).toBe('format');
  });

  it('are refused when opened without generation 0, even when the owner signed them', async () => {
    // Made by hand, as makeGrant would not make it.
    const good = await handMadeGrant(owner.identity, place, member.card, keys);
    expect((await openGrant(member.identity, good, place, owner.card)).map((k) => k.g)).toEqual([0, 1]);
    const withoutZero = await handMadeGrant(owner.identity, place, member.card, [keys[1], { g: 2, k: generateCalendarKey() }]);
    expect(await codeOf(openGrant(member.identity, withoutZero, place, owner.card))).toBe('format');
    const tooMany = await handMadeGrant(owner.identity, place, member.card, Array.from({ length: MAX_GRANT_KEYS + 1 }, (_, g) => ({ g, k: generateCalendarKey() })));
    expect(await codeOf(openGrant(member.identity, tooMany, place, owner.card))).toBe('format');
  });

  it('fit their size limit at the most keys, the largest generations and the longest ids', async () => {
    const longPlace = { projectId: PROJECT, calendarId: CALENDAR, ownerId: 'o'.repeat(36), memberId: 'm'.repeat(36) };
    const longMember = { ...member.card, userId: longPlace.memberId };
    // Generation 0 and the 63 largest generations there can be.
    const top = [{ g: 0, k: generateCalendarKey() }, ...Array.from({ length: MAX_GRANT_KEYS - 1 }, (_, i) => ({ g: 0xffffffff - i, k: generateCalendarKey() }))];
    const text = await makeGrant(owner.identity, longPlace, longMember, top);
    expect(text.length).toBeLessThanOrEqual(8192);
    const opened = await openGrant(member.identity, text, longPlace, { ...owner.card, userId: longPlace.ownerId });
    expect(opened).toHaveLength(MAX_GRANT_KEYS);
    expect([opened[0].g, opened[1].g, opened.at(-1)!.g]).toEqual([0, 0xffffffff - 62, 0xffffffff]);
  });

  it('are made only for the card of the member named', async () => {
    expect(await codeOf(makeGrant(owner.identity, place, stranger.card, keys))).toBe('format');
    expect(await codeOf(makeGrant(owner.identity, { ...place, calendarId: '' }, member.card, keys))).toBe('format');
  });

  it('seal the keys as kind 6, which no other kind opens', async () => {
    const grant = JSON.parse(await makeGrant(owner.identity, place, member.card, keys)) as Record<string, string>;
    const header = fromBase64(grant.w).subarray(0, 8);
    expect(Array.from(header)).toEqual([1, 1, 6, 1, 0, 0, 0, 0]);
    // A sealed grant offered where an object row is expected, under the same key and place.
    const key = generateCalendarKey();
    const ctx: Context = { projectId: PROJECT, scope: 'share', id: CALENDAR, ownerId: MEMBER };
    const wrapped = await seal(key, KIND.shareGrant, ctx, utf8('{}'));
    expect(await codeOf(open(key, KIND.object, ctx, wrapped))).toBe('auth');
    expect(await codeOf(open(key, KIND.shareGrant, ctx, await seal(key, KIND.object, ctx, utf8('{}'))))).toBe('auth');
  });
});

describe('rosters', () => {
  const roster: Roster = {
    c: CALENDAR,
    o: OWNER,
    n: 3,
    g: 1,
    members: [
      { u: OWNER, r: 'w', s: toBase64(owner.card.sigPublic), k: owner.card.id },
      { u: MEMBER, r: 'r', s: toBase64(member.card.sigPublic), k: member.card.id },
    ],
    // The stranger wrote until they were removed when generation 1 began.
    former: [{ u: STRANGER, s: toBase64(stranger.card.sigPublic), g: 1 }],
    at: 1767600000000,
  };
  const expectation = { projectId: PROJECT, calendarId: CALENDAR, ownerId: OWNER, ownerCard: owner.card };

  it('round-trip, signed by the owner', async () => {
    const text = await makeRoster(owner.identity, PROJECT, roster);
    const outer = JSON.parse(text) as { b: string; sig: string };
    expect(Object.keys(outer)).toEqual(['b', 'sig']);
    expect(JSON.parse(outer.b)).toEqual({ v: 1, ...roster });
    expect(Object.keys(JSON.parse(outer.b) as object)).toEqual(['v', 'c', 'o', 'n', 'g', 'members', 'former', 'at']);
    expect(await readRoster(text, expectation)).toEqual(roster);
    expect(await readRoster(text, { ...expectation, minVersion: 3 })).toEqual(roster);
  });

  it('are refused with a wrong signature, another owner or calendar, or an older version', async () => {
    const text = await makeRoster(owner.identity, PROJECT, roster);
    expect(await codeOf(readRoster(await makeRoster(stranger.identity, PROJECT, roster), expectation))).toBe('auth');
    expect(await codeOf(readRoster(text, { ...expectation, ownerCard: stranger.card }))).toBe('auth');
    expect(await codeOf(readRoster(text, { ...expectation, projectId: 'calendar2' }))).toBe('auth');
    expect(await codeOf(readRoster(text, { ...expectation, calendarId: 'ffffffffffffffffffffffffffffffff' }))).toBe('auth');
    expect(await codeOf(readRoster(await makeRoster(owner.identity, PROJECT, { ...roster, c: 'ffffffffffffffffffffffffffffffff' }), expectation))).toBe('auth');
    expect(await codeOf(readRoster(text, { ...expectation, minVersion: 4 }))).toBe('auth');
    // The body changed after signing: a member made a writer.
    const outer = JSON.parse(text) as { b: string; sig: string };
    const promoted = JSON.stringify({ b: outer.b.replace('"r":"r"', '"r":"w"'), sig: outer.sig });
    expect(promoted).not.toBe(text);
    expect(await codeOf(readRoster(promoted, expectation))).toBe('auth');
  });

  it('are refused when malformed or too large', async () => {
    const text = await makeRoster(owner.identity, PROJECT, roster);
    expect(await codeOf(readRoster('{}', expectation))).toBe('format');
    expect(await codeOf(readRoster(JSON.stringify({ ...JSON.parse(text), x: 1 }), expectation))).toBe('format');
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ u: `user${i}`, r: 'r' as const, s: toBase64(member.card.sigPublic), k: member.card.id }));
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, members: tooMany }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, members: [roster.members[1], roster.members[1]] }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, members: [{ ...roster.members[1], r: 'x' as 'r' }] }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, members: [{ ...roster.members[1], s: 'AAAA' }] }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, members: [{ ...roster.members[1], k: 'abc' }] }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, n: -1 }))).toBe('format');
    expect(await codeOf(makeRoster(owner.identity, PROJECT, { ...roster, former: Array.from({ length: 51 }, () => roster.former[0]) }))).toBe('format');
  });

  it('fit their size limit at the most members and former members, with the longest ids', async () => {
    const id = (prefix: string, i: number) => `${prefix}${i}`.padEnd(36, 'x');
    const s = toBase64(member.card.sigPublic);
    const full: Roster = {
      ...roster,
      o: id('o', 0),
      n: Number.MAX_SAFE_INTEGER,
      g: 0xffffffff,
      members: Array.from({ length: 20 }, (_, i) => ({ u: id('m', i), r: 'w' as const, s, k: member.card.id })),
      former: Array.from({ length: 50 }, (_, i) => ({ u: id('f', i), s, g: 0xffffffff })),
      at: Number.MAX_SAFE_INTEGER,
    };
    const text = await makeRoster(owner.identity, PROJECT, full);
    expect(text.length).toBeLessThanOrEqual(16384);
    expect(await readRoster(text, { ...expectation, ownerId: full.o, ownerCard: { ...owner.card, userId: full.o } })).toEqual(full);
  });

  it('name whose signatures count for a value of a generation', () => {
    const at = (id: string, g: number) => authorKeys(roster, owner.card, id, g).map(toHex);
    expect(at(OWNER, 5)).toContain(toHex(owner.card.sigPublic));
    // The member reads only.
    expect(at(MEMBER, 0)).toEqual([]);
    // The stranger's writes count up to generation 0, not from 1 on.
    expect(at(STRANGER, 0)).toEqual([toHex(stranger.card.sigPublic)]);
    expect(at(STRANGER, 1)).toEqual([]);
    expect(at('nobody', 0)).toEqual([]);
    const writer = { ...roster, members: [{ ...roster.members[1], r: 'w' as const }] };
    expect(authorKeys(writer, owner.card, MEMBER, 7).map(toHex)).toEqual([toHex(member.card.sigPublic)]);
  });
});

describe('author signatures', () => {
  const item: SignedPlace = { projectId: PROJECT, calendarId: CALENDAR, rowId: ROW, generation: 2 };
  const meta: SignedPlace = { projectId: PROJECT, calendarId: CALENDAR, generation: 2 };
  const ics = 'BEGIN:VCALENDAR\r\nSUMMARY:Zażółć\r\nEND:VCALENDAR\r\n';

  it('verify for the author, over exactly this row, generation and content', async () => {
    const signature = await signItem(member.identity, 'item', item, ics);
    expect(fromBase64(signature)).toHaveLength(64);
    await verifyItem(member.card.sigPublic, 'item', item, ics, signature);
    await verifyItem([owner.card.sigPublic, member.card.sigPublic], 'item', item, ics, signature);
    const refused: [Uint8Array | Uint8Array[], 'item' | 'meta' | 'digest', SignedPlace, string][] = [
      [owner.card.sigPublic, 'item', item, ics],
      [[], 'item', item, ics],
      [member.card.sigPublic, 'item', { ...item, rowId: 'ffffffffffffffffffffffffffffffff' }, ics],
      [member.card.sigPublic, 'item', { ...item, generation: 1 }, ics],
      [member.card.sigPublic, 'item', { ...item, generation: 3 }, ics],
      [member.card.sigPublic, 'item', { ...item, calendarId: 'ffffffffffffffffffffffffffffffff' }, ics],
      [member.card.sigPublic, 'item', { ...item, projectId: 'calendar2' }, ics],
      [member.card.sigPublic, 'item', item, ics.replace('Zażółć', 'Zazolc')],
      [member.card.sigPublic, 'item', item, ''],
    ];
    for (const [keys, what, place, content] of refused) expect(await codeOf(verifyItem(keys, what, place, content, signature))).toBe('auth');
  });

  it('keep items, the calendar\'s own row and the digest apart', async () => {
    const forMeta = await signItem(owner.identity, 'meta', meta, '{"name":"Praca"}');
    await verifyItem(owner.card.sigPublic, 'meta', meta, '{"name":"Praca"}', forMeta);
    expect(await codeOf(verifyItem(owner.card.sigPublic, 'digest', meta, '{"name":"Praca"}', forMeta))).toBe('auth');
    const forDigest = await signItem(owner.identity, 'digest', meta, '{"v":1}');
    await verifyItem(owner.card.sigPublic, 'digest', meta, '{"v":1}', forDigest);
    expect(await codeOf(verifyItem(owner.card.sigPublic, 'meta', meta, '{"v":1}', forDigest))).toBe('auth');
    // An item needs its row, the other two must not name one.
    expect(await codeOf(signItem(owner.identity, 'item', meta, ics))).toBe('format');
    expect(await codeOf(signItem(owner.identity, 'meta', item, ics))).toBe('format');
    expect(await codeOf(signItem(owner.identity, 'other' as 'item', item, ics))).toBe('format');
  });

  it('are refused when not a signature at all', async () => {
    expect(await codeOf(verifyItem(member.card.sigPublic, 'item', item, ics, 'AAAA'))).toBe('format');
    expect(await codeOf(verifyItem(member.card.sigPublic, 'item', item, ics, toBase64(new Uint8Array(64))))).toBe('auth');
    expect(await codeOf(verifyItem(member.card.sigPublic, 'item', { ...item, generation: -1 }, ics, toBase64(new Uint8Array(64))))).toBe('format');
  });

  it('come out the same for the same input (Ed25519 is deterministic)', async () => {
    expect(await signItem(member.identity, 'item', item, ics)).toBe(await signItem(member.identity, 'item', item, ics));
  });
});
