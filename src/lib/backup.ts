// The one-file backup of what this device keeps itself (docs/DESIGN.md §5a):
// every calendar and task list of the device with all their events and tasks
// as iCalendar text, the feeds and holiday calendars, and the settings. A
// calendar kept on a server is kept there and is not in it.
//
// Restoring never deletes anything: a calendar of the backup goes into the
// device's calendar of the same id when there is one (an item of the same UID
// is replaced, the others are added), else into a new one; feeds and holiday
// calendars the device does not have are added; the settings only when asked.
import { cleanEntry, withCalendarAlarms, type CalendarAlarms } from './calendarAlarms';
import { holidayCountry } from './holidays';
import { splitIcsFile, type ImportItem } from './importExport';
import { isUnreadable, isGeneratedCalendar, LOCAL_ACCOUNT_ID, useData, type Calendar } from '@/store/data';
import { isExtraLang } from '@/i18n/languages';
import {
  DEFAULT_SETTINGS,
  FAB_ACTIONS,
  isBackupReminderDays,
  isTextSize,
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  migrateSettings,
  SETTINGS_VERSION,
  useSettings,
  VIEWS,
  type Settings,
} from '@/store/settings';
import { ownDeviceCalendars } from './deviceStorage';

/** What the file says it is; a file without it is not a backup of this app. */
export const BACKUP_FORMAT = 'calendar-ce-backup';
/** The version of the file's layout this app writes and reads. */
export const BACKUP_VERSION = 1;

/** A file larger than this is not read: no device keeps that much, and reading it could stall the page. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_CALENDARS = 1000;
const MAX_ITEMS = 250_000;
/** One event or task as text; the largest real ones (long series with their exceptions) stay far below. */
const MAX_OBJECT_CHARS = 4 * 1024 * 1024;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;

/** A feed or a holiday calendar: what makes it again on another device (its items come from the feed or the app). */
export interface BackupGenerated {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  order: number;
  subscriptionUrl?: string;
  holidayCountry?: string;
}

/** The feeds and holiday calendars among `calendars`, as the file keeps them. */
export function generatedDefs(calendars: readonly Calendar[]): BackupGenerated[] {
  return calendars.filter(isGeneratedCalendar).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    visible: c.visible,
    order: c.order,
    ...(c.subscriptionUrl ? { subscriptionUrl: c.subscriptionUrl } : {}),
    ...(c.holidayCountry ? { holidayCountry: c.holidayCountry } : {}),
  }));
}

/** One calendar or task list of the device, with its items. */
export interface BackupCalendar {
  id: string;
  name: string;
  color: string;
  description?: string;
  components: ('VEVENT' | 'VTODO')[];
  visible: boolean;
  order: number;
  /** Its own default notifications (Settings › Calendars › the calendar), if it has any. */
  alarms?: CalendarAlarms;
  /** Each event or task (a series with its exceptions) as one iCalendar text, as the device keeps it. */
  objects: string[];
}

/** The file, as JSON. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO 8601. */
  createdAt: string;
  /** The app's version that wrote it. */
  app: string;
  /** The settings' version (`SETTINGS_VERSION`), so a newer app can bring them up to date. */
  settingsVersion: number;
  settings: Partial<Settings>;
  calendars: BackupCalendar[];
  /** Feeds and holiday calendars, as the device defines them. */
  generated: BackupGenerated[];
}

export interface MadeBackup {
  text: string;
  calendars: number;
  items: number;
  /** Names of calendars whose stored items could not be read at start: they are not in the file. */
  unreadable: string[];
}

/** Settings that belong to the device or are carried per calendar: never taken from a file. */
const NOT_RESTORED: readonly (keyof Settings)[] = ['calendarAlarms', 'defaultCalendarId', 'defaultTaskListId', 'deviceProfile' as keyof Settings];

