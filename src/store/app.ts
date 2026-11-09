// What was decided on first run: whether the welcome screen is behind us and
// where calendar data is kept.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Matches the account kind that new calendars go to. */
export type StorageMode = 'local' | 'caldav';

/**
 * What this device knows about keeping calendars on it (lib/deviceStorage.ts):
 * all of it belongs to the device, and goes with its data.
 */
export interface DeviceStorageState {
  /** When the user accepted that calendars kept on this device are kept at their own risk. */
  riskAcceptedAt?: number;
  /** When the notice of what can delete them was closed. */
  riskNoticeClosedAt?: number;
  /** When the last backup file was saved on this device. */
  lastBackupAt?: number;
  /** Since when this device keeps calendars: without a backup, the reminder counts from here. */
  keepingSince?: number;
  /** The backup reminder was put off until then. */
  backupSnoozedUntil?: number;
}

/** The fields of `DeviceStorageState`, which are stored with the rest. */
const DEVICE_STORAGE_KEYS = ['riskAcceptedAt', 'riskNoticeClosedAt', 'lastBackupAt', 'keepingSince', 'backupSnoozedUntil'] as const;

interface AppState extends DeviceStorageState {
  /** False until the welcome screen has been completed. */
  onboarded: boolean;
  /** Null until the user has chosen. */
  storageMode: StorageMode | null;
  /** Finishes the welcome screen with the chosen storage. */
  setOnboarded: (mode: StorageMode) => void;
  /** Changes where new calendars go, after data was moved for instance. */
  setStorageMode: (mode: StorageMode) => void;
  /** Notes facts about keeping calendars on this device. */
  updateDeviceStorage: (patch: DeviceStorageState) => void;
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
      updateDeviceStorage: (patch) => set(patch),
    }),
    {
      name: APP_KEY,
      version: 1,
      partialize: (s) => {
        const kept: Partial<AppState> = { onboarded: s.onboarded, storageMode: s.storageMode };
        // Only the facts there are: a device that never kept a calendar stores none of them.
        for (const key of DEVICE_STORAGE_KEYS) if (typeof s[key] === 'number') kept[key] = s[key];
        return kept;
      },
      migrate: (state) => state as AppState,
      // A stamp that is no number (a damaged store) is no stamp.
      merge: (stored, current) => {
        const s = { ...((stored ?? {}) as Partial<AppState>) };
        for (const key of DEVICE_STORAGE_KEYS) if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key]))) delete s[key];
        return { ...current, ...s };
      },
    },
  ),
);

// Stored at once. The data store writes its key as soon as it starts, and
// from the next start on that key alone would look like an existing install.
if (!hadApp) useApp.setState({});
