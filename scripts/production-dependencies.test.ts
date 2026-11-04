// Every production dependency has to be used by the app. One that nothing
// imports still ships: in the third-party notices and, for a Capacitor plugin,
// registered in the Android app with whatever it can do there.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Packages the app needs without importing them, each with the file that uses it. */
const NOT_IMPORTED: Record<string, { file: string; needs: string }> = {
  // The Android platform: Gradle builds the app against it.
  '@capacitor/android': { file: 'android/capacitor.settings.gradle', needs: "'../node_modules/@capacitor/android/capacitor'" },
};

/** The code the app is built from: src/ without tests, and index.html. */
function sources(dir = join(ROOT, 'src')): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

const code = [...sources(), join(ROOT, 'index.html')].map((path) => readFileSync(path, 'utf8')).join('\n');
const dependencies = Object.keys((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies);

/** `import … from 'name'`, `import 'name/…'`, `import('name/…')` or a CSS `@import`. */
const imported = (name: string) => new RegExp(`(?:from|import)\\s*\\(?\\s*['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"]*)?['"]`).test(code);

describe('the production dependencies', () => {
  it('are all imported by the app', () => {
    const unused = dependencies.filter((name) => !(name in NOT_IMPORTED) && !imported(name));
    expect(unused).toEqual([]);
  });

  it('that are not imported are used where the list says', () => {
    for (const [name, { file, needs }] of Object.entries(NOT_IMPORTED)) {
      expect(dependencies).toContain(name);
      // The Docker build of the web app has no android/ folder.
      if (existsSync(join(ROOT, file))) expect(readFileSync(join(ROOT, file), 'utf8')).toContain(needs);
    }
  });

  it('are recognised however they are imported', () => {
    expect(imported('react')).toBe(true);
    expect(imported('react-dom')).toBe(true);
    expect(imported('@fontsource-variable/roboto')).toBe(true);
    expect(imported('@capacitor/status-bar')).toBe(true);
    expect(imported('tailwindcss')).toBe(true);
    expect(imported('no-such-package')).toBe(false);
  });
});
