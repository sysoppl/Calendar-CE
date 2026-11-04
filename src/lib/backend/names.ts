// File names for calendar objects, derived from their UID.

/** cyrb53: a fast, well-mixed 53-bit string hash. Not for anything secret. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const MAX_NAME = 120;

/**
 * A name that is safe in a URL path on any server. Characters outside a
 * conservative set become "_"; whenever that (or shortening) changed the UID,
 * a hash of the real one is appended, so "a/b" and "a_b" do not end up in the
 * same file.
 */
export function objectFileName(uid: string): string {
  const safe = uid.replace(/[^A-Za-z0-9._@-]/g, '_');
  if (safe === uid && safe.length > 0 && safe.length <= MAX_NAME) return safe;
  return `${safe.slice(0, MAX_NAME - 12) || 'item'}-${hash(uid)}`;
}