/** The day's date as the file's name has it, in the device's time. */
function day(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The file's name: the app's word for a backup and the date ("Calendar CE backup 2026-11-09.json"). */
export function backupFileName(label: string, now = new Date()): string {
  return `${label.replace(/[\\/:*?"<>|]+/g, '').trim() || 'calendar-backup'} ${day(now)}.json`;
}

function components(cal: Calendar): ('VEVENT' | 'VTODO')[] {
  return cal.components.filter((c): c is 'VEVENT' | 'VTODO' => c === 'VEVENT' || c === 'VTODO');
}

/** The backup of what the stores hold now. */
export function makeBackup(now = new Date(), version: string = __APP_VERSION__): MadeBackup {
  const { calendars, objects } = useData.getState();
  const settings = useSettings.getState();
  const unreadable: string[] = [];
  const out: BackupCalendar[] = [];
  let items = 0;
  for (const cal of ownDeviceCalendars(calendars).sort((a, b) => a.order - b.order)) {
    // Nothing of it was read at start: an empty list here would say it is empty.
    if (isUnreadable(cal.id)) {
      unreadable.push(cal.name);
      continue;
    }
    const kept = Object.values(objects[cal.id] ?? {}).map((o) => o.data);
    items += kept.length;
    const alarms = cleanEntry(settings.calendarAlarms?.[cal.id]);
    out.push({
      id: cal.id,
      name: cal.name,
      color: cal.color,
      ...(cal.description ? { description: cal.description } : {}),
      components: components(cal),
      visible: cal.visible,
      order: cal.order,
      ...(alarms ? { alarms } : {}),
      objects: kept,
    });
  }
  const own: Record<string, unknown> = {};
  for (const key of [...Object.keys(DEFAULT_SETTINGS), 'defaultCalendarId', 'defaultTaskListId'] as (keyof Settings)[]) {
    if (key === 'calendarAlarms' || settings[key] === undefined) continue;
    own[key] = settings[key];
  }
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    app: version,
    settingsVersion: SETTINGS_VERSION,
    settings: own as Partial<Settings>,
    calendars: out,
    generated: generatedDefs(calendars),
  };
  return { text: JSON.stringify(file, null, 1), calendars: out.length, items, unreadable };
}

// -----------------------------------------------------------------------------
// Reading a file

export type BackupProblem = 'not-backup' | 'newer' | 'damaged' | 'too-large';

/** Why a file cannot be restored; `problem` says which, for the interface's words. */
export class BackupError extends Error {
  problem: BackupProblem;
  constructor(problem: BackupProblem) {
    super(`Backup file: ${problem}`);
    this.name = 'BackupError';
    this.problem = problem;
  }
}

export interface ParsedCalendar {
  id: string;
  name: string;
  color: string;
  description?: string;
  components: ('VEVENT' | 'VTODO')[];
  visible: boolean;
  order: number;
  alarms?: CalendarAlarms;
  items: ImportItem[];
}

