import { create } from 'zustand';
import { effectiveTextScale, systemFontScale } from '@/lib/display';
import { useSettings } from '@/store/settings';

/** The system's font scale as last read (1 until then, and in a browser). */
const useSystemFontScale = create<{ scale: number }>(() => ({ scale: 1 }));

/**
 * Reads the system's font scale again: at start, and when the app comes back
 * to the front (the system's settings may have changed meanwhile). A failed
 * read keeps the last value.
 */
export async function refreshSystemFontScale(): Promise<void> {
  try {
    const scale = await systemFontScale();
    if (Number.isFinite(scale) && scale > 0) useSystemFontScale.setState({ scale });
  } catch {
    // The last value stays.
  }
}

/** The factor the interface's text is drawn at, outside components. */
export function textScale(): number {
  return effectiveTextScale(useSettings.getState().textSize, useSystemFontScale.getState().scale);
}

/** The factor the interface's text is drawn at: the size chosen in Settings, or the system's within its bounds. */
export function useTextScale(): number {
  const textSize = useSettings((s) => s.textSize);
  const system = useSystemFontScale((s) => s.scale);
  return effectiveTextScale(textSize, system);
}
