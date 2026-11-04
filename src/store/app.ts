// What was decided on first run: whether the welcome screen is behind us and
// where calendar data is kept.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Matches the account kind that new calendars go to. */
export type StorageMode = 'local' | 'caldav';

interface AppState {
  /** False until the welcome screen has been completed. */
  onboarded: boolean;
  /** Null until the user has chosen. */
  storageMode: StorageMode | null;
  /** Finishes the welcome screen with the chosen storage. */
  setOnboarded: (mode: StorageMode) => void;
  /** Changes where new calendars go, after data was moved for instance. */
  setStorageMode: (mode: StorageMode) => void;
}

const APP_KEY = 'calendar.app';
const DATA_KEY = 'calendar.data';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Read while this module loads. The data store imports this file, so this
// happens before it exists and therefore before anything writes its key.
const hadApp = stored(APP_KEY) !== null;
const dataAtStart = stored(DATA_KEY);

/** True when nothing of the app was stored on this device when it started. */
export const isFirstRun = !hadApp && dataAtStart === null;

/** An install from before there was a welcome screen: its accounts tell the mode. */
function modeOfExistingInstall(): StorageMode {
  try {
    const accounts: unknown = JSON.parse(dataAtStart ?? 'null')?.state?.accounts;
    return Array.isArray(accounts) && accounts.some((a) => a?.kind === 'caldav') ? 'caldav' : 'local';
  } catch {
    return 'local';
  }
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      onboarded: !isFirstRun,
      storageMode: isFirstRun ? null : modeOfExistingInstall(),
      setOnboarded: (storageMode) => set({ onboarded: true, storageMode }),
      setStorageMode: (storageMode) => set({ storageMode }),
    }),
    {
      name: APP_KEY,
      version: 1,
      partialize: (s) => ({ onboarded: s.onboarded, storageMode: s.storageMode }),
      migrate: (state) => state as AppState,
    },
  ),
);

// Stored at once. The data store writes its key as soon as it starts, and
// from the next start on that key alone would look like an existing install.
if (!hadApp) useApp.setState({});
