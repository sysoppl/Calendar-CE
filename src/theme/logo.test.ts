import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as master from './iconMaster';
import { dayPaths, logoDataUri, logoSvg } from './logo';
import { faviconSvg, readMaster } from '../../scripts/icon-art.mjs';

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8');
const colorsOf = (svg: string) => new Set(svg.match(/#[0-9a-f]{6}/gi)!.map((c) => c.toUpperCase()));

/** Every point a path names (moves and the ends of segments). */
function pointsOf(path: string): [number, number][] {
  let x = 0;
  let y = 0;
  const points: [number, number][] = [];
  for (const [, cmd, args] of path.matchAll(/([MmHhVvLlAaZz])([^MmHhVvLlAaZz]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    if (cmd === 'M' || cmd === 'L') [x, y] = n;
    else if (cmd === 'l') [x, y] = [x + n[0], y + n[1]];
    else if (cmd === 'h') x += n[0];
    else if (cmd === 'H') x = n[0];
    else if (cmd === 'v') y += n[0];
    else if (cmd === 'V') y = n[0];
    else if (cmd === 'a') [x, y] = [x + n[5], y + n[6]];
    points.push([x, y]);
  }
  return points;
}

const days = (path: string) => path.match(/z/g)?.length ?? 0;

describe('logo', () => {
  it('is the tab icon and the installed web app\'s scalable icon, as scripts/render-icons.mjs writes them', () => {
    expect(read('public/favicon.svg')).toBe(logoSvg());
    expect(read('public/icons/icon.svg')).toBe(logoSvg({ small: false }));
    expect(faviconSvg(readMaster())).toBe(logoSvg());
    expect(faviconSvg(readMaster(), { small: false })).toBe(logoSvg({ small: false }));
    expect(read('index.html')).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });

  it('is flat, with no date and no text', () => {
    for (const palette of ['paper', 'ink'] as const) {
      for (const small of [true, false]) {
        const svg = logoSvg({ palette, small });
        expect(svg).not.toContain('<text');
        expect(svg).not.toMatch(/gradient/i);
        expect(decodeURIComponent(logoDataUri({ palette, small }).replace('data:image/svg+xml,', ''))).toBe(svg);
      }
    }
  });

  it('has ink days and a red day on the paper, or paper days and an amber day on the ink', () => {
    expect(logoSvg()).toContain(`<rect width="64" height="64" rx="14" fill="${master.ICON_PAPER}"/>`);
    expect(colorsOf(logoSvg())).toEqual(new Set([master.ICON_PAPER, master.ICON_BRAND, master.ICON_TODAY]));
    expect(logoSvg({ palette: 'ink' })).toContain(`<rect width="64" height="64" rx="14" fill="${master.ICON_BRAND}"/>`);
    expect(colorsOf(logoSvg({ palette: 'ink' }))).toEqual(new Set([master.ICON_BRAND, master.ICON_PAPER, master.ICON_TODAY_INK]));
  });

  it('draws the month, or the small drawing for small sizes', () => {
    expect(logoSvg({ small: false })).toContain(master.ICON_DAYS_PATH);
    expect(logoSvg({ small: false })).toContain(master.ICON_TODAY_PATH);
    expect(logoSvg()).toContain(master.ICON_SMALL_DAYS_PATH);
    expect(logoSvg()).toContain(master.ICON_SMALL_TODAY_PATH);
    expect(dayPaths('#000000', '#000000')).toBe(`<path d="${master.ICON_DAYS_PATH}" fill="#000000"/><path d="${master.ICON_TODAY_PATH}" fill="#000000"/>`);
  });
});

describe('icon master', () => {
  it('can be read by a Node script without TypeScript: plain string constants only', () => {
    const source = read('src/theme/iconMaster.ts');
    const found = Object.fromEntries([...source.matchAll(/export const (\w+) = '([^']*)';/g)].map((m) => [m[1], m[2]]));
    expect(found).toEqual({ ...master });
    expect(source).not.toMatch(/^import /m);
  });

  it('is October 2026 with the 29th marked, and the small drawing two, four, four and two days', () => {
    expect(days(master.ICON_DAYS_PATH)).toBe(30);
    expect(days(master.ICON_TODAY_PATH)).toBe(1);
    expect(days(master.ICON_SMALL_DAYS_PATH)).toBe(11);
    expect(days(master.ICON_SMALL_TODAY_PATH)).toBe(1);
    // Rows of the month by their top edge: 4, 7, 7, 7 and 6 days (the 29th in the last).
    const tops = [...master.ICON_DAYS_PATH.matchAll(/M[\d.]+ ([\d.]+)h/g), ...master.ICON_TODAY_PATH.matchAll(/M[\d.]+ ([\d.]+)h/g)].map((m) => m[1]);
    const perRow = Object.values(tops.reduce<Record<string, number>>((rows, top) => ({ ...rows, [top]: (rows[top] ?? 0) + 1 }), {}));
    expect(perRow).toEqual([4, 7, 7, 7, 6]);
  });

  it('keeps both drawings centred and inside the safe zone of an adaptive icon', () => {
    for (const paths of [
      [master.ICON_DAYS_PATH, master.ICON_TODAY_PATH],
      [master.ICON_SMALL_DAYS_PATH, master.ICON_SMALL_TODAY_PATH],
    ]) {
      const points = paths.flatMap(pointsOf);
      expect(points.length).toBeGreaterThan(50);
      // Every point lies within the circle of radius 33 around the centre.
      for (const [px, py] of points) expect(Math.hypot(px - 54, py - 54), `${px},${py}`).toBeLessThanOrEqual(33);
      const xs = points.map(([px]) => px);
      const ys = points.map(([, py]) => py);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(54, 5);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(54, 5);
    }
  });
});
