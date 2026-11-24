import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readVersionAnswer } from '../src/lib/appUpdate/answer';
import { parseVersion } from '../src/lib/appUpdate/version';
import { VERSION_FILE, isPlainVersion, releaseOf, versionFile, versionFileText } from './version-file.mjs';

describe('version.json', () => {
  it("is written into the finished build with the bundle's version, and nothing else", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'calendar-version-'));
    try {
      const plugin = versionFile('1.16.0') as unknown as { apply: string; configResolved(c: unknown): void; closeBundle(): Promise<void> };
      expect(plugin.apply).toBe('build');
      plugin.configResolved({ root: dir, build: { outDir: 'dist' } });
      await plugin.closeBundle();
      const text = await readFile(join(dir, 'dist', VERSION_FILE), 'utf8');
      expect(text).toBe('{"version":"1.16.0"}\n');
      // The app reads exactly what the build writes.
      expect(readVersionAnswer(text)).toEqual({ version: '1.16.0' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('takes the release part of a pre-release version, and refuses one it cannot write', () => {
    expect(releaseOf('1.17.0-rc.1')).toBe('1.17.0');
    expect(versionFileText('1.17.0-rc.1')).toBe('{"version":"1.17.0"}\n');
    expect(() => releaseOf('1.17')).toThrow();
    expect(() => releaseOf('9999999.0.0')).toThrow();
    expect(() => versionFile('01.2.3')).toThrow();
  });

  it('accepts the same versions as the app', () => {
    for (const value of ['1.16.0', '0.0.0', '999999.1.2', '1.16', '01.2.3', '1.2.3-beta', '99999999999999999999.0.0', ' 1.2.3', 7]) {
      expect(isPlainVersion(value), String(value)).toBe(parseVersion(value) !== null);
    }
  });
});
