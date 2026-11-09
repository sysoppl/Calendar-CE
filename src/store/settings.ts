import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ExtraLang } from '@/i18n/languages';
import { tabIsCurrent } from '@/lib/tabs';
import { currentFontId, currentThemeId, renamedThemeId } from '@/theme/legacy';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/theme/themes';

export type ViewType = 'day' | 'days' | 'week' | 'month' | 'year' | 'agenda';
/** Views in menu order, with their letter and number shortcuts. */
export const VIEWS: { id: ViewType; key: string; digit: string }[] = [
  { id: 'day', key: 'D', digit: '1' },
  { id: 'days', key: 'X', digit: '4' },
  { id: 'week', key: 'W', digit: '2' },
  { id: 'month', key: 'M', digit: '3' },
  { id: 'year', key: 'Y', digit: '6' },
  { id: 'agenda', key: 'A', digit: '5' },
];

export type ThemeMode = 'fixed' | 'system';
export type Density = 'comfortable' | 'compact';
export type EventStyle = 'filled' | 'tonal' | 'soft' | 'outline';
/** Corner rounding of the whole interface. */
export type Shape = 'sharp' | 'rounded' | 'round';
/** How the calendar sits in the frame: attached to the bottom edge or a floating card. */
export type Surface = 'panel' | 'card';
export type Language = 'auto' | 'en' | 'pl';
/** One of the languages beyond English and Polish chosen on this device, or none (''); see src/i18n/languages.ts. */
export type DeviceLanguage = '' | ExtraLang;
/**
 * Size of the interface's text: 'system' follows the system's font size (on
 * Android; 1 in a browser, whose own default size already counts), a number
 * is a factor chosen in Settings. `effectiveTextScale` (lib/display.ts) turns
 * it into the factor in use.
 */
export type TextSize = 'system' | number;
/** What the round + button over the calendar on phones starts: a new event, a new task, or a choice of the two. */
export type FabAction = 'event' | 'task' | 'choose';
export const FAB_ACTIONS: readonly FabAction[] = ['event', 'task', 'choose'];

/**
 * A calendar's own default notifications (minutes before the start, as
 * `defaultAlarms`), for its events with a time and for its all-day events.
 * A kind that is absent follows the general default; an empty list is "no
 * notification".
 */
export interface CalendarAlarms {
  timed?: number[];
  allDay?: number[];
}

export const MIN_CUSTOM_DAYS = 2;
export const MAX_CUSTOM_DAYS = 7;

/** The range of a text size chosen by hand. A value outside it (from a damaged or foreign store) is not taken. */
export const MIN_TEXT_SIZE = 0.75;
export const MAX_TEXT_SIZE = 1.5;

export interface Settings {
  themeMode: ThemeMode;
  theme: string;
  lightTheme: string;
  darkTheme: string;
  /** Replaces the theme's primary colour; empty for the theme's own. */
  accentColor: string;
  density: Density;
  eventStyle: EventStyle;
  shape: Shape;
  surface: Surface;
  fontFamily: string;
  textSize: TextSize;
  /** Read by every version of the app, so it keeps to these three values. */
  language: Language;
  /** A language beyond `language`'s (de, es, …) chosen on this device; it wins over `language`. */
  deviceLanguage: DeviceLanguage;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday. */
  weekStartsOn: 0 | 1 | 6;
  timeFormat: '12h' | '24h' | 'auto';
  defaultView: ViewType;
  /** Number of days in the custom "N days" view. */
  customDays: number;
  showWeekNumbers: boolean;
  /** What the round + button starts (phones and narrow windows, `Fab`). */
  fabAction: FabAction;
  showWeekends: boolean;
  dimPastEvents: boolean;
  showDeclinedEvents: boolean;
  showSecondaryTimezone: boolean;
  secondaryTimezone: string;
  defaultEventDuration: number;
  defaultAlarms: number[];
  defaultAllDayAlarms: number[];
  /**
   * Per calendar id, the calendars that have default notifications of their
   * own (lib/calendarAlarms.ts). Set in the calendar's dialog, not on the
   * Settings page, so "Reset settings" leaves it alone.
   */
  calendarAlarms?: Record<string, CalendarAlarms>;
  defaultCalendarId?: string;
  defaultTaskListId?: string;
  /** Extra addresses (comma separated) that identify the user in invitations. */
  myEmails: string;
  showTasksInCalendar: boolean;
  showCompletedTasks: boolean;
  tasksPanelOpen: boolean;
  sidebarCollapsed: boolean;
  syncIntervalMinutes: number;
  notificationsEnabled: boolean;
  dayStartHour: number;
  /**
   * Days after the last backup at which a notice above the calendar asks for
   * a new one, while calendars are kept on this device (lib/deviceStorage.ts);
   * 0 turns the reminder off. About this device's data.
   */
  backupReminderDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  // Light, whatever the system's scheme; "Sync with system" is a choice.
  themeMode: 'fixed',
  theme: DEFAULT_LIGHT_THEME,
  lightTheme: DEFAULT_LIGHT_THEME,
  darkTheme: DEFAULT_DARK_THEME,
  accentColor: '',
  density: 'comfortable',
  eventStyle: 'filled',
  shape: 'rounded',
  surface: 'panel',
  fontFamily: 'inter',
  textSize: 'system',
  language: 'auto',
  deviceLanguage: '',
  weekStartsOn: 1,
  timeFormat: 'auto',
  defaultView: 'week',
  customDays: 4,
  showWeekNumbers: false,
  fabAction: 'event',
  showWeekends: true,
  dimPastEvents: true,
  showDeclinedEvents: true,
  showSecondaryTimezone: false,
  secondaryTimezone: 'UTC',
  defaultEventDuration: 30,
  defaultAlarms: [15],
  defaultAllDayAlarms: [],
  myEmails: '',
  showTasksInCalendar: true,
  showCompletedTasks: false,
  tasksPanelOpen: false,
  sidebarCollapsed: false,
  syncIntervalMinutes: 5,
  notificationsEnabled: true,
  dayStartHour: 7,
  backupReminderDays: 30,
};

