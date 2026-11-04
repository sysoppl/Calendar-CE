// What a change made in Settings did, said once per burst of changes in a
// toast: saved, or not saved at all. The settings live on this device:
// "Saved" comes once the changes have stopped for a moment.
//
// A server-side calendar that did not take a change of its visibility or its
// place in the list (store/data.ts) is reported here too, with "Try again".
import { useEffect } from 'react';
import { t } from '@/i18n';
import { onCalendarPatchFailure, type CalendarPatchFailure } from '@/store/data';
import { DEFAULT_SETTINGS, settingsWriteFailed, useSettings, type Settings } from '@/store/settings';
import { errorMessage, SETTINGS_SAVE_TAG, useUi, type Toast } from '@/store/ui';

/** "Saved" comes once the changes have stopped for this long. */
export const LOCAL_SAVED_MS = 600;

interface Burst {
  /** Success goes unsaid: what started the burst said it already (Reset). */
  quiet: boolean;
}

let burst: Burst | null = null;
let localTimer: ReturnType<typeof setTimeout> | undefined;

function say(message: string, kind: Toast['kind'], action?: Toast['action']): void {
  const ui = useUi.getState();
  ui.dismissToasts(SETTINGS_SAVE_TAG);
  ui.toast(message, kind, action, SETTINGS_SAVE_TAG);
}

function clearTimers(): void {
  clearTimeout(localTimer);
  localTimer = undefined;
}

function begin(quiet: boolean): void {
  clearTimers();
  burst = { quiet };
  localTimer = setTimeout(() => {
    localTimer = undefined;
    const b = burst;
    burst = null;
    if (b && !b.quiet) say(t('save.saved'), 'success');
  }, LOCAL_SAVED_MS);
}

/** After a change was written into the store: says that it could not be kept, or that it was. */
function noted(quiet: boolean): boolean {
  if (settingsWriteFailed()) {
    burst = null;
    clearTimers();
    say(t('save.localFailed'), 'error');
    return false;
  }
  begin(quiet);
  return true;
}

/** Changes settings from the Settings page, and says what became of the change. */
export function changeSettings(patch: Partial<Settings>): void {
  try {
    useSettings.getState().update(patch);
  } catch {
    // `update` is not meant to throw; if it does, the change is not kept.
    burst = null;
    clearTimers();
    say(t('save.localFailed'), 'error');
    return;
  }
  noted(false);
}

/** The settings as they are now, without the store's functions. */
function snapshot(): Partial<Settings> {
  const state = useSettings.getState();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) out[key] = state[key];
  return out as Partial<Settings>;
}

/** "Reset settings": back to the defaults, with an Undo that brings back what was there. */
export function resetSettings(): void {
  const previous = snapshot();
  useSettings.getState().reset();
  if (!noted(true)) return;
  say(t('save.reset'), 'success', { label: t('save.undo'), run: () => changeSettings(previous) });
}

function reportPatchFailure(failure: CalendarPatchFailure): void {
  const ui = useUi.getState();
  const tag = `calendar-patch:${failure.calendar.id}`;
  ui.dismissToasts(tag);
  ui.toast(t('save.calendarFailed', { name: failure.calendar.name, error: errorMessage(failure.error) }), 'error', { label: t('status.retry'), run: failure.retry }, tag);
}

/** Starts reporting: the outcomes of changes, and calendars a server did not update. Returns a function that stops it. */
export function startSaveFeedback(): () => void {
  const offPatch = onCalendarPatchFailure(reportPatchFailure);
  return () => {
    offPatch();
    burst = null;
    clearTimers();
  };
}

/** `startSaveFeedback` for the calendar's shell. */
export function useSaveFeedback(): void {
  useEffect(() => startSaveFeedback(), []);
}
