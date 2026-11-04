import type { Plugin } from 'vite';

/** Strings only development code carries (the demo seeder, React's and Vite's development code). */
export const DEVELOPMENT_MARKS: string[];
/** `file: mark` for every mark found in the `.html`, `.js` and `.mjs` files under `dir`. */
export function findDevelopmentMarks(dir: string, marks?: string[]): Promise<string[]>;
/** Fails `vite build` when Vite did not build for production or the output carries one of `marks`. */
export function developmentGuard(marks?: string[]): Plugin;
