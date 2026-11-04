import { describe, expect, it } from 'vitest';
import { formatRecoveryKey, formatSecretKey, generateRecoveryKey, generateSecretKey, parseRecoveryKey, parseSecretKey } from './secrets';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET = 'C10123456789ABCDEFGHJKMNPQRS';
const RECOVERY = 'R10123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJK';

describe('Secret Key', () => {
  it('generates the canonical form: C1 and 26 characters of the alphabet', () => {
    const seen = new Set<string>();
    const keys = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const key = generateSecretKey();
      expect(key).toMatch(/^C1[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(parseSecretKey(key)).toBe(key);
      keys.add(key);
      for (const char of key.slice(2)) seen.add(char);
    }
    expect(keys.size).toBe(400);
    // 10 400 draws over 32 characters: each one missing has a chance below 1e-140.
    expect([...seen].sort().join('')).toBe(ALPHABET);
  });

  it('formats as C1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX', () => {
    expect(formatSecretKey(SECRET)).toBe('C1-012345-6789A-BCDEF-GHJKM-NPQRS');
    expect(formatSecretKey(generateSecretKey())).toMatch(/^C1-[0-9A-Z]{6}(-[0-9A-Z]{5}){4}$/);
  });

  it('parses what people type', () => {
    expect(parseSecretKey(SECRET)).toBe(SECRET);
    expect(parseSecretKey(formatSecretKey(SECRET))).toBe(SECRET);
    expect(parseSecretKey(SECRET.toLowerCase())).toBe(SECRET);
    expect(parseSecretKey('  c1 012345 6789a bcdef ghjkm npqrs\n')).toBe(SECRET);
    expect(parseSecretKey('C1_012345.6789A/BCDEF:GHJKM–NPQRS')).toBe(SECRET);
  });

  it('reads O as 0 and I or L as 1', () => {
    expect(parseSecretKey('C1-O12345-6789A-BCDEF-GHJKM-NPQRS')).toBe(SECRET);
    expect(parseSecretKey('C1-0I2345-6789A-BCDEF-GHJKM-NPQRS')).toBe(SECRET);
    expect(parseSecretKey('C1-0L2345-6789A-BCDEF-GHJKM-NPQRS')).toBe(SECRET);
    expect(parseSecretKey('c1-ol2345-6789a-bcdef-ghjkm-npqrs')).toBe(SECRET);
    // The same slip in the prefix.
    expect(parseSecretKey('CI-012345-6789A-BCDEF-GHJKM-NPQRS')).toBe(SECRET);
    expect(parseSecretKey('cl-012345-6789A-BCDEF-GHJKM-NPQRS')).toBe(SECRET);
    expect(parseSecretKey('C1-OOOOOO-IIIII-LLLLL-oilOI-L0101')).toBe('C1' + '000000' + '11111' + '11111' + '01101' + '10101');
  });

  it('rejects what cannot be a Secret Key', () => {
    expect(parseSecretKey('')).toBeNull();
    expect(parseSecretKey('C1')).toBeNull();
    expect(parseSecretKey(SECRET.slice(0, -1))).toBeNull();
    expect(parseSecretKey(SECRET + '0')).toBeNull();
    expect(parseSecretKey(SECRET.slice(2))).toBeNull(); // no prefix
    expect(parseSecretKey('C2' + SECRET.slice(2))).toBeNull();
    expect(parseSecretKey('R1' + SECRET.slice(2))).toBeNull();
    expect(parseSecretKey('1C' + SECRET.slice(2))).toBeNull();
    // U is the one letter that is neither in the alphabet nor corrected.
    expect(parseSecretKey('C1-U12345-6789A-BCDEF-GHJKM-NPQRS')).toBeNull();
    expect(parseSecretKey('C1-012345-6789A-BCDEF-GHJKM-NPQRu')).toBeNull();
    expect(parseSecretKey(RECOVERY)).toBeNull();
    expect(parseSecretKey(undefined as unknown as string)).toBeNull();
    expect(parseSecretKey(12345 as unknown as string)).toBeNull();
  });

  it('formats without validating, so a field can be formatted while typing', () => {
    expect(formatSecretKey('')).toBe('');
    expect(formatSecretKey('c')).toBe('C');
    expect(formatSecretKey('c1')).toBe('C1');
    expect(formatSecretKey('c1abc')).toBe('C1-ABC');
    expect(formatSecretKey('c1-abcdef-g')).toBe('C1-ABCDEF-G');
    expect(formatSecretKey(formatSecretKey(SECRET))).toBe(formatSecretKey(SECRET));
  });
});

describe('Recovery Key', () => {
  it('generates the canonical form: R1 and 52 characters of the alphabet', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const key = generateRecoveryKey();
      expect(key).toMatch(/^R1[0-9A-HJKMNP-TV-Z]{52}$/);
      expect(parseRecoveryKey(key)).toBe(key);
      keys.add(key);
    }
    expect(keys.size).toBe(200);
  });

  it('formats in groups of four after the prefix', () => {
    expect(formatRecoveryKey(RECOVERY)).toBe('R1-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AB-CDEF-GHJK');
    expect(formatRecoveryKey(generateRecoveryKey())).toMatch(/^R1(-[0-9A-Z]{4}){13}$/);
    expect(formatRecoveryKey('r1abcde')).toBe('R1-ABCD-E');
  });

  it('parses with the same corrections', () => {
    expect(parseRecoveryKey(formatRecoveryKey(RECOVERY))).toBe(RECOVERY);
    expect(parseRecoveryKey(formatRecoveryKey(RECOVERY).toLowerCase().replace(/-/g, ' '))).toBe(RECOVERY);
    expect(parseRecoveryKey('RI-O123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ-0l23-4567-89AB-CDEF-GHJK')).toBe(RECOVERY);
  });

  it('rejects what cannot be a Recovery Key', () => {
    expect(parseRecoveryKey('')).toBeNull();
    expect(parseRecoveryKey(RECOVERY.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey(RECOVERY + 'Z')).toBeNull();
    expect(parseRecoveryKey('C1' + RECOVERY.slice(2))).toBeNull();
    expect(parseRecoveryKey(RECOVERY.replace('W', 'U'))).toBeNull();
    expect(parseRecoveryKey(SECRET)).toBeNull();
    expect(parseRecoveryKey(null as unknown as string)).toBeNull();
  });
});