/** The backup reminder's choices in Settings › Backup; any other whole number of days up to the maximum is "Custom". */
export const BACKUP_REMINDER_PRESETS: readonly number[] = [7, 14, 30, 60, 90];
export const MAX_BACKUP_REMINDER_DAYS = 365;

export function isBackupReminderDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_BACKUP_REMINDER_DAYS;
}

/** Version of the stored settings; `migrateSettings` brings older ones up to it. */
export const SETTINGS_VERSION = 4;

export function isTextSize(value: unknown): value is TextSize {
  return value === 'system' || (typeof value === 'number' && Number.isFinite(value) && value >= MIN_TEXT_SIZE && value <= MAX_TEXT_SIZE);
}

/**
 * Brings settings saved by an older version up to date. Fields it does not
 * know are left alone, so it also works on a partial set. Every step looks at
 * the fields it is about and does nothing when they are absent.
 */
export function migrateSettings(state: unknown, version: number): Partial<Settings> {
  const s = { ...((state ?? {}) as Partial<Settings> & { fontScale?: unknown }) };
  // v2: reminders are on by default (they used to be opt-in).
  if (version < 2) s.notificationsEnabled = true;
  // v3: themes got new names, and some fonts were renamed or dropped. Only
  // the renaming of then: v4 below still has to tell what was a default.
  if (version < 3) {
    for (const key of ['theme', 'lightTheme', 'darkTheme'] as const) {
      if (typeof s[key] === 'string') s[key] = renamedThemeId(s[key]);
    }
    if (typeof s.fontFamily === 'string') s.fontFamily = currentFontId(s.fontFamily);
  }
  // v4: light by default, a new theme set, and the text size that can follow
  // the system. A set that already has `textSize` was written by version 4 or
  // later, even when it says 3, and has nothing of this step left to do.
  if (version < 4 && !('textSize' in s)) migrateToV4(s);
  return s;
}

function migrateToV4(s: Partial<Settings> & { fontScale?: unknown }): void {
  // Asked before the theme ids move on: an appearance nobody changed is
  // "Sync with system" with the two default themes and no accent colour,
  // the defaults up to version 3. Strictly 'system': a set without the field
  // says nothing about it.
  const untouched = s.themeMode === 'system' && (s.lightTheme ?? 'daylight') === 'daylight' && (s.darkTheme ?? 'graphite') === 'graphite' && !s.accentColor;
  for (const key of ['theme', 'lightTheme', 'darkTheme'] as const) {
    if (typeof s[key] === 'string') s[key] = currentThemeId(s[key]);
  }
  if (untouched) {
    s.themeMode = 'fixed';
    s.theme = 'daylight';
  }
  // The text size was a factor with 1 for "normal": normal now follows the system.
  if ('fontScale' in s) {
    const scale = s.fontScale;
    delete s.fontScale;
    if (scale === 1) s.textSize = 'system';
    else if (isTextSize(scale)) s.textSize = scale;
  }
}

type PersistErrorListener = (error: unknown) => void;
const persistErrorListeners = new Set<PersistErrorListener>();
let lastWriteFailed = false;

/**
 * Calls `listener` whenever the settings could not be saved on this device
 * (storage full, blocked or gone). The change still applies for as long as
 * the app runs; `update` never throws for it. Returns a function that stops
 * listening.
 */
export function onPersistError(listener: PersistErrorListener): () => void {
  persistErrorListeners.add(listener);
  return () => void persistErrorListeners.delete(listener);
}

/** Whether the last attempt to save the settings on this device failed. */
export function settingsWriteFailed(): boolean {
  return lastWriteFailed;
}

function persistFailed(error: unknown): void {
  lastWriteFailed = true;
  for (const listener of [...persistErrorListeners]) {
    try {
      listener(error);
    } catch {
      // One listener's failure is not the store's.
    }
  }
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'calendar.settings',
      version: SETTINGS_VERSION,
      // A tab whose accounts are out of date would write back the e-mail
      // addresses of an account that another tab removed.
      storage: createJSONStorage(() => {
        const storage = window.localStorage;
        return {
          getItem: (name) => storage.getItem(name),
          setItem: (name, value) => {
            if (!tabIsCurrent()) return;
            try {
              storage.setItem(name, value);
              lastWriteFailed = false;
            } catch (error) {
              persistFailed(error);
            }
          },
          removeItem: (name) => {
            if (!tabIsCurrent()) return;
            try {
              storage.removeItem(name);
            } catch (error) {
              persistFailed(error);
            }
          },
        };
      }),
      migrate: (state, version) => migrateSettings(state, version) as SettingsStore,
    },
  ),
);
