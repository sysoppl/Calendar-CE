import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { TOUCH_AREA, TOUCH_HIT, TOUCH_MIN, TOUCH_MIN_H } from './touch';

const require = createRequire(import.meta.url);

/** The CSS Tailwind makes of these classes, with its theme. */
async function css(classes: string): Promise<string> {
  const compiler = await compile('@import "tailwindcss/theme"; @import "tailwindcss/utilities";', {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const path = require.resolve(id.endsWith('.css') ? id : `${id}.css`);
      return { content: readFileSync(path, 'utf8'), base, path };
    },
  });
  return compiler.build(classes.split(/\s+/).filter(Boolean));
}

/** The rules of `text` outside any `@media (pointer: coarse)` block, without the theme and Tailwind's own set-up. */
function outsideCoarse(text: string): string {
  let out = '';
  let depth = 0;
  let skipFrom = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('@media (pointer: coarse)', i) && skipFrom < 0) skipFrom = depth;
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (skipFrom >= 0 && depth === skipFrom) {
        skipFrom = -1;
        continue;
      }
    }
    if (skipFrom < 0) out += text[i];
  }
  return out
    .replace(/\/\*.*?\*\//gs, '')
    .replace(/@layer properties[^{]*\{[\s\S]*?\n\}/g, '')
    .replace(/@property[^{]*\{[^}]*\}/g, '')
    .replace(/:root, :host \{[^}]*\}/g, '')
    .replace(/@layer properties;/g, '')
    .trim();
}

describe('touch sizes', () => {
  it('change nothing where the pointer is a mouse', async () => {
    expect(outsideCoarse(await css(TOUCH_AREA))).toBe('');
    // The hit area needs a box to hang on, which every control of the header has anyway.
    expect(outsideCoarse(await css(TOUCH_HIT))).toBe('.relative {\n  position: relative;\n}');
    // Least sizes read a variable only a touch area sets.
    for (const rule of outsideCoarse(await css(`${TOUCH_MIN} ${TOUCH_MIN_H}`)).match(/min-(?:width|height): [^;]+/g) ?? []) {
      expect(rule).toMatch(/var\(--touch,0px\)$/);
    }
  });

  it('give a finger 44 px on a touch screen', async () => {
    const area = await css(TOUCH_AREA);
    expect(area).toContain('--touch: 2.75rem');
    expect(area).toContain('--field-h: 2.75rem');
    const hit = await css(TOUCH_HIT);
    expect(hit).toMatch(/::after \{\s*content: var\(--tw-content\);\s*height: calc\(var\(--spacing\) \* 11\);/);
    expect(hit).toMatch(/::after \{\s*content: var\(--tw-content\);\s*position: absolute;/);
  });
});
