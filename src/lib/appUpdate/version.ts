// Version numbers of the app: comparing them, and reading one that came from
// outside (the site's version.json) strictly enough that nothing but a plain
// "major.minor.patch" can ever decide that a newer version is out.

/** Compares two dotted versions ("1.10.0" after "1.9.2"); a part that is not a number counts as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/, 3).map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/**
 * Three numbers of at most six digits each, without leading zeros: what
 * package.json holds for a release, and nothing that could overflow, be read
 * two ways or carry anything else.
 */
const PLAIN_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** `value` when it is a plain version ("1.16.0"); null for anything else (other types, extra parts, signs, spaces, huge numbers). */
export function parseVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 20 && PLAIN_VERSION.test(value) ? value : null;
}

/** Whether `candidate` is a plain version strictly after `current`. Anything malformed is never newer. */
export function isNewer(candidate: unknown, current: string): boolean {
  const version = parseVersion(candidate);
  return version !== null && compareVersions(version, current) > 0;
}
