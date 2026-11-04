// Build guard: a production bundle must not be a development one. The demo
// seeder (src/dev/seed.ts) is only behind import.meta.env.DEV, which a build
// with NODE_ENV=development or --mode development turns on; such a bundle
// would carry it and React's development build. The guard
// stops `vite build` when Vite did not build for production, and when the
// written scripts or pages still carry a mark of development code anyway.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Strings only development code carries: the global the seeder installs, React's development JSX runtime, and Vite's dev client and
 * React's hot reloading.
 */
export const DEVELOPMENT_MARKS = ['__calendarSeed', 'jsxDEV', '/@vite/client', '/@react-refresh'];
/** Files the browser runs or parses as code. */
const CODE = /\.(html|m?js)$/i;

/** `file: mark` for every mark of development code in the scripts and pages under `dir`. */
export async function findDevelopmentMarks(dir, marks = DEVELOPMENT_MARKS) {
  const hits = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !CODE.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'utf8');
    const name = relative(dir, path).split(sep).join('/');
    for (const mark of marks) if (text.includes(mark)) hits.push(`${name}: ${mark}`);
  }
  return hits.sort();
}

export function developmentGuard(marks = DEVELOPMENT_MARKS) {
  let outDir = '';
  let production = true;
  let mode = '';
  return {
    name: 'calendar-development-guard',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      production = config.isProduction;
      mode = config.mode;
    },
    async closeBundle() {
      if (!production) {
        throw new Error(
          `This is a development build (mode "${mode}", NODE_ENV "${process.env.NODE_ENV ?? ''}"): it would ship the demo seeder and React's development build. Build with NODE_ENV=production.`,
        );
      }
      const hits = await findDevelopmentMarks(outDir, marks);
      if (hits.length) throw new Error(`The production bundle carries development code: ${hits.join(', ')}`);
    },
  };
}
