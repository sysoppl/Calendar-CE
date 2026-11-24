import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer, parseVersion } from './version';

describe('versions', () => {
  it('compare part by part, as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('1.16.0', '1.16.0')).toBe(0);
    expect(compareVersions('1.15.2', '1.16.0')).toBe(-1);
  });

  it('are read from outside only as three plain numbers', () => {
    expect(parseVersion('1.16.0')).toBe('1.16.0');
    expect(parseVersion('0.0.1')).toBe('0.0.1');
    expect(parseVersion('999999.999999.999999')).toBe('999999.999999.999999');
    for (const bad of [
      '99999999999999999999.0.0',
      '1000000.0.0',
      '1.16',
      '1.16.0.1',
      '1.16.0-beta',
      '1.16.0+build',
      'v1.16.0',
      ' 1.16.0',
      '1.16.0\n',
      '01.16.0',
      '1.016.0',
      '-1.16.0',
      '1.1e3.0',
      '１.16.0',
      '',
      'x'.repeat(5000),
      `1.16.${'0'.repeat(100)}`,
    ]) {
      expect(parseVersion(bad), JSON.stringify(bad.slice(0, 40))).toBeNull();
    }
    for (const notString of [1.16, 116, null, undefined, {}, ['1.16.0'], { version: '1.16.0' }, true, NaN]) {
      expect(parseVersion(notString)).toBeNull();
    }
  });

  it('are newer only when well-formed and strictly after this one', () => {
    expect(isNewer('1.16.1', '1.16.0')).toBe(true);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('1.16.0', '1.16.0')).toBe(false);
    expect(isNewer('1.15.9', '1.16.0')).toBe(false);
    // A pre-release of this version is the same release.
    expect(isNewer('1.17.0', '1.17.0-rc.1')).toBe(false);
    // Garbage never locks.
    expect(isNewer('99999999999999999999.0.0', '1.16.0')).toBe(false);
    expect(isNewer('9.9', '1.16.0')).toBe(false);
    expect(isNewer(99, '1.16.0')).toBe(false);
    expect(isNewer(undefined, '1.16.0')).toBe(false);
  });
});
