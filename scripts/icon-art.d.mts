/** The constants of src/theme/iconMaster.ts. */
export interface IconMaster {
  ICON_BRAND: string;
  ICON_PAPER: string;
  ICON_TODAY: string;
  ICON_TODAY_INK: string;
  ICON_DAYS_PATH: string;
  ICON_TODAY_PATH: string;
  ICON_SMALL_DAYS_PATH: string;
  ICON_SMALL_TODAY_PATH: string;
  [name: string]: string;
}

export type IconPalette = 'paper' | 'ink';

/** The master's constants, read from the TypeScript source by the pattern it documents. */
export function readMaster(file?: string): IconMaster;
export const LAUNCHER_WINDOW: { x: number; size: number };
export const TILE_RADIUS: number;
export const SMALL_UP_TO: number;
export function colors(master: IconMaster, palette?: IconPalette): { ground: string; days: string; today: string };
export function drawing(master: IconMaster, options?: { small?: boolean; palette?: IconPalette; color?: string }): string;
export function centredViewBox(size: number): string;
export function tileSvg(master: IconMaster, options?: { fill?: number; small?: boolean }): string;
export function roundSvg(master: IconMaster, options?: { fill?: number; small?: boolean }): string;
export function fullBleedSvg(master: IconMaster, options?: { size?: number; palette?: IconPalette }): string;
export function badgeSvg(master: IconMaster, size?: number): string;
export function faviconSvg(master: IconMaster, options?: { small?: boolean }): string;
export function foregroundXml(master: IconMaster): string;
export function monochromeXml(master: IconMaster): string;
export function statusIconXml(master: IconMaster): string;
/** Repository path of each generated Android drawable, and its text. */
export function drawables(master: IconMaster): Record<string, string>;
export const LEGACY_LAUNCHER: Record<string, number>;
export const LEGACY_FILL: number;
export const WEB_SIZES: number[];
