// The two secrets a person keeps besides the password. Both are written in
// Crockford base32, which leaves out I, L, O and U so that a key copied by
// hand from paper survives the usual misreadings.
//
//   Secret Key    C1 + 26 characters (130 random bits), made on the device at
//                 sign-up and never uploaded. Shown as C1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX.
//   Recovery Key  R1 + 52 characters (260 random bits), shown once in groups of four.
//
// The key material is the ASCII text of the canonical form (prefix included,
// no separators), so the prefix is bound into everything derived from it.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX_LENGTH = 2;

const SECRET = { prefix: 'C1', length: 26 };
const RECOVERY = { prefix: 'R1', length: 52 };

function generate(kind: { prefix: string; length: number }): string {
  const bytes = crypto.getRandomValues(new Uint8Array(kind.length));
  let out = kind.prefix;
  // 256 is a multiple of 32, so the low five bits of a random byte are an unbiased character.
  for (const byte of bytes) out += ALPHABET[byte & 31];
  bytes.fill(0);
  return out;
}

/** What a person typed, reduced to the characters that can be part of a key. */
function clean(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function parse(input: string, kind: { prefix: string; length: number }): string | null {
  if (typeof input !== 'string') return null;
  const text = clean(input);
  if (text.length !== PREFIX_LENGTH + kind.length || !text.startsWith(kind.prefix)) return null;
  for (let i = PREFIX_LENGTH; i < text.length; i++) {
    if (!ALPHABET.includes(text[i])) return null;
  }
  return text;
}

/** The prefix, then groups of `first` and afterwards `rest` characters, joined with hyphens. */
function group(input: string, first: number, rest: number): string {
  const text = clean(input);
  const parts = [text.slice(0, PREFIX_LENGTH)];
  let at = PREFIX_LENGTH;
  for (let size = first; at < text.length; size = rest) {
    parts.push(text.slice(at, at + size));
    at += size;
  }
  return parts.join('-');
}

/** A new Secret Key in canonical form (28 characters). */
export function generateSecretKey(): string {
  return generate(SECRET);
}

/** A new Recovery Key in canonical form (54 characters). */
export function generateRecoveryKey(): string {
  return generate(RECOVERY);
}

/**
 * The canonical form of a typed or pasted Secret Key, or null when it cannot
 * be one. Case, spaces and separators do not matter; O is read as 0 and I or
 * L as 1.
 */
export function parseSecretKey(input: string): string | null {
  return parse(input, SECRET);
}

/** Same rules as `parseSecretKey`, for the Recovery Key. */
export function parseRecoveryKey(input: string): string | null {
  return parse(input, RECOVERY);
}

/**
 * The form shown to people: `C1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. It does not
 * validate; an incomplete key is grouped as far as it goes, so it can format
 * a field while it is being typed.
 */
export function formatSecretKey(canonical: string): string {
  return group(canonical, 6, 5);
}

/** `R1-XXXX-XXXX-…`, thirteen groups of four. Does not validate either. */
export function formatRecoveryKey(canonical: string): string {
  return group(canonical, 4, 4);
}
