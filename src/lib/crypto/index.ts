// End-to-end encryption of the hosted edition (protocol v1), published so that
// anyone can check how the hosted cloud encrypts data: docs/ENCRYPTION.md
// describes it, vectors.json pins it byte for byte. The self-hosted edition
// itself keeps data on the device or a CalDAV server and does not call it.
//
// Nothing in this folder imports from stores or the interface, and nothing
// here talks to the network: it turns secrets into keys and values into
// envelopes.
//
// `sealWithSalt` and `makeGrantWith` are deliberately not exported from here;
// tests and the vector generator import them from './envelope' and './share'.
// The libraries of share.ts are loaded only when one of its functions is called.
export { generateSecretKey, generateRecoveryKey, parseSecretKey, parseRecoveryKey, formatSecretKey, formatRecoveryKey } from './secrets';
export { deriveLogin, deriveRecovery } from './kdf';
export type { LoginKeys, RecoveryKeys } from './kdf';
export { generateAccountKey, importAccountKeys, exportReminderKey, rowId, objectRowLabel, randomRowId, SETTINGS_ROW_LABEL } from './keys';
export type { AccountKeys } from './keys';
export { seal, open, sealJson, openJson, keyGenOf, paddedLength, sealedLength, KIND, MAX_KEY_GENERATION, MAX_PLAINTEXT_BYTES } from './envelope';
export type { Kind, Context } from './envelope';
export {
  deriveIdentity,
  forgetIdentity,
  makeCard,
  readCard,
  cardId,
  safetyNumber,
  generateCalendarKey,
  calendarKeys,
  calendarIdKey,
  makeGrant,
  makeWithheldGrant,
  openGrant,
  makeRoster,
  readRoster,
  authorKeys,
  signItem,
  verifyItem,
  MAX_GRANT_KEYS,
  MAX_ROSTER_MEMBERS,
  MAX_ROSTER_FORMER,
  MAX_CARD_LENGTH,
  MAX_GRANT_LENGTH,
  MAX_ROSTER_LENGTH,
} from './share';
export type { ShareIdentity, ShareCard, CalendarKeys, GenerationKey, GrantPlace, Roster, RosterMember, RosterFormer, RosterExpectation, SignedValue, SignedPlace } from './share';
export { CryptoError, KdfError } from './errors';
export type { CryptoErrorCode } from './errors';
export { toBase64, fromBase64, toBase64Url, fromBase64Url, toHex, fromHex, utf8, fromUtf8, concat, wipe } from './encoding';
export type { Bytes } from './encoding';
