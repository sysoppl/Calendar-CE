import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_SAVE_TAG, toastDuration, useUi } from './ui';

const run = () => {};

describe('toastDuration', () => {
  it('keeps an error that offers something to do until it is closed', () => {
    expect(toastDuration({ kind: 'error', action: { label: 'Try again', run } })).toBeNull();
  });

  it('gives other errors 8 s, and toasts with a button (Undo) as long', () => {
    expect(toastDuration({ kind: 'error' })).toBe(8000);
    expect(toastDuration({ kind: 'success', action: { label: 'Undo', run }, tag: SETTINGS_SAVE_TAG })).toBe(8000);
    expect(toastDuration({ kind: 'info', action: { label: 'Fix', run } })).toBe(8000);
  });

  it('keeps the "Saved" of a change of the settings brief', () => {
    expect(toastDuration({ kind: 'success', tag: SETTINGS_SAVE_TAG })).toBe(2500);
    expect(toastDuration({ kind: 'info', tag: SETTINGS_SAVE_TAG })).toBe(4500);
    expect(toastDuration({ kind: 'success' })).toBe(4500);
  });
});

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUi.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('takes each toast away after its time, and leaves an error with an action', () => {
    const ui = useUi.getState();
    ui.toast('Saved', 'success', undefined, SETTINGS_SAVE_TAG);
    ui.toast("Couldn't sync", 'error', { label: 'Try again', run });
    vi.advanceTimersByTime(2600);
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(["Couldn't sync"]);
    vi.advanceTimersByTime(60_000);
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(["Couldn't sync"]);
  });
});
