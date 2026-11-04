import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVELOPMENT_MARKS, developmentGuard, findDevelopmentMarks } from './development-guard.mjs';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'calendar-devguard-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An output folder with a page, a chunk and the notices; `extra` goes into the chunk. */
async function output(name: string, extra = '') {
  const out = join(dir, name);
  await mkdir(join(out, 'assets'), { recursive: true });
  await writeFile(join(out, 'index.html'), '<!doctype html><script type="module" src="/assets/index-abc.js"></script>');
  await writeFile(join(out, 'assets', 'index-abc.js'), `const a=1;${extra}`);
  // Text, not code: the notices may name anything.
  await writeFile(join(out, 'THIRD-PARTY-NOTICES.txt'), 'jsxDEV __calendarSeed');
  return out;
}

/** Runs the plugin's hooks as `vite build` would. */
async function guard(outDir: string, config: Partial<ResolvedConfig> = {}) {
  const plugin = developmentGuard() as unknown as {
    configResolved: (c: Partial<ResolvedConfig>) => void;
    closeBundle: () => Promise<void>;
  };
  plugin.configResolved({ root: dir, build: { outDir } as ResolvedConfig['build'], isProduction: true, mode: 'production', ...config });
  await plugin.closeBundle();
}

describe('the development guard', () => {
  it('lets a production bundle through', async () => {
    const out = await output('clean');
    expect(await findDevelopmentMarks(out)).toEqual([]);
    await expect(guard(out)).resolves.toBeUndefined();
  });

  it.each(DEVELOPMENT_MARKS)('stops a bundle that carries %s', async (mark) => {
    const out = await output(`mark-${DEVELOPMENT_MARKS.indexOf(mark)}`, `globalThis[${JSON.stringify(mark)}]=1;`);
    expect(await findDevelopmentMarks(out)).toEqual([`assets/index-abc.js: ${mark}`]);
    await expect(guard(out)).rejects.toThrow(`development code: assets/index-abc.js: ${mark}`);
  });

  it('stops a build Vite did not make for production', async () => {
    const out = await output('dev-mode');
    await expect(guard(out, { isProduction: false, mode: 'development' })).rejects.toThrow(/development build \(mode "development"/);
  });

  it('applies to builds only', () => {
    expect(developmentGuard()).toMatchObject({ name: 'calendar-development-guard', apply: 'build' });
  });
});
