import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;

/** The files of src/ that `file` loads at once (static imports), and those they load, and so on. */
function loadedWith(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(file), spec) : null;
    if (!base) continue;
    const target = ['', '.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((p) => existsSync(p) && !p.endsWith('.css') && /\.tsx?$/.test(p));
    if (target) loadedWith(target, seen);
  }
  return seen;
}

describe('main.tsx', () => {
  it('loads nothing that reads what the app keeps before the page may run it', () => {
    const loaded = [...loadedWith(join(SRC, 'main.tsx'))].map((p) => p.slice(SRC.length + 1).replaceAll('\\', '/'));
    // The stores read localStorage as they load; another copy of the app may still be changing it.
    expect(loaded.filter((p) => /^(store\/|lib\/storage|lib\/tabs|App\.tsx$|i18n\/index\.ts$)/.test(p))).toEqual([]);
    expect(loaded).toContain('lib/instance.ts');
    expect(loaded).toContain('components/ui/OtherTabScreen.tsx');
  });
});
