// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import type { Calendar, CalendarPatchFailure } from '@/store/data';
import { useUi } from '@/store/ui';

// The store's report of a calendar a server did not update, caught where the feedback listens.
const patch = vi.hoisted(() => ({ listeners: new Set<(f: CalendarPatchFailure) => void>() }));
vi.mock('@/store/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/data')>()),
  onCalendarPatchFailure: (listener: (f: CalendarPatchFailure) => void) => {
    patch.listeners.add(listener);
    return () => void patch.listeners.delete(listener);
  },
}));

const { changeSettings, resetSettings, startSaveFeedback, LOCAL_SAVED_MS } = await import('./saveFeedback');

const toasts = () => useUi.getState().toasts.map((t) => ({ message: t.message, kind: t.kind, action: t.action?.label }));
const messages = () => toasts().map((t) => t.message);

let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  useSettings.setState({ ...DEFAULT_SETTINGS, language: 'en' });
  useUi.setState({ toasts: [] });
  stop = startSaveFeedback();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Changes in Settings', () => {
  it('says "Saved" once for a burst of changes', async () => {
    changeSettings({ showWeekends: false });
    await vi.advanceTimersByTimeAsync(300);
    changeSettings({ dimPastEvents: false });
    await vi.advanceTimersByTimeAsync(300);
    changeSettings({ weekStartsOn: 0 });
    expect(messages()).toEqual([]);
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS);
    expect(toasts()).toEqual([{ message: 'Saved', kind: 'success', action: undefined }]);
    expect(useSettings.getState()).toMatchObject({ showWeekends: false, dimPastEvents: false, weekStartsOn: 0 });
  });

  it('keeps "Saved" on screen briefly', async () => {
    changeSettings({ showWeekends: false });
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS);
    expect(messages()).toEqual(['Saved']);
    await vi.advanceTimersByTimeAsync(2600);
    expect(messages()).toEqual([]);
  });

  it('says that the change could not be kept when the storage refuses it, and update does not throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(() => changeSettings({ showWeekends: false })).not.toThrow();
    // Shown for as long as the app runs, but not kept.
    expect(useSettings.getState().showWeekends).toBe(false);
    expect(toasts()).toEqual([{ message: "Couldn't save on this device: the storage is full or blocked.", kind: 'error', action: undefined }]);
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS * 2);
    expect(messages()).not.toContain('Saved');
  });

  it('says nothing for changes made elsewhere than in Settings', async () => {
    useSettings.getState().update({ tasksPanelOpen: true });
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS * 2);
    expect(messages()).toEqual([]);
  });
});

describe('Reset settings', () => {
  it('goes back to the defaults, and Undo brings back what was there', async () => {
    useSettings.setState({ showWeekends: false, weekStartsOn: 0, density: 'compact' });
    resetSettings();
    expect(useSettings.getState()).toMatchObject({ showWeekends: true, weekStartsOn: 1, density: 'comfortable' });
    expect(toasts()).toEqual([{ message: 'Settings reset', kind: 'success', action: 'Undo' }]);
    // Its own "Saved" would take the Undo away.
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS * 2);
    expect(messages()).toEqual(['Settings reset']);
    useUi.getState().toasts[0].action!.run();
    expect(useSettings.getState()).toMatchObject({ showWeekends: false, weekStartsOn: 0, density: 'compact' });
    await vi.advanceTimersByTimeAsync(LOCAL_SAVED_MS);
    expect(messages()).toContain('Saved');
  });

  it('leaves the Undo on screen long enough to use it', async () => {
    resetSettings();
    await vi.advanceTimersByTimeAsync(5000);
    expect(messages()).toEqual(['Settings reset']);
  });
});

describe('A calendar a server did not update', () => {
  const fail = (name: string, retry: () => void) => {
    for (const listener of [...patch.listeners]) listener({ calendar: { id: `cal-${name}`, name } as Calendar, patch: { visible: false }, error: new Error('HTTP 403'), retry });
  };

  it('is said with "Try again", which sends the change again', () => {
    const retry = vi.fn();
    fail('Work', retry);
    expect(toasts()).toEqual([{ message: "Couldn't save the change to Work: HTTP 403", kind: 'error', action: 'Try again' }]);
    useUi.getState().toasts[0].action!.run();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('is said once per calendar, however often it fails', () => {
    fail('Work', () => {});
    fail('Work', () => {});
    fail('Home', () => {});
    expect(messages()).toEqual(["Couldn't save the change to Work: HTTP 403", "Couldn't save the change to Home: HTTP 403"]);
  });

  it('is no longer said once the feedback stopped', () => {
    stop();
    fail('Work', () => {});
    expect(messages()).toEqual([]);
    stop = startSaveFeedback();
  });
});
