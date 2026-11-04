import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { SWITCH_HIT } from './Controls';

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

describe('The switch on a touch screen', () => {
  it('has a 44 × 44 px hit area there and nowhere else', async () => {
    const out = await css(SWITCH_HIT);
    // Every rule of these classes sits in a block for coarse pointers.
    const blocks = out.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/g) ?? [];
    expect(blocks.join('\n')).toMatch(/width: calc\(var\(--spacing\) \* 11\);/);
    expect(blocks.join('\n')).toMatch(/height: calc\(var\(--spacing\) \* 11\);/);
    let rest = out.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const b of blocks) rest = rest.replace(b, '');
    expect(rest).not.toMatch(/calc\(var\(--spacing\) \* 11\)/);
  });
});
