import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { SWATCH_CELL, SWATCH_DOT, SWATCH_GRID } from './ColorPicker';

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

/** The declarations of `property` in the rules for `selectorPart`. */
function declared(text: string, selectorPart: string, property: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].includes(selectorPart)) continue;
    for (const d of m[2].matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))) out.push(d[1].trim());
  }
  return out;
}

describe('the swatch grid', () => {
  it('is eight columns that shrink with the room, so it fits a 328 px phone column and a narrow popover', async () => {
    const grid = await css(SWATCH_GRID);
    expect(SWATCH_GRID.split(' ')).toEqual(expect.arrayContaining(['grid', 'w-full', 'grid-cols-8']));
    expect(grid).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))');
    // 304 px with a mouse (38 px a column), 352 px on a touch screen (44 px a column) at most.
    expect(declared(grid, '.max-w-76', 'max-width')).toEqual(['calc(var(--spacing) * 76)']);
    expect(declared(grid, '.pointer-coarse\\:max-w-88', 'max-width')).toEqual(['calc(var(--spacing) * 88)']);
    // A column never asks for more than its share: the drawn swatch is the smaller of its size and the column.
    const dot = await css(SWATCH_DOT);
    expect(declared(dot, 'w-\\[min', 'width')).toEqual(['min(2rem, calc(100% - 0.25rem))', 'min(2.25rem, calc(100% - 0.25rem))']);
    // No fixed width anywhere that could push a column wider: at 328 px eight
    // columns of 41 px hold 36 px swatches; in the event editor's 296 px
    // popover, 37 px columns hold 32 px ones.
    expect(`${SWATCH_GRID} ${SWATCH_CELL} ${SWATCH_DOT}`).not.toMatch(/(^|\s)(pointer-coarse:)?(size|min-w|w)-\d/);
  });

  it('gives a finger a target as tall as a fingertip, a column wide', async () => {
    const cell = await css(SWATCH_CELL);
    expect(declared(cell, '.pointer-coarse\\:h-11', 'height')).toEqual(['calc(var(--spacing) * 11)']);
    expect(cell).toContain('@media (pointer: coarse)');
    // The focus ring is drawn around the round swatch, not the square target.
    expect(SWATCH_CELL).toContain('focus-visible:outline-none');
    expect(SWATCH_DOT).toContain('group-focus-visible:outline-2');
    expect(SWATCH_DOT).toContain('motion-reduce:transition-none');
  });
});
