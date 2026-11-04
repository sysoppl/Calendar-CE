// What the device says about its display and input: the font size chosen in
// the system's settings, and whether a hardware keyboard is attached. On
// Android both come from the app itself (the `Display` plugin,
// android/app/src/main/java/pl/patrykpro/calendar/DisplayPlugin.java), whose
// WebView keeps its own text zoom at 100%: the app scales its text by the
// system's factor itself, within bounds its layout takes. A browser cannot
// tell, and the answers there are the neutral ones: a scale of 1 (the
// browser's own default font size already applies, through rem units) and no
// keyboard known (one is found by other means, see hooks/useKeyboardUi.ts).
// The other way, the page tells the app the colour of its background, which
// the app paints behind the page (`tellBackground`).
import { registerPlugin } from '@capacitor/core';
import { isNative } from '@/lib/platform';
import type { TextSize } from '@/store/settings';

/** The system's font size is followed within these bounds: beyond them the layout no longer fits. */
export const SYSTEM_TEXT_SCALE_MIN = 0.85;
export const SYSTEM_TEXT_SCALE_MAX = 1.3;

/** The system's font scale, kept within what the layout takes. */
export function clampSystemTextScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(SYSTEM_TEXT_SCALE_MAX, Math.max(SYSTEM_TEXT_SCALE_MIN, scale));
}

/**
 * The factor the interface's text is drawn at: the size chosen in Settings,
 * or with 'system' the system's font scale within its bounds.
 */
export function effectiveTextScale(textSize: TextSize, system: number): number {
  if (textSize === 'system') return clampSystemTextScale(system);
  return typeof textSize === 'number' && Number.isFinite(textSize) && textSize > 0 ? textSize : 1;
}

interface DisplayPlugin {
  getFontScale(): Promise<{ fontScale: number }>;
  getKeyboard(): Promise<{ hardware: boolean }>;
  firstScreen(): Promise<void>;
  setBackground(options: { color: string }): Promise<void>;
}

const Display = registerPlugin<DisplayPlugin>('Display');

let firstScreenTold = false;

/**
 * The app: the first screen is drawn, so the splash may go. The app holds it
 * until then (at most 4 s, MainActivity) instead of showing the empty page
 * while the scripts load. Once per page; nothing in a browser.
 */
export function tellFirstScreen(): void {
  if (!isNative || firstScreenTold) return;
  firstScreenTold = true;
  void Display.firstScreen().catch(() => {});
}

/**
 * The app: the page's background colour (`#rrggbb`), which the app paints
 * behind the page, on the window and the web view (DisplayPlugin). Without
 * it, the window's own light colour shows
 * wherever the page does not cover it yet: below the page while the keyboard
 * slides in, behind the system bars, while the page is resized. Nothing in a
 * browser, where the page's own background is all there is.
 */
export function tellBackground(color: string): void {
  if (!isNative || !/^#[0-9a-f]{6}$/i.test(color)) return;
  void Display.setBackground({ color }).catch(() => {});
}

/**
 * The font scale set in the system's settings, as it is (the bounds are
 * applied by `effectiveTextScale`); 1 where the app cannot ask (a browser) or
 * the system gives nothing usable. Rejects when the app could not ask.
 */
export async function systemFontScale(): Promise<number> {
  if (!isNative) return 1;
  const { fontScale } = await Display.getFontScale();
  return typeof fontScale === 'number' && Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
}

/** Whether the system reports a hardware keyboard; false where the app cannot ask (a browser). Rejects when the app could not ask. */
export async function hardwareKeyboard(): Promise<boolean> {
  if (!isNative) return false;
  const { hardware } = await Display.getKeyboard();
  return hardware === true;
}
