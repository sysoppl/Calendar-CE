// Whether the interface shows what only a keyboard can use: shortcut hints in
// menus, the list of shortcuts, "Ctrl+Enter saves". A phone or a tablet
// without a keyboard has no use for them. A keyboard is taken to be there
// when any of these holds:
// - the primary pointer is a mouse or a trackpad (a computer);
// - the system reports a hardware keyboard (Android, asked at start and
//   whenever the app comes back to the front);
// - a key was pressed outside a text field, now or earlier on this device.
//   Soft keyboards type only into fields, and while composing they send
//   'Unidentified' with key code 229, which does not count.
// The shortcuts themselves work either way. While the interface shows them,
// the document carries `data-keys`, which the `keys:` variant of the styles
// reads.
import { useEffect } from 'react';
import { create } from 'zustand';
import { App as CapApp } from '@capacitor/app';
import { hardwareKeyboard } from '@/lib/display';
import { isNative } from '@/lib/platform';

/** Set once a key press showed a keyboard on this device. */
const STORAGE_KEY = 'calendar.keys';
/** Hover and a fine primary pointer: a mouse or a trackpad. (`any-pointer` is unreliable on emulators and pen phones.) */
const POINTER_QUERY = '(hover: hover) and (pointer: fine)';

interface KeyboardUiState {
  /** The primary pointer is a mouse or a trackpad. */
  finePointer: boolean;
  /** The system reports a hardware keyboard. */
  hardware: boolean;
  /** A key was pressed outside a text field, now or earlier on this device. */
  typed: boolean;
}

function readTyped(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function pointerQuery(): MediaQueryList | undefined {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(POINTER_QUERY) : undefined;
  } catch {
    return undefined;
  }
}

export const useKeyboardUiState = create<KeyboardUiState>(() => ({ finePointer: !!pointerQuery()?.matches, hardware: false, typed: readTyped() }));

const shown = (s: KeyboardUiState) => s.finePointer || s.hardware || s.typed;

/** Whether the interface shows shortcuts and their hints: a keyboard is there. */
export function useKeyboardUi(): boolean {
  return useKeyboardUiState(shown);
}

/** The same, outside components. */
export function keyboardUi(): boolean {
  return shown(useKeyboardUiState.getState());
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Whether a key press shows a real keyboard: a character, an arrow or Escape, outside a text field, not from a soft keyboard composing. */
export function isKeyboardPress(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  const key = e.key;
  if (typeof key !== 'string' || !(key.length === 1 || key.startsWith('Arrow') || key === 'Escape')) return false;
  return !isEditable(e.target);
}

/** A key press showed a keyboard: kept for the next starts too. */
export function noteKeyboard(): void {
  if (useKeyboardUiState.getState().typed) return;
  useKeyboardUiState.setState({ typed: true });
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Known for this session.
  }
}

/** Asks the system whether a hardware keyboard is attached. */
function checkHardware(): void {
  hardwareKeyboard().then(
    (hardware) => useKeyboardUiState.setState({ hardware }),
    () => {},
  );
}

/**
 * Watches for a keyboard and marks the document with `data-keys` while there
 * is one. Called once, at the root of the app.
 */
export function useKeyboardDetection(): void {
  const on = useKeyboardUi();
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute('data-keys', '');
    else root.removeAttribute('data-keys');
  }, [on]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isKeyboardPress(e)) noteKeyboard();
    };
    // Seen first, before anything handles the key and stops it.
    window.addEventListener('keydown', onKey, true);
    const query = pointerQuery();
    const onPointer = () => useKeyboardUiState.setState({ finePointer: !!query?.matches });
    onPointer();
    query?.addEventListener?.('change', onPointer);
    checkHardware();
    const resume = isNative ? CapApp.addListener('resume', checkHardware) : undefined;
    return () => {
      window.removeEventListener('keydown', onKey, true);
      query?.removeEventListener?.('change', onPointer);
      void resume?.then((h) => h.remove());
    };
  }, []);
}