export interface ParsedBackup {
  createdAt: Date;
  app: string;
  calendars: ParsedCalendar[];
  generated: BackupGenerated[];
  /** The settings that this app can take, as it keeps them. */
  settings: Partial<Settings>;
  /** The calendar and task list new items went to, by their ids in the file. */
  defaults: { calendar?: string; taskList?: string };
  /** Events and tasks in all calendars. */
  items: number;
  /** Items that could not be read and are left out. */
  damaged: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const oneOf =
  <T>(...values: T[]) =>
  (v: unknown) =>
    values.includes(v as T);
const wholeIn = (min: number, max: number) => (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const textUpTo = (max: number) => (v: unknown) => typeof v === 'string' && v.length <= max;
const alarmList = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every((m) => typeof m === 'number' && Number.isInteger(m) && Math.abs(m) <= 10 * 366 * 1440);
function isTimeZone(v: unknown): boolean {
  if (typeof v !== 'string' || !v || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/**
 * What a setting's value has to be, beyond its kind, to be taken from a
 * file: a file may come from anywhere, and one value the interface cannot
 * use would stop it. A value that fails is left out; the device keeps its own.
 */
const CHECKS: Partial<Record<keyof Settings, (value: unknown) => boolean>> = {
  themeMode: oneOf('fixed', 'system'),
  density: oneOf('comfortable', 'compact'),
  eventStyle: oneOf('filled', 'tonal', 'soft', 'outline'),
  shape: oneOf('sharp', 'rounded', 'round'),
  surface: oneOf('panel', 'card'),
  language: oneOf('auto', 'en', 'pl'),
  deviceLanguage: (v) => v === '' || isExtraLang(v),
  textSize: isTextSize,
  weekStartsOn: oneOf(0, 1, 6),
  timeFormat: oneOf('12h', '24h', 'auto'),
  defaultView: (v) => VIEWS.some((view) => view.id === v),
  customDays: wholeIn(MIN_CUSTOM_DAYS, MAX_CUSTOM_DAYS),
  fabAction: (v) => FAB_ACTIONS.includes(v as Settings['fabAction']),
  dayStartHour: wholeIn(0, 23),
  defaultEventDuration: wholeIn(1, 7 * 24 * 60),
  syncIntervalMinutes: wholeIn(0, 24 * 60),
  defaultAlarms: alarmList,
  defaultAllDayAlarms: alarmList,
  secondaryTimezone: isTimeZone,
  theme: textUpTo(64),
  lightTheme: textUpTo(64),
  darkTheme: textUpTo(64),
  fontFamily: textUpTo(64),
  accentColor: textUpTo(64),
  myEmails: textUpTo(4096),
  backupReminderDays: isBackupReminderDays,
};

/** The settings of a file that this app can take: known names, usable values, brought up to date. */
export function restorableSettings(value: unknown, version: unknown): Partial<Settings> {
  if (!isObject(value)) return {};
  const sv = typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= SETTINGS_VERSION ? version : SETTINGS_VERSION;
  const migrated = migrateSettings(value, sv) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (NOT_RESTORED.includes(key)) continue;
    const v = migrated[key];
    if (v === undefined) continue;
    const check = CHECKS[key];
    if (check ? check(v) : typeof v === typeof defaults[key] && Array.isArray(v) === Array.isArray(defaults[key])) out[key] = v;
  }
  return out as Partial<Settings>;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A feed or holiday calendar of the file, as the device takes one; none for anything else. */
function usableGenerated(value: unknown): BackupGenerated | undefined {
  if (!isObject(value)) return undefined;
  const id = text(value.id, 4200);
  const name = text(value.name, MAX_NAME);
  const color = text(value.color, 64);
  if (!id?.startsWith(`${LOCAL_ACCOUNT_ID}|`) || !name || !color) return undefined;
  const def: BackupGenerated = { id, name, color, visible: value.visible !== false, order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : 0 };
  const feed = text(value.subscriptionUrl, 4096);
  const country = text(value.holidayCountry, 8);
  // Exactly one source: an http(s) feed, or a country the app knows the holidays of.
  if (!feed === !country) return undefined;
  if (feed) {
    if (!isHttpUrl(feed)) return undefined;
    def.subscriptionUrl = feed;
  } else {
    if (!holidayCountry(country!)) return undefined;
    def.holidayCountry = country;
  }
  return def;
}

/** Reads a calendar of the file and its items; none when it is not one. Counts items it cannot read. */
function usableCalendar(value: unknown, count: { items: number; damaged: number }): ParsedCalendar | undefined {
  if (!isObject(value)) return undefined;
  const id = text(value.id, 4200);
  const name = text(value.name, 10_000);
  const parts = Array.isArray(value.components) ? value.components.filter((c): c is 'VEVENT' | 'VTODO' => c === 'VEVENT' || c === 'VTODO') : [];
  if (!id || name === undefined || !parts.length || !Array.isArray(value.objects)) return undefined;
  const items: ImportItem[] = [];
  for (const raw of value.objects) {
    if (count.items >= MAX_ITEMS) throw new BackupError('too-large');
    if (typeof raw !== 'string' || raw.length > MAX_OBJECT_CHARS) {
      count.damaged++;
      continue;
    }
    try {
      // One stored object is one UID; a file edited by hand may hold more.
      for (const item of splitIcsFile(raw)) {
        if (!parts.includes(item.kind === 'task' ? 'VTODO' : 'VEVENT')) continue;
        items.push(item);
        count.items++;
      }
    } catch {
      count.damaged++;
    }
  }
  const color = text(value.color, 64);
  const alarms = cleanEntry(value.alarms);
  return {
    id,
    name: name.slice(0, MAX_NAME),
    color: color ?? '#d12e2c',
    ...(text(value.description, 1_000_000) ? { description: (value.description as string).slice(0, MAX_DESCRIPTION) } : {}),
    components: [...new Set(parts)],
    visible: value.visible !== false,
    order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : 0,
    ...(alarms ? { alarms } : {}),
    items,
  };
}

/**
 * Reads a backup file. Throws `BackupError` for a file that is not one of
 * this app's backups (`not-backup`), one from a newer layout (`newer`), one
 * that cannot be read (`damaged`) or one too large to read (`too-large`).
 * Items that cannot be read are left out and counted.
 */
export function parseBackup(raw: string): ParsedBackup {
  if (raw.length > MAX_BACKUP_BYTES) throw new BackupError('too-large');
  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch {
    throw new BackupError(raw.trimStart().startsWith('{') ? 'damaged' : 'not-backup');
  }
  if (!isObject(file) || file.format !== BACKUP_FORMAT) throw new BackupError('not-backup');
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1) throw new BackupError('damaged');
  if (file.version > BACKUP_VERSION) throw new BackupError('newer');
  const createdAt = new Date(typeof file.createdAt === 'string' ? file.createdAt : NaN);
  if (Number.isNaN(createdAt.getTime()) || !Array.isArray(file.calendars)) throw new BackupError('damaged');
  if (file.calendars.length > MAX_CALENDARS) throw new BackupError('too-large');

  const count = { items: 0, damaged: 0 };
  const calendars: ParsedCalendar[] = [];
  const seen = new Set<string>();
  for (const value of file.calendars) {
    const cal = usableCalendar(value, count);
    if (!cal || seen.has(cal.id)) continue;
    seen.add(cal.id);
    calendars.push(cal);
  }
  const generated: BackupGenerated[] = [];
  for (const value of Array.isArray(file.generated) ? file.generated.slice(0, MAX_CALENDARS) : []) {
    const def = usableGenerated(value);
    if (def && !generated.some((g) => g.id === def.id)) generated.push(def);
  }
  const settings = isObject(file.settings) ? file.settings : {};
  return {
    createdAt,
    app: text(file.app, 32) ?? '',
    calendars,
    generated,
    settings: restorableSettings(settings, file.settingsVersion),
    defaults: { calendar: text(settings.defaultCalendarId, 4200), taskList: text(settings.defaultTaskListId, 4200) },
    items: count.items,
    damaged: count.damaged,
  };
}

// -----------------------------------------------------------------------------
// Restoring

export interface RestoreOptions {
  /** Take the file's settings too. */
  settings: boolean;
  /** `done` of `total` items are stored. */
  onProgress?: (done: number, total: number) => void;
}

export interface RestoreResult {
  /** Calendars and task lists that took items or were made. */
  calendars: number;
  /** Of them, the ones made anew. */
  created: number;
  /** Items stored. */
  items: number;
  /** Feeds and holiday calendars added. */
  generated: number;
  /** Names of feeds that could not be fetched, and so were not added. */
  feedsFailed: string[];
}

const sameParts = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));

/** The device's own calendar a calendar of the file goes into: the one of the same id, if it can take it. */
function sameCalendar(cal: ParsedCalendar): Calendar | undefined {
  const found = useData.getState().calendars.find((c) => c.id === cal.id);
  if (!found || found.accountId !== LOCAL_ACCOUNT_ID || isGeneratedCalendar(found) || found.readOnly || isUnreadable(found.id)) return undefined;
  return sameParts(found.components, cal.components) ? found : undefined;
}

/**
 * Puts a backup's calendars on this device. Deletes nothing. Stops at the
 * first calendar that cannot be written (`importObjects` says why); what was
 * restored before stays.
 */
export async function restoreBackup(backup: ParsedBackup, options: RestoreOptions): Promise<RestoreResult> {
  const result: RestoreResult = { calendars: 0, created: 0, items: 0, generated: 0, feedsFailed: [] };
  const total = backup.items;
  /** The file's calendar ids and the device's they went to. */
  const placed = new Map<string, string>();
  let done = 0;
  options.onProgress?.(0, total);

  for (const cal of backup.calendars) {
    let target = sameCalendar(cal);
    if (!target) {
      target = await useData.getState().createCalendar(LOCAL_ACCOUNT_ID, {
        name: cal.name,
        color: cal.color,
        components: cal.components,
        description: cal.description,
        visible: cal.visible,
        order: cal.order,
      });
      result.created++;
    }
    placed.set(cal.id, target.id);
    result.calendars++;
    if (cal.alarms && (cal.id !== target.id || !useSettings.getState().calendarAlarms?.[target.id])) {
      const s = useSettings.getState();
      s.update({ calendarAlarms: withCalendarAlarms(s.calendarAlarms, target.id, cal.alarms) });
    }
    if (!cal.items.length) continue;
    const before = done;
    result.items += await useData.getState().importObjects(target.id, cal.items, { onProgress: (n) => options.onProgress?.(before + n, total) });
    done += cal.items.length;
    options.onProgress?.(done, total);
  }

  // Feeds and holiday calendars the device does not have yet, made as when they are added by
  // hand (a feed is fetched first, so one that cannot be reached now is named instead), then
  // shown or hidden and placed as in the file.
  const current = generatedDefs(useData.getState().calendars);
  const missing = backup.generated.filter((d) => !current.some((c) => (d.subscriptionUrl ? c.subscriptionUrl === d.subscriptionUrl : c.holidayCountry === d.holidayCountry)));
  for (const def of missing) {
    let made: Calendar;
    if (def.holidayCountry) made = useData.getState().addHolidayCalendar({ country: def.holidayCountry, name: def.name, color: def.color });
    else {
      try {
        made = await useData.getState().addSubscription({ url: def.subscriptionUrl!, name: def.name, color: def.color });
      } catch {
        result.feedsFailed.push(def.name);
        continue;
      }
    }
    if (made.visible !== def.visible || made.order !== def.order) await useData.getState().updateCalendar(made.id, { visible: def.visible, order: def.order });
    result.generated++;
  }

  if (options.settings) {
    const patch: Partial<Settings> = { ...backup.settings };
    const calendar = backup.defaults.calendar && placed.get(backup.defaults.calendar);
    const taskList = backup.defaults.taskList && placed.get(backup.defaults.taskList);
    if (calendar) patch.defaultCalendarId = calendar;
    if (taskList) patch.defaultTaskListId = taskList;
    useSettings.getState().update(patch);
  }
  return result;
}
