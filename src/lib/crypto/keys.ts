// The account master key (AMK) and the working keys cut from it.
//
//   K_data = HKDF(AMK, "cal/v1/data", 32)        calendars, events, tasks and settings
//   K_rem  = HKDF(AMK, "cal/v1/reminders", 32)   reminder digests
//   K_ids  = HKDF(AMK, "cal/v1/ids", 32)         HMAC key for deterministic row ids
//
// The AMK itself exists as bytes only while it is being wrapped or unwrapped.
// What the app keeps are the three working keys as non-extractable
// CryptoKeys: a script running in the page can use them while it runs, but it
// cannot read them out and take them away.
import { toHex, utf8, wipe, type Bytes } from './encoding';
import { CryptoError } from './errors';
import { hkdf, hkdfKey, hmac, hmacKey, randomBytes } from './primitives';

const KEY_LENGTH = 32;
const ROW_ID_BYTES = 16;

/** The label of the settings row, for `rowId`: the settings that are the same on every device of the account. */
export const SETTINGS_ROW_LABEL = 'settings';

/**
 * The label of the row that holds the look and layout of one kind of device
 * (`settings\nphone`, `settings\ncomputer`), for `rowId`.
 */
export function profileRowLabel(profile: 'phone' | 'computer'): string {
  return `${SETTINGS_ROW_LABEL}\n${profile}`;
}

/**
 * The label of the row that holds the default notifications of the account's
 * calendars (`settings\ncalendars`), for `rowId`.
 */
export const CALENDAR_ALARMS_ROW_LABEL = `${SETTINGS_ROW_LABEL}\ncalendars`;

/**
 * The label of the row that holds the profile picture, end-to-end encrypted
 * (`settings\npicture`), for `rowId`.
 */
export const PICTURE_ROW_LABEL = `${SETTINGS_ROW_LABEL}\npicture`;

export interface AccountKeys {
  /** HKDF base key for `seal`/`open` of calendars, objects and settings. */
  data: CryptoKey;
  /** HKDF base key for `seal`/`open` of reminder digests. */
  reminders: CryptoKey;
  /** HMAC key for `rowId`. */
  ids: CryptoKey;
}

function checked(amk: Uint8Array): Uint8Array {
  if (!ArrayBuffer.isView(amk) || amk.byteLength !== KEY_LENGTH) throw new CryptoError('format', 'The account key must be 32 bytes');
  return amk;
}

/** A new account master key: 32 random bytes. Overwrite them once wrapped and imported. */
export function generateAccountKey(): Bytes {
  return randomBytes(KEY_LENGTH);
}

/** The working keys of an account. The AMK is left as it is: the caller owns it. */
export async function importAccountKeys(amk: Uint8Array): Promise<AccountKeys> {
  const base = await hkdfKey(checked(amk));
  let data: Bytes | undefined;
  let reminders: Bytes | undefined;
  let ids: Bytes | undefined;
  try {
    data = await hkdf(base, 'cal/v1/data', KEY_LENGTH);
    reminders = await hkdf(base, 'cal/v1/reminders', KEY_LENGTH);
    ids = await hkdf(base, 'cal/v1/ids', KEY_LENGTH);
    return { data: await hkdfKey(data), reminders: await hkdfKey(reminders), ids: await hmacKey(ids) };
  } finally {
    wipe(data, reminders, ids);
  }
}

/**
 * K_rem as raw bytes, for the Android bridge: native code opens the reminder
 * digests itself while the WebView is not running. Nothing else may leave in
 * raw form.
 */
export async function exportReminderKey(amk: Uint8Array): Promise<Bytes> {
  return hkdf(checked(amk), 'cal/v1/reminders', KEY_LENGTH);
}

/**
 * A row id that only the account can compute: the first 32 hexadecimal
 * characters of HMAC-SHA-256(K_ids, label). The same object always lands in
 * the same row, which makes an import safe to repeat.
 */
export async function rowId(keys: AccountKeys, label: string): Promise<string> {
  const mac = await hmac(keys.ids, utf8(label));
  return toHex(mac.subarray(0, ROW_ID_BYTES));
}

/** The `rowId` label of a calendar object. */
export function objectRowLabel(calendarRowId: string, uid: string): string {
  return `obj\n${calendarRowId}\n${uid}`;
}

/** 32 random hexadecimal characters, the id of a new calendar row. */
export function randomRowId(): string {
  return toHex(randomBytes(ROW_ID_BYTES));
}
