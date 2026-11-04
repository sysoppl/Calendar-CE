// Accounts, calendars and calendar objects, plus the sync engine.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { localName, localeModule, resolveLang, t } from '@/i18n';
import {
  backendFor,
  BackendError,
  isBackendError,
  PUT_BATCH,
  type AccountKind,
  type BackendErrorCode,
  type CalendarBackend,
  type ComponentType,
  type NewObject,
  type RemoteCalendar,
  type RemoteCalendarPatch,
  type RemoteObject,
  type RemoteObjectRef,
} from '@/lib/backend';
import { discoverCalDav } from '@/lib/backend/caldav';
import { dropCalendarAlarms } from '@/lib/calendarAlarms';
import { DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR } from '@/lib/color';
import { assertHttpUrl, assertNoCredentials, DavHttpError, DirectFetchUnavailable, fetchFeedDirect, normalizeServerUrl, resolveRedirect, type DavResponseRaw, type Transport } from '@/lib/dav/transport';
import { holidaysIn } from '@/lib/holidays';
import { createEventIcs, type WriteOp } from '@/lib/ical/events';
import { clearParseCache, errorKind, parseObject, type RawObject } from '@/lib/ical/parse';
import { splitIcsFile } from '@/lib/importExport';
import { isNative, transportFor } from '@/lib/platform';
import { readSecret, sealSecret, type SecretFailure } from '@/lib/secretBox';
import { deleteObjects, deleteObjectsWithPrefix, loadObjects, saveObjects } from '@/lib/storage';
import { changeAccounts, tabIsCurrent } from '@/lib/tabs';
import { randomCalendarColor } from '@/theme/themes';
import { useApp } from './app';
import { useSettings } from './settings';

export type { AccountKind };

export interface Account {
  /** `local`, or a random id for CalDAV. */
  id: string;
  kind: AccountKind;
  name: string;
  serverUrl?: string;
  username?: string;
  /**
   * CalDAV password. Kept in memory; stored in clear only where an earlier
   * version left it so, until it can be wrapped into `passwordBox`.
   */
  password?: string;
  /** The password as wrapped by `secretBox`: the form that is stored. */
  passwordBox?: string;
  principalUrl?: string;
  homeUrl?: string;
  email?: string;
  useProxy: boolean;
  lastSync?: number;
  error?: string;
  /**
   * What kind of failure `error` is, for the status line and the automatic
   * sync (lib/autoSync.ts): 'auth' asks for the password again, 'network' is
   * a server out of reach. Unset when the last sync went through.
   */
  errorCode?: BackendErrorCode;
}

export interface Calendar {
  /** `${accountId}|${remoteId}` */
  id: string;
  accountId: string;
  /** The calendar's id on its backend: the collection URL for CalDAV. */
  remoteId?: string;
  /** Collection address; CalDAV calendars only. */
  url?: string;
  name: string;
  color: string;
  description?: string;
  components: ComponentType[];
  readOnly: boolean;
  visible: boolean;
  ctag?: string;
  syncToken?: string;
  order: number;
  /** Read-only ICS/webcal feed this calendar mirrors. */
  subscriptionUrl?: string;
  lastFetched?: number;
  /** Country whose public holidays this read-only calendar is generated from. */
  holidayCountry?: string;
  /** Language and year the holidays were generated for. */
  holidayVersion?: string;
}

export interface NewCalDavAccount {
  name?: string;
  serverUrl: string;
  username: string;
  password: string;
  useProxy: boolean;
}

export interface NewCalendar {
  name: string;
  color: string;
  components: ComponentType[];
  description?: string;
  visible?: boolean;
  order?: number;
}

export interface ImportOptions {
  /** `done` of `total` items are stored. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Thrown by `importObjects` when it stops early. What was stored before the
 * failure stays stored; `imported` says how much that is.
 */
export class ImportError extends Error {
  imported: number;
  total: number;
  constructor(cause: unknown, imported: number, total: number) {
    super(errorText(cause), { cause });
    this.name = 'ImportError';
    this.imported = imported;
    this.total = total;
  }
}

type ObjectMap = Record<string, RawObject>;

interface PersistedData {
  accounts: Account[];
  calendars: Calendar[];
}

interface DataState extends PersistedData {
  hydrated: boolean;
  objects: Record<string, ObjectMap>;
  syncing: Record<string, boolean>;
  /** Incremented on every object change; used as a cheap memo key. */
  revision: number;

  /** Loads what is stored on the device. Safe to call more than once. */
  init: () => Promise<void>;
  /** Gives the local account a calendar and a task list unless it has them. */
  setupLocalDefaults: () => Promise<void>;
  addCalDavAccount: (input: NewCalDavAccount) => Promise<Account>;
  updateAccount: (id: string, patch: Partial<Omit<Account, 'id' | 'kind' | 'password' | 'passwordBox'>>) => void;
  setAccountPassword: (id: string, password: string) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  /**
   * Brings the account's calendars up to date. `full` lists every calendar
   * in whole instead of asking for changes since the last sync, so nothing
   * rests on what earlier answers said (a move checks its copy this way).
   */
  syncAccount: (id: string, options?: { full?: boolean }) => Promise<void>;
  syncAll: () => Promise<void>;
  setCalendarVisible: (id: string, visible: boolean) => void;
  showOnlyCalendar: (id: string) => void;
  updateCalendar: (id: string, patch: Partial<Pick<Calendar, 'name' | 'color' | 'description' | 'visible' | 'order'>>) => Promise<void>;
  createCalendar: (accountId: string, input: NewCalendar) => Promise<Calendar>;
  deleteCalendar: (id: string) => Promise<void>;
  /**
   * Applies writes in order; resolves to the URL each op touched. When one
   * fails, the ones before it are taken back as far as that is possible.
   */
  applyOps: (ops: WriteOp[]) => Promise<string[]>;
  moveObject: (url: string, targetCalendarId: string, data: string, uid: string) => Promise<void>;
  /** Stores many objects; one whose UID the calendar already has replaces it. Resolves to the number stored. */
  importObjects: (calendarId: string, items: NewObject[], options?: ImportOptions) => Promise<number>;
  addSubscription: (input: { url: string; name: string; color: string }) => Promise<Calendar>;
  refreshSubscription: (calendarId: string, force?: boolean) => Promise<void>;
  addHolidayCalendar: (input: { country: string; name: string; color: string }) => Calendar;
  /** Regenerates holiday calendars when the year or the language has changed. */
  refreshHolidayCalendars: () => void;
}

export const LOCAL_ACCOUNT_ID = 'local';

/** Version of what is stored under `calendar.data`; `migrateData` brings older states up to it. */
export const DATA_VERSION = 2;

function calendarId(accountId: string, remoteId: string) {
  return `${accountId}|${remoteId}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The kind of a failure, as an account keeps it next to its text. */
function errorCodeOf(err: unknown): BackendErrorCode {
  return isBackendError(err) ? err.code : 'other';
}

/**
 * A server-side calendar did not take a change that the device shows already
 * (its visibility or its place in the list). `retry` sends it again.
 */
export interface CalendarPatchFailure {
  calendar: Calendar;
  patch: RemoteCalendarPatch;
  error: unknown;
  retry: () => void;
}

const patchFailureListeners = new Set<(failure: CalendarPatchFailure) => void>();

/**
 * Calls `listener` whenever a calendar's server refused or missed a change
 * of its visibility or order. The interface registers this (to say so with a
 * "Try again"); the store itself shows nothing. Returns a function that stops
 * listening.
 */
export function onCalendarPatchFailure(listener: (failure: CalendarPatchFailure) => void): () => void {
  patchFailureListeners.add(listener);
  return () => void patchFailureListeners.delete(listener);
}

function reportPatchFailure(failure: CalendarPatchFailure): void {
  for (const listener of [...patchFailureListeners]) {
    try {
      listener(failure);
    } catch {
      // A listener's failure is not the store's.
    }
  }
}

// Text a server sends is stored in localStorage, which holds a few MiB for
// the whole app; one oversized property must not be able to fill it.
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_ERROR = 2000;
/** Addresses and sync cursors are used as they are or not at all: a cut one would be wrong. */
const MAX_KEY = 4096;

const clip = <T extends string | undefined>(text: T, max: number): T =>
  typeof text === 'string' && text.length > max ? (`${text.slice(0, max - 1)}…` as T) : text;
const keyOrNothing = (key: string | undefined) => (key && key.length <= MAX_KEY ? key : undefined);

/**
 * localStorage that cannot throw. zustand writes it inside every `set`, after
 * memory has changed, so a full storage would make each later store action
 * fail half-way; this way only the copy on disk falls behind. A tab whose
 * accounts are out of date writes nothing (`tabIsCurrent`).
 */
const dataStorage = createJSONStorage<PersistedData>(() => {
  const storage = window.localStorage;
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      if (!tabIsCurrent()) return;
      try {
        storage.setItem(name, value);
      } catch (err) {
        console.warn('Could not save calendar.data', err);
      }
    },
    removeItem: (name) => {
      if (tabIsCurrent()) storage.removeItem(name);
    },
  };
});

/** Read-only calendars the app fills itself: feeds and generated holidays. */
export function isGeneratedCalendar(cal: Calendar): boolean {
  return !!(cal.subscriptionUrl || cal.holidayCountry);
}

/** The UID of a stored object, if it has one that can be read. */
export function uidOf(raw: RawObject): string | undefined {
  const parsed = parseObject(raw);
  // Objects without a UID are given their URL as one; that is not a UID to copy.
  return parsed && parsed.uid !== raw.url ? parsed.uid : undefined;
}

const removalListeners = new Set<(accountId: string) => void>();

/**
 * Runs `listener` with the id of every account `removeAccount` removes, so
 * what other modules keep about it goes with it (the migration journal), without
 * this store importing them. Returns the way to stop.
 */
export function onAccountRemoved(listener: (accountId: string) => void): () => void {
  removalListeners.add(listener);
  return () => removalListeners.delete(listener);
}

/**
 * A CalDAV account stored with the address as typed without a scheme
 * ("posteo.de:8443/"), which discovery read as https: stored that way.
 */
function withSchemeAdded(a: Account): Account {
  if (a.kind !== 'caldav' || typeof a.serverUrl !== 'string' || a.serverUrl.includes('://')) return a;
  try {
    return { ...a, serverUrl: assertHttpUrl(`https://${a.serverUrl.trim()}`) };
  } catch {
    return a;
  }
}

/**
 * Brings a stored state up to date. Zustand throws the state away when the
 * version changes and there is no such function, which would lose every
 * account, so each bump of `DATA_VERSION` gets a step here.
 */
export function migrateData(state: unknown, version: number): PersistedData {
  const s = (state ?? {}) as Partial<PersistedData>;
  // Entries without the fields everything relies on are left out: one of
  // them would otherwise stop every start at the loading screen.
  const entry = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  const accounts = (Array.isArray(s.accounts) ? s.accounts : [])
    .filter((a) => entry(a) && typeof a.id === 'string' && typeof a.kind === 'string')
    .map(withSchemeAdded);
  let calendars = (Array.isArray(s.calendars) ? s.calendars : []).filter(
    (c) => entry(c) && typeof c.id === 'string' && typeof c.accountId === 'string' && Array.isArray(c.components),
  );
  // v2: calendars name their id on the backend instead of implying it by a URL.
  if (version < 2) {
    calendars = calendars.map((c) => (c.remoteId ? c : { ...c, remoteId: c.url ?? c.id.slice(c.accountId.length + 1) }));
  }
  return { accounts, calendars };
}

/**
 * Accounts whose password, entered in this session, could not be wrapped
 * (this browser cannot keep the key): it stays in memory and is asked for
 * again after the session, never stored in clear.
 */
const unwrapped = new Set<string>();

/** Whether the account's password is kept in memory only, as it could not be wrapped (`unwrapped`). */
export function passwordInMemoryOnly(accountId: string): boolean {
  return unwrapped.has(accountId);
}

/** Notes whether wrapping an account's password worked; returns the box. */
function noteWrapped(id: string, box: string | null): string | undefined {
  if (box) unwrapped.delete(id);
  else unwrapped.add(id);
  return box ?? undefined;
}

/**
 * What of an account goes to localStorage: no clear password once it is
 * wrapped or when a new one could not be. A clear one an earlier version stored stays as it was until it can be
 * wrapped (`unlockPasswords`), so no account loses its password to an update.
 */
function storedAccount(a: Account): Account {
  if (!a.passwordBox && !unwrapped.has(a.id)) return a;
  const { password: _clear, ...rest } = a;
  return rest;
}

function localAccount(): Account {
  return { id: LOCAL_ACCOUNT_ID, kind: 'local', name: 'On this device', useProxy: false };
}

function defaultCalendar(slot: 'personal' | 'tasks', taken: Calendar[]): Calendar {
  const tasks = slot === 'tasks';
  // The well-known id, unless something else already sits there.
  const remoteId = taken.some((c) => c.id === calendarId(LOCAL_ACCOUNT_ID, slot)) ? crypto.randomUUID() : slot;
  return {
    id: calendarId(LOCAL_ACCOUNT_ID, remoteId),
    accountId: LOCAL_ACCOUNT_ID,
    remoteId,
    name: tasks ? t('data.myTasks') : t('data.myCalendar'),
    color: tasks ? DEFAULT_TASK_COLOR : DEFAULT_CALENDAR_COLOR,
    components: [tasks ? 'VTODO' : 'VEVENT'],
    readOnly: false,
    visible: true,
    order: tasks ? 1 : 0,
  };
}

const HOLIDAY_YEARS_BACK = 1;
const HOLIDAY_YEARS_AHEAD = 5;

/**
 * The language the holiday names are written in, and the year. An extra
 * language whose dictionary has not arrived yet writes them in English and
 * says so, so that they are written again once it is there.
 */
function holidayVersion(): string {
  const lang = resolveLang(useSettings.getState());
  const written = lang === 'en' || lang === 'pl' || localeModule(lang) ? lang : 'en';
  return `${written}:${new Date().getFullYear()}`;
}

/** All-day events for a holiday calendar, a few years around the current one. */
function holidayObjects(cal: Calendar): ObjectMap {
  const lang = resolveLang(useSettings.getState());
  const year = new Date().getFullYear();
  const map: ObjectMap = {};
  for (let y = year - HOLIDAY_YEARS_BACK; y <= year + HOLIDAY_YEARS_AHEAD; y++) {
    holidaysIn(cal.holidayCountry!, y).forEach((h, i) => {
      const url = `holiday://${cal.id}/${y}-${i}`;
      const data = createEventIcs({
        uid: `holiday-${cal.holidayCountry}-${y}-${i}@calendar.patryk.pro`,
        title: localName(h.name, lang),
        description: '',
        location: '',
        start: h.date,
        end: new Date(h.date.getFullYear(), h.date.getMonth(), h.date.getDate() + 1),
        allDay: true,
        timezone: 'floating',
        alarms: [],
        busy: false,
        attendees: [],
        categories: [],
      });
      map[url] = { url, etag: String(data.length), calendarId: cal.id, data };
    });
  }
  return map;
}

const syncLocks = new Map<string, Promise<void>>();
/** Bumped when an account is removed, so a sync still running for it commits nothing. */
const epochs = new Map<string, number>();
/** URLs with a write on its way to the backend; a sync leaves them alone. */
const writing = new Map<string, number>();
/** Calendars with a visibility or order change on its way; what the backend lists meanwhile is older. */
const patching = new Map<string, number>();
/** Calendars being renamed, recoloured or deleted on the server: a listing from meanwhile may be older. */
const editing = new Map<string, number>();
/** When each calendar's last such change was done, on `editClock`; a listing asked for before that is older. */
const lastEdit = new Map<string, number>();
let editClock = 0;
/** Local calendars whose stored objects could not be read: writing would replace what is there with less. */
const unreadable = new Set<string>();
/** Per account, the calendars its last sync could not bring up to date. */
const stale = new Map<string, Set<string>>();
let initializing: Promise<void> | undefined;
/**
 * Where items wait that a move took out of their calendar and could not put
 * anywhere yet (see `moveObject`). A key of the objects store, with no `|`,
 * so it is never taken for a calendar.
 */
const RESTORE_KEY = 'pending-restore';
let restoreQueue: Promise<unknown> = Promise.resolve();

function hold(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function release(counts: Map<string, number>, key: string) {
  const left = (counts.get(key) ?? 1) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
}

/** Runs `run` for every item, at most `limit` at a time. `run` must not reject. */
async function pooled<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Requests in flight during an import into a backend without a bulk call. */
const IMPORT_CONCURRENCY = 4;
/** Items between two updates of the store in that case. */
const IMPORT_CHUNK = 24;

const SUBSCRIPTION_TTL = 15 * 60000;

export function normalizeFeedUrl(url: string): string {
  const trimmed = url.trim();
  if (/^webcals?:\/\//i.test(trimmed)) return trimmed.replace(/^webcal(s?):\/\//i, 'https://');
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
}

/**
 * Feeds this tab fetched through the proxy after the browser could not fetch
 * them itself: tried that way first next time, so a feed whose server sends no
 * CORS headers is not downloaded twice every 15 minutes.
 */
const proxiedFeeds = new Set<string>();

/**
 * Whether the browser tries a feed itself before the proxy: an https feed
 * from the app's https page (a plain-http one would be blocked as mixed
 * content). The apps fetch everything natively, without the proxy, anyway.
 */
function directFeedFirst(url: string): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('https:') && !isNative && !proxiedFeeds.has(url);
}

/**
 * Downloads an ICS feed (following redirects) and splits it into objects. In
 * the browser the feed is fetched directly first, so its address and contents
 * do not pass the app's server; only when that is impossible (the feed's
 * server sends no CORS headers, or cannot be reached from here) does the
 * proxy fetch it.
 */
async function fetchFeed(cal: Calendar): Promise<ObjectMap> {
  const url = assertHttpUrl(cal.subscriptionUrl!);
  if (directFeedFirst(url)) {
    try {
      return feedObjects(cal, await fetchFeedDirect(url));
    } catch (err) {
      if (!(err instanceof DirectFetchUnavailable)) throw err;
    }
    const objects = await fetchFeedThrough(transportFor(true), cal, url);
    proxiedFeeds.add(url);
    return objects;
  }
  return fetchFeedThrough(transportFor(true), cal, url);
}

async function fetchFeedThrough(transport: Transport, cal: Calendar, start: string): Promise<ObjectMap> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const res = await transport({ method: 'GET', url, headers: { Accept: 'text/calendar, */*' } });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
      url = resolveRedirect(url, res.location);
      continue;
    }
    return feedObjects(cal, res);
  }
  throw new Error(t('dav.http.redirects'));
}

function feedObjects(cal: Calendar, res: DavResponseRaw): ObjectMap {
  if (res.status >= 400) throw new DavHttpError(res.status, t('data.feedHttp', { status: res.status }), res.body);
  if (!res.body.includes('BEGIN:VCALENDAR')) throw new Error(t('data.feedNotIcs'));
  const map: ObjectMap = {};
  for (const item of splitIcsFile(res.body)) {
    const objUrl = `sub://${cal.id}/${encodeURIComponent(item.uid)}`;
    map[objUrl] = { url: objUrl, etag: String(item.data.length), calendarId: cal.id, data: item.data };
  }
  return map;
}

type Change = { type: 'create' | 'update'; data: string; etag?: string } | { type: 'delete'; etag?: string };

interface Applied {
  calendarId: string;
  url: string;
  type: Change['type'];
  previous?: RawObject;
}

export const useData = create<DataState>()(
  persist(
    (set, get) => {
      const accountById = (id: string) => get().accounts.find((a) => a.id === id);
      const calendarById = (id: string) => get().calendars.find((c) => c.id === id);

      const patchAccount = (id: string, patch: Partial<Account>) => {
        // Errors quote what servers say.
        if (patch.error) patch = { ...patch, error: clip(patch.error, MAX_ERROR) };
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
      };

      const setObjects = (calId: string, map: ObjectMap) => {
        set((s) => ({ objects: { ...s.objects, [calId]: map }, revision: s.revision + 1 }));
      };

      /** Writes a calendar's objects as they are now to IndexedDB; rejects when that fails. */
      const storeObjects = (calId: string): Promise<void> => {
        const map = get().objects[calId];
        return map ? saveObjects(calId, Object.values(map)) : Promise.resolve();
      };

      /** The same for copies of what a server has: a failed write costs a download, nothing more. */
      const cacheObjects = (calId: string) => {
        void storeObjects(calId).catch((err) => console.warn('IndexedDB write failed', err));
      };

      const dropObjects = (ids: string[]) => {
        if (!ids.length) return;
        set((s) => {
          const objects = { ...s.objects };
          for (const id of ids) delete objects[id];
          return { objects, revision: s.revision + 1 };
        });
        for (const id of ids) {
          unreadable.delete(id);
          void deleteObjects(id);
        }
      };

      const findCalendarByObject = (url: string): Calendar | undefined => {
        const { objects, calendars } = get();
        const calId = Object.keys(objects).find((id) => objects[id][url]);
        return calendars.find((c) => c.id === calId);
      };

      /** True when the account's calendars live on a server, also while its backend cannot be used. */
      const isRemote = (account: Account | undefined): boolean => {
        if (!account) return false;
        try {
          return backendFor(account).remote;
        } catch {
          return true;
        }
      };

      /**
       * `listedFrom`: `editClock` when the listing was asked for. A calendar
       * renamed or deleted here since, or still being so, is as it is here:
       * the listing may predate the change, and would undo the name or bring
       * back the calendar.
       */
      const mergeRemoteCalendars = (account: Account, remote: RemoteCalendar[], listedFrom = editClock) => {
        const existing = get().calendars.filter((c) => c.accountId === account.id);
        const usable = remote.filter((rc) => keyOrNothing(rc.remoteId) && (rc.url === undefined || keyOrNothing(rc.url)));
        const newer = (id: string) => editing.has(id) || (lastEdit.get(id) ?? 0) > listedFrom;
        const merged: Calendar[] = usable.flatMap((rc, i) => {
          const id = calendarId(account.id, rc.remoteId);
          const prev = existing.find((c) => c.remoteId === rc.remoteId);
          if (newer(id)) return prev ? [prev] : [];
          // A change made here that is still on its way is newer than this listing.
          const mine = patching.has(id) ? prev : undefined;
          return {
            id,
            accountId: account.id,
            remoteId: rc.remoteId,
            url: rc.url,
            name: clip(rc.displayName, MAX_NAME),
            color: rc.color ?? prev?.color ?? randomCalendarColor(),
            description: clip(rc.description, MAX_DESCRIPTION),
            components: rc.components,
            readOnly: rc.readOnly,
            visible: mine?.visible ?? rc.visible ?? prev?.visible ?? true,
            ctag: prev?.ctag,
            syncToken: prev?.syncToken,
            order: mine?.order ?? rc.order ?? prev?.order ?? 100 + i,
          } satisfies Calendar;
        });
        const removed = existing.filter((c) => !merged.some((m) => m.id === c.id));
        set((s) => ({
          calendars: [...s.calendars.filter((c) => c.accountId !== account.id), ...merged],
        }));
        dropObjects(removed.map((c) => c.id));
        // The account's first calendars (it was just added): new items may go there now.
        if (!existing.length && merged.length) fillDefaultCalendars();
        return merged;
      };

      const syncCalendarObjects = async (backend: CalendarBackend, cal: Calendar, remote: RemoteCalendar, alive: () => boolean, full = false) => {
        const snapshot = get().objects[cal.id] ?? {};
        // A full sync compares the whole listing with what is held, as if nothing were.
        const hasData = cal.id in get().objects && !full;
        if (hasData && cal.ctag && remote.ctag && cal.ctag === remote.ctag) return;
        if (hasData && cal.syncToken && remote.syncToken && cal.syncToken === remote.syncToken) return;

        let changed: RemoteObjectRef[] = [];
        let deleted: string[] = [];
        let incremental = false;
        let token = remote.syncToken;

        if (hasData && cal.syncToken) {
          try {
            const r = await backend.changesSince(remote.remoteId, cal.syncToken);
            if (r) {
              incremental = true;
              changed = r.changed.filter((c) => snapshot[c.url]?.etag !== c.etag);
              deleted = r.deleted.filter((u) => snapshot[u]);
              token = r.token ?? remote.syncToken;
            }
          } catch (err) {
            // A full listing would fail the same way.
            if (isBackendError(err, 'auth', 'locked', 'network', 'rate-limit')) throw err;
          }
        }
        if (!incremental) {
          const refs = await backend.listObjects(remote.remoteId);
          const seen = new Set(refs.map((r) => r.url));
          changed = refs.filter((r) => snapshot[r.url]?.etag !== r.etag);
          deleted = Object.keys(snapshot).filter((u) => !seen.has(u));
        }
        const fetched = changed.length ? await backend.getObjects(remote.remoteId, changed.map((c) => c.url)) : [];
        if (!alive()) return;

        // Applied to the objects as they are now, not as they were when the
        // requests went out: anything written here in the meantime is newer
        // than what the server told us, and stays.
        const now = get().objects[cal.id] ?? {};
        const next: ObjectMap = { ...now };
        const untouched = (url: string) => now[url] === snapshot[url] && !writing.has(url);
        let raced = false;
        for (const url of deleted) {
          if (untouched(url)) delete next[url];
          else raced = true;
        }
        const etags = new Map(changed.map((c) => [c.url, c.etag]));
        for (const f of fetched) {
          if (untouched(f.url)) next[f.url] = { url: f.url, etag: f.etag || etags.get(f.url) || '', calendarId: cal.id, data: f.data };
          else raced = true;
        }
        if (changed.length || deleted.length || !hasData) {
          setObjects(cal.id, next);
          cacheObjects(cal.id);
        }
        // Something was skipped: keep the old cursor so the next sync looks again.
        if (raced) return;
        set((s) => ({
          calendars: s.calendars.map((c) => (c.id === cal.id ? { ...c, ctag: keyOrNothing(remote.ctag), syncToken: keyOrNothing(token) } : c)),
        }));
      };

      /** Changes the list of items waiting to be put back; one change at a time. */
      const editRestores = (edit: (list: RawObject[]) => RawObject[]): Promise<void> => {
        const next = restoreQueue.then(async () => {
          const list = await loadObjects(RESTORE_KEY);
          // Unreadable is not empty: writing would lose what is there.
          if (!Array.isArray(list)) throw new Error(t('data.storageRead'));
          await saveObjects(RESTORE_KEY, edit(list)).catch((err) => {
            console.warn('IndexedDB write failed', err);
            throw new Error(t('data.storageWrite'));
          });
        });
        restoreQueue = next.catch(() => {});
        return next;
      };

      /**
       * After a sync of the account: what a move left nowhere goes back to
       * its calendar, unless it turned up in one after all (a write whose
       * answer was lost).
       */
      const putBack = async (accountId: string) => {
        const waiting = await loadObjects(RESTORE_KEY);
        for (const item of Array.isArray(waiting) ? waiting : []) {
          if (!item.calendarId?.startsWith(`${accountId}|`)) continue;
          const cal = calendarById(item.calendarId);
          const uid = uidOf(item);
          // A move only needs this for items with a UID; without one it could not be put back.
          if (!uid) continue;
          const held = (c: Calendar) => Object.values(get().objects[c.id] ?? {}).some((o) => uidOf(o) === uid);
          // A calendar that is gone took the item with it.
          if (cal && !get().calendars.some((c) => c.accountId === accountId && held(c))) {
            await get().applyOps([{ type: 'create', calendarId: cal.id, uid, data: item.data }]);
          }
          await editRestores((list) => list.filter((o) => o.url !== item.url));
        }
      };

      const runSync = async (accountId: string, full: boolean) => {
        // A password that could not be read at start may be readable now.
        if ((await openPassword(accountById(accountId))) === 'unavailable') {
          const err = new BackendError('locked', t('data.passwordUnavailable'));
          patchAccount(accountId, { error: err.message, errorCode: err.code });
          throw err;
        }
        const account = accountById(accountId);
        if (!account) return;
        const epoch = epochs.get(accountId) ?? 0;
        // The account may be removed (or removed and added again) while requests are out.
        const alive = () => (epochs.get(accountId) ?? 0) === epoch && !!accountById(accountId);
        let backend: CalendarBackend;
        try {
          backend = backendFor(account);
        } catch (err) {
          patchAccount(accountId, { error: errorText(err), errorCode: errorCodeOf(err) });
          throw err;
        }
        if (!backend.remote) return;
        set((s) => ({ syncing: { ...s.syncing, [accountId]: true } }));
        try {
          const listedFrom = editClock;
          const listed = await backend.listCalendars();
          if (!alive()) return;
          const remote = listed.filter((rc, i) => listed.findIndex((o) => o.remoteId === rc.remoteId) === i);
          const merged = mergeRemoteCalendars(account, remote, listedFrom);
          const errors: string[] = [];
          /** The kind of the first of those failures. */
          let errorCode: BackendErrorCode | undefined;
          const failed = new Set<string>();
          stale.set(accountId, failed);
          await Promise.all(
            merged.map(async (cal) => {
              const rc = remote.find((r) => r.remoteId === cal.remoteId)!;
              try {
                await syncCalendarObjects(backend, cal, rc, () => alive() && !!calendarById(cal.id), full);
              } catch (err) {
                failed.add(cal.id);
                if (isBackendError(err, 'auth', 'locked')) throw err;
                errors.push(`${cal.name}: ${errorText(err)}`);
                errorCode ??= errorCodeOf(err);
              }
            }),
          );
          if (alive()) patchAccount(accountId, { lastSync: Date.now(), error: errors.length ? errors.join('\n') : undefined, errorCode: errors.length ? errorCode : undefined });
          if (alive()) void putBack(accountId).catch((err) => console.warn('Could not put back moved items', errorKind(err)));
        } catch (err) {
          if (alive()) patchAccount(accountId, { error: errorText(err), errorCode: errorCodeOf(err) });
          throw err;
        } finally {
          if (alive()) set((s) => ({ syncing: { ...s.syncing, [accountId]: false } }));
        }
      };

      /** A sync that is sure to have started after this call. */
      const syncAfresh = async (accountId: string) => {
        await syncLocks.get(accountId)?.catch(() => {});
        await get().syncAccount(accountId);
      };

      /** The calendar and its backend, for a write. A read-only calendar takes none. */
      const writable = (cal: Calendar | undefined, missing: 'data.calendarMissing' | 'data.itemMissing'): { cal: Calendar; backend: CalendarBackend } => {
        if (!cal) throw new Error(t(missing));
        if (cal.readOnly) throw new Error(t('data.readOnly', { name: cal.name }));
        const account = accountById(cal.accountId);
        if (!account) throw new Error(t('data.accountMissing'));
        const backend = backendFor(account);
        if (unreadable.has(cal.id)) throw new Error(t('data.storageRead'));
        return { cal, backend };
      };

      /** One write, shown at once and taken back when the backend refuses it. */
      const writeObject = async (cal: Calendar, backend: CalendarBackend, url: string, change: Change): Promise<Applied> => {
        const previous = get().objects[cal.id]?.[url];
        // The URL follows from the UID, so this is the same item a second time.
        if (change.type === 'create' && previous) throw new BackendError('conflict', t('data.itemExists'));

        const show = (obj: RawObject | undefined) => {
          if (!calendarById(cal.id)) return;
          const map = { ...get().objects[cal.id] };
          if (obj) map[url] = obj;
          else delete map[url];
          setObjects(cal.id, map);
        };

        // Optimistic, and in memory only: what is not confirmed must not
        // survive a restart as if it were.
        show(change.type === 'delete' ? undefined : { url, etag: previous?.etag ?? '', calendarId: cal.id, data: change.data });
        hold(writing, url);
        try {
          let saved: RemoteObject | null = null;
          if (change.type === 'delete') await backend.deleteObject(url, change.etag || undefined);
          else saved = await backend.putObject(cal, url, change.data, change.type, change.type === 'update' ? change.etag || undefined : undefined);
          show(saved ? { url, etag: saved.etag, calendarId: cal.id, data: saved.data } : undefined);
          if (backend.remote) cacheObjects(cal.id);
          else {
            // For a local calendar this is the only copy: the write counts when it is on disk.
            await storeObjects(cal.id).catch((err) => {
              console.warn('IndexedDB write failed', err);
              throw new Error(t('data.storageWrite'));
            });
          }
          // Stored but not readable back; the next sync fetches it.
          if (change.type !== 'delete' && !saved) void get().syncAccount(cal.accountId).catch(() => {});
        } catch (err) {
          show(previous);
          cacheObjects(cal.id);
          if (isBackendError(err, 'conflict')) void get().syncAccount(cal.accountId).catch(() => {});
          throw err;
        } finally {
          release(writing, url);
        }
        return { calendarId: cal.id, url, type: change.type, previous };
      };

      const applyOne = async (op: WriteOp): Promise<Applied> => {
        if (op.type === 'create') {
          const { cal, backend } = writable(calendarById(op.calendarId), 'data.calendarMissing');
          return writeObject(cal, backend, backend.objectUrl(cal, op.uid), { type: 'create', data: op.data });
        }
        const { cal, backend } = writable(findCalendarByObject(op.url), 'data.itemMissing');
        return writeObject(cal, backend, op.url, op.type === 'delete' ? { type: 'delete', etag: op.etag } : { type: 'update', data: op.data, etag: op.etag });
      };

      /** Undoes one applied write, at the URL it went to. */
      const revert = async (done: Applied) => {
        const { cal, backend } = writable(calendarById(done.calendarId), 'data.calendarMissing');
        const current = get().objects[cal.id]?.[done.url];
        if (done.type === 'create') {
          if (current) await writeObject(cal, backend, done.url, { type: 'delete', etag: current.etag });
        } else if (done.previous) {
          const data = done.previous.data;
          await writeObject(cal, backend, done.url, current ? { type: 'update', data, etag: current.etag } : { type: 'create', data });
        }
      };

      /**
       * Tells a server-side calendar about a change that was already made
       * here. A failure keeps the change on the device and is reported
       * (`onCalendarPatchFailure`), with a retry that sends what the calendar
       * shows by then.
       */
      const pushCalendarPatch = (cal: Calendar, patch: RemoteCalendarPatch) => {
        const account = accountById(cal.accountId);
        if (!account || !cal.remoteId) return;
        let backend: CalendarBackend;
        try {
          backend = backendFor(account);
        } catch {
          return;
        }
        if (!backend.remote) return;
        hold(patching, cal.id);
        void backend
          .updateCalendar(cal.remoteId, patch)
          .catch((err) => {
            // The kind only: a server's error names its address.
            console.warn('Could not update the calendar on the server', errorKind(err));
            reportPatchFailure({
              calendar: cal,
              patch,
              error: err,
              retry: () => {
                // Changed again since, or gone: what it shows now is what goes.
                const now = calendarById(cal.id);
                if (!now) return;
                const again: RemoteCalendarPatch = {};
                for (const key of Object.keys(patch) as (keyof RemoteCalendarPatch)[]) (again as Record<string, unknown>)[key] = now[key as keyof Calendar];
                pushCalendarPatch(now, again);
              },
            });
          })
          .finally(() => release(patching, cal.id));
      };

      /**
       * Opens an account's wrapped password into memory, if it is not there
       * yet. Says why when it cannot: `unavailable` (the storage of its key
       * did not open this time) may pass, `lost` will not.
       */
      const openPassword = async (account: Account | undefined): Promise<SecretFailure | undefined> => {
        if (!account?.passwordBox || account.password !== undefined) return undefined;
        const read = await readSecret(account.passwordBox, account.id);
        if ('failure' in read) return read.failure;
        // Changed or removed meanwhile: what is there now wins.
        if (accountById(account.id)?.passwordBox === account.passwordBox) patchAccount(account.id, { password: read.value });
        return undefined;
      };

      /** Wraps passwords that are still stored in clear and unwraps the others for this session. */
      const unlockPasswords = async () => {
        for (const account of get().accounts) {
          if (account.passwordBox && account.password === undefined) {
            // Left without a password, the account says so when it is used.
            await openPassword(account);
          } else if (account.password !== undefined && !account.passwordBox) {
            const passwordBox = await sealSecret(account.password, account.id);
            // Null: this browser cannot keep the key. A password an earlier version stored stays stored as before.
            if (passwordBox) patchAccount(account.id, { passwordBox });
          }
        }
      };

      /** A calendar's objects from disk; `null` when what is there cannot be made sense of. */
      const readObjects = async (calId: string): Promise<ObjectMap | null> => {
        try {
          const list = await loadObjects(calId);
          if (!Array.isArray(list)) return null;
          return Object.fromEntries(list.filter((o) => typeof o?.url === 'string').map((o) => [o.url, o]));
        } catch {
          return null;
        }
      };

      const load = async () => {
        if (!accountById(LOCAL_ACCOUNT_ID)) set((s) => ({ accounts: [localAccount(), ...s.accounts] }));
        // The app has to start whatever happens here; an account without its
        // password says so when it is used.
        await unlockPasswords().catch((err) => console.warn('Could not prepare stored passwords', err));
        const entries = await Promise.all(get().calendars.map(async (c) => [c, await readObjects(c.id)] as const));
        const objects: Record<string, ObjectMap> = {};
        for (const [cal, map] of entries) {
          const remote = isRemote(accountById(cal.accountId));
          if (!map) {
            // A copy of a server is downloaded again. A local calendar is
            // closed for writing instead: its data may well still be there.
            if (!remote) unreadable.add(cal.id);
            continue;
          }
          // Remote calendars without cached data stay absent so the next
          // sync does a full download.
          if (remote && !Object.keys(map).length) continue;
          objects[cal.id] = map;
        }
        // Anything written while we were loading wins over the cache.
        set((s) => ({ objects: { ...objects, ...s.objects }, hydrated: true, revision: s.revision + 1 }));
        get().refreshHolidayCalendars();
      };

      return {
        hydrated: false,
        accounts: [],
        calendars: [],
        objects: {},
        syncing: {},
        revision: 0,

        init: () => (initializing ??= load()),

        setupLocalDefaults: async () => {
          if (!accountById(LOCAL_ACCOUNT_ID)) set((s) => ({ accounts: [localAccount(), ...s.accounts] }));
          const own = get().calendars.filter((c) => c.accountId === LOCAL_ACCOUNT_ID && !c.readOnly);
          const added: Calendar[] = [];
          if (!own.some((c) => c.components.includes('VEVENT'))) added.push(defaultCalendar('personal', get().calendars));
          if (!own.some((c) => c.components.includes('VTODO'))) added.push(defaultCalendar('tasks', get().calendars));
          if (!added.length) return;
          set((s) => ({ calendars: [...added, ...s.calendars] }));
          // Objects still stored under these ids (the list of calendars was
          // lost, the events were not) come back with them.
          for (const cal of added) {
            const map = await readObjects(cal.id);
            if (!map) unreadable.add(cal.id);
            else if (!(cal.id in get().objects)) setObjects(cal.id, map);
          }
          // Once it is known which of them can be written to.
          fillDefaultCalendars();
        },

        addCalDavAccount: async (input) => {
          const id = crypto.randomUUID();
          // As discovery reads it (https:// when none was typed).
          const serverUrl = normalizeServerUrl(input.serverUrl);
          const username = input.username.trim();
          const info = await discoverCalDav({ serverUrl, username, password: input.password, useProxy: input.useProxy });
          const account: Account = {
            id,
            kind: 'caldav',
            name: input.name?.trim() || info.displayName || `${username}@${new URL(info.homeUrl).host}`,
            serverUrl,
            username,
            password: input.password,
            passwordBox: noteWrapped(id, await sealSecret(input.password, id)),
            principalUrl: info.principalUrl,
            homeUrl: info.homeUrl,
            email: info.email,
            useProxy: input.useProxy,
          };
          set((s) => ({ accounts: [...s.accounts, account] }));
          try {
            await get().syncAccount(account.id);
          } catch (err) {
            // Not added after all; the form is still open and a second try
            // must not leave two accounts behind.
            await get().removeAccount(account.id);
            throw err;
          }
          return account;
        },

        updateAccount: (id, patch) => patchAccount(id, patch),

        setAccountPassword: async (id, password) => {
          const passwordBox = noteWrapped(id, await sealSecret(password, id));
          patchAccount(id, { password, passwordBox, error: undefined, errorCode: undefined });
        },

        removeAccount: async (id) => {
          if (id === LOCAL_ACCOUNT_ID) return;
          // Another tab still showing the account would write it back, CalDAV password and all.
          await changeAccounts(async () => {
            epochs.set(id, (epochs.get(id) ?? 0) + 1);
            // A sync still running for it is on its own now; an account added
            // under the same id must not be told that one covers it.
            syncLocks.delete(id);
            const cals = get().calendars.filter((c) => c.accountId === id);
            set((s) => {
              const objects = { ...s.objects };
              for (const c of cals) delete objects[c.id];
              const { [id]: _gone, ...syncing } = s.syncing;
              return {
                accounts: s.accounts.filter((a) => a.id !== id),
                calendars: s.calendars.filter((c) => c.accountId !== id),
                objects,
                syncing,
                revision: s.revision + 1,
              };
            });
            for (const c of cals) unreadable.delete(c.id);
            // The parsed copies hold the items' text in clear.
            clearParseCache(`${id}|`);
            for (const listener of removalListeners) {
              try {
                listener(id);
              } catch (err) {
                console.warn('Could not forget a removed account', err instanceof Error ? err.name : typeof err);
              }
            }
            stale.delete(id);
            // So do its calendars' own default notifications.
            dropCalendarAlarms((calId) => calId.startsWith(`${id}|`));
            await Promise.all(cals.map((c) => deleteObjects(c.id)));
            // Also what calendars that disappeared earlier may have left behind.
            await deleteObjectsWithPrefix(`${id}|`);
            // And items a move left to be put back, which nothing would put anywhere now.
            await editRestores((list) => list.filter((o) => !o.calendarId?.startsWith(`${id}|`))).catch((err) =>
              console.warn('Could not update the items to put back', err),
            );
          });
        },

        syncAccount: async (id, options) => {
          const full = !!options?.full;
          const running = syncLocks.get(id);
          if (running) {
            if (!full) return running;
            // One that is out already may be incremental: a full one follows it.
            await running.catch(() => {});
            return get().syncAccount(id, options);
          }
          const p = runSync(id, full).finally(() => {
            if (syncLocks.get(id) === p) syncLocks.delete(id);
          });
          syncLocks.set(id, p);
          return p;
        },

        syncAll: async () => {
          const results = await Promise.allSettled([
            ...get().accounts.map((a) => get().syncAccount(a.id)),
            ...get()
              .calendars.filter((c) => c.subscriptionUrl)
              .map((c) => get().refreshSubscription(c.id)),
          ]);
          const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
          if (failed) throw failed.reason;
        },

        setCalendarVisible: (id, visible) => {
          const cal = calendarById(id);
          if (!cal || cal.visible === visible) return;
          set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? { ...c, visible } : c)) }));
          pushCalendarPatch(cal, { visible });
        },

        showOnlyCalendar: (id) => {
          const before = get().calendars;
          set((s) => ({ calendars: s.calendars.map((c) => ({ ...c, visible: c.id === id })) }));
          for (const c of before) if (c.visible !== (c.id === id)) pushCalendarPatch(c, { visible: c.id === id });
        },

        updateCalendar: async (id, patch) => {
          const cal = calendarById(id);
          if (!cal) return;
          const account = accountById(cal.accountId);
          hold(editing, id);
          try {
            if (account && cal.remoteId) await backendFor(account).updateCalendar(cal.remoteId, patch);
            set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
          } finally {
            lastEdit.set(id, ++editClock);
            release(editing, id);
          }
        },

        createCalendar: async (accountId, input) => {
          const account = accountById(accountId);
          if (!account) throw new Error(t('data.accountMissing'));
          const backend = backendFor(account);
          const order = input.order ?? Math.max(0, ...get().calendars.map((c) => c.order)) + 1;
          const visible = input.visible ?? true;
          const remoteId = await backend.createCalendar({ ...input, order, visible });
          if (!backend.remote) {
            const cal: Calendar = {
              id: calendarId(accountId, remoteId),
              accountId,
              remoteId,
              name: input.name,
              color: input.color,
              description: input.description,
              components: input.components,
              readOnly: false,
              visible,
              order,
            };
            set((s) => ({ calendars: [...s.calendars, cal], objects: { ...s.objects, [cal.id]: {} } }));
            return cal;
          }
          // Servers differ in whether a collection address ends with a slash.
          const bare = (value: string | undefined) => value?.replace(/\/$/, '');
          const find = () => get().calendars.find((c) => c.accountId === accountId && bare(c.remoteId) === bare(remoteId));
          await syncAfresh(accountId);
          const created = find();
          if (!created) throw new Error(t('data.calendarNotListed'));
          // Kept per device by backends that do not store them.
          if (created.visible !== visible || (input.order !== undefined && created.order !== order)) {
            const local = { visible, ...(input.order !== undefined ? { order } : {}) };
            set((s) => ({ calendars: s.calendars.map((c) => (c.id === created.id ? { ...c, ...local } : c)) }));
            return { ...created, ...local };
          }
          return created;
        },

        deleteCalendar: async (id) => {
          const cal = calendarById(id);
          if (!cal) return;
          const account = accountById(cal.accountId);
          hold(editing, id);
          try {
            if (account && cal.remoteId) await backendFor(account).deleteCalendar(cal.remoteId);
            unreadable.delete(id);
            set((s) => {
              const objects = { ...s.objects };
              delete objects[id];
              return { calendars: s.calendars.filter((c) => c.id !== id), objects, revision: s.revision + 1 };
            });
          } finally {
            lastEdit.set(id, ++editClock);
            release(editing, id);
          }
          clearParseCache(id, true);
          // Its own default notifications go with it.
          dropCalendarAlarms((calId) => calId === id);
          await deleteObjects(id);
        },

        applyOps: async (ops) => {
          const applied: Applied[] = [];
          try {
            for (const op of ops) applied.push(await applyOne(op));
          } catch (err) {
            // To the user a batch is one edit (ending a series and starting
            // the one that follows it, say). Half of it is worse than none.
            for (const done of [...applied].reverse()) {
              await revert(done).catch((inner) => console.warn('Could not take back a partly applied change', errorKind(inner)));
            }
            throw err;
          }
          return applied.map((a) => a.url);
        },

        moveObject: async (url, targetCalendarId, data, uid) => {
          const source = findCalendarByObject(url);
          const obj = source ? get().objects[source.id][url] : undefined;
          if (!source || !obj) throw new Error(t('data.itemMissing'));
          if (source.id === targetCalendarId) return;
          const copy: WriteOp = { type: 'create', calendarId: targetCalendarId, uid, data };
          const remove: WriteOp = { type: 'delete', url, etag: obj.etag };
          let copied: string;
          try {
            [copied] = await get().applyOps([copy]);
          } catch (err) {
            // Servers that enforce one UID per account (iCloud, SOGo, ...)
            // reject the copy with a no-uid-conflict precondition. Delete
            // first in that case and restore the original if the copy fails.
            if (!(err instanceof BackendError && err.uidConflict)) throw err;
            // From the delete on, until the copy or the original is stored
            // again, the item exists only here; it is written down first, and
            // a later sync puts it back if both writes fail.
            await editRestores((list) => [...list.filter((o) => o.url !== url), obj]);
            const forget = () => editRestores((list) => list.filter((o) => o.url !== url)).catch((e) => console.warn('Could not update the items to put back', e));
            try {
              await get().applyOps([remove]);
            } catch (third) {
              await forget();
              throw third;
            }
            try {
              await get().applyOps([copy]);
            } catch (second) {
              try {
                await get().applyOps([{ type: 'create', calendarId: source.id, uid, data: obj.data }]);
                await forget();
              } catch (restore) {
                console.warn('Could not put the item back yet', errorKind(restore));
              }
              // What the user tried to do is what failed.
              throw second;
            }
            await forget();
            return;
          }
          try {
            await get().applyOps([remove]);
          } catch (err) {
            // Otherwise the item would now be in both calendars.
            const stray = get().objects[targetCalendarId]?.[copied];
            if (stray) await get().applyOps([{ type: 'delete', url: copied, etag: stray.etag }]).catch(() => {});
            throw err;
          }
        },

        addSubscription: async ({ url, name, color }) => {
          const remoteId = `sub-${crypto.randomUUID()}`;
          const cal: Calendar = {
            id: calendarId(LOCAL_ACCOUNT_ID, remoteId),
            accountId: LOCAL_ACCOUNT_ID,
            remoteId,
            name,
            color,
            components: ['VEVENT', 'VTODO'],
            readOnly: true,
            visible: true,
            order: Math.max(0, ...get().calendars.map((c) => c.order)) + 1,
            subscriptionUrl: normalizeFeedUrl(url),
          };
          // A user name or password in the address would be stored with it, in the clear.
          assertNoCredentials(cal.subscriptionUrl!);
          // Fetch first so an invalid URL does not leave an empty calendar behind.
          const objects = await fetchFeed(cal);
          set((s) => ({ calendars: [...s.calendars, { ...cal, lastFetched: Date.now() }] }));
          setObjects(cal.id, objects);
          cacheObjects(cal.id);
          return cal;
        },

        refreshSubscription: async (calId, force = false) => {
          const cal = calendarById(calId);
          if (!cal?.subscriptionUrl) return;
          if (!force && cal.lastFetched && Date.now() - cal.lastFetched < SUBSCRIPTION_TTL) return;
          const objects = await fetchFeed(cal);
          // Removed, or pointed at another feed, while the request was out.
          if (calendarById(calId)?.subscriptionUrl !== cal.subscriptionUrl) return;
          setObjects(cal.id, objects);
          cacheObjects(cal.id);
          set((s) => ({ calendars: s.calendars.map((c) => (c.id === calId ? { ...c, lastFetched: Date.now() } : c)) }));
        },

        addHolidayCalendar: ({ country, name, color }) => {
          const remoteId = `holidays-${country}-${crypto.randomUUID()}`;
          const cal: Calendar = {
            id: calendarId(LOCAL_ACCOUNT_ID, remoteId),
            accountId: LOCAL_ACCOUNT_ID,
            remoteId,
            name,
            color,
            components: ['VEVENT'],
            readOnly: true,
            visible: true,
            order: Math.max(0, ...get().calendars.map((c) => c.order)) + 1,
            holidayCountry: country,
            holidayVersion: holidayVersion(),
          };
          set((s) => ({ calendars: [...s.calendars, cal] }));
          setObjects(cal.id, holidayObjects(cal));
          cacheObjects(cal.id);
          return cal;
        },

        refreshHolidayCalendars: () => {
          const version = holidayVersion();
          for (const cal of get().calendars) {
            if (!cal.holidayCountry) continue;
            // Generated again when the year or language changed, and when
            // the copy on disk turned out to be missing.
            const missing = get().hydrated && !(cal.id in get().objects);
            if (cal.holidayVersion === version && !missing) continue;
            setObjects(cal.id, holidayObjects(cal));
            cacheObjects(cal.id);
            set((s) => ({ calendars: s.calendars.map((c) => (c.id === cal.id ? { ...c, holidayVersion: version } : c)) }));
          }
        },

        importObjects: async (calId, items, options = {}) => {
          const { cal, backend } = writable(calendarById(calId), 'data.calendarMissing');
          // The same UID twice in one import: the later one wins, as in a file.
          const unique = [...new Map(items.map((i) => [i.uid, i])).values()];
          const total = unique.length;
          let done = 0;
          let imported = 0;
          // Stored without an answer we could keep; a sync fetches those.
          const unread: string[] = [];
          const report = (extra = 0) => options.onProgress?.(Math.min(done + extra, total), total);
          const checkAborted = () => {
            if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
          };

          // An item whose UID the calendar already holds replaces that object, wherever it is stored.
          const held = new Map<string, RawObject>();
          for (const raw of Object.values(get().objects[cal.id] ?? {})) {
            const uid = uidOf(raw);
            if (uid) held.set(uid, raw);
          }

          /** One update of the store per batch, and one write to disk. */
          const commit = async (stored: RemoteObject[]) => {
            if (!stored.length || !calendarById(cal.id)) return;
            const before = get().objects[cal.id];
            const map = { ...before };
            for (const o of stored) map[o.url] = { url: o.url, etag: o.etag, calendarId: cal.id, data: o.data };
            setObjects(cal.id, map);
            if (backend.remote) return cacheObjects(cal.id);
            try {
              await storeObjects(cal.id);
            } catch (err) {
              console.warn('IndexedDB write failed', err);
              // Not on disk means not imported: do not show what a restart would lose.
              setObjects(cal.id, before ?? {});
              throw new Error(t('data.storageWrite'));
            }
          };

          const putOne = async (item: NewObject): Promise<RemoteObject | null> => {
            const existing = held.get(item.uid);
            if (existing) return backend.putObject(cal, existing.url, item.data, 'update');
            const url = backend.objectUrl(cal, item.uid);
            try {
              return await backend.putObject(cal, url, item.data, 'create');
            } catch (err) {
              // On the server but not in our copy of it (an import that was
              // cut short): same URL, so the same UID, so the same item.
              if (!isBackendError(err, 'conflict') || err.uidConflict) throw err;
              return backend.putObject(cal, url, item.data, 'update');
            }
          };

          // The bulk call names objects by UID; one that is stored under
          // another name has to be replaced where it is.
          const inBulk = (item: NewObject) => {
            const existing = held.get(item.uid);
            return !!backend.putObjects && (!existing || existing.url === backend.objectUrl(cal, item.uid));
          };
          const bulk = unique.filter(inBulk);
          const single = unique.filter((i) => !inBulk(i));

          try {
            for (let i = 0; i < bulk.length; i += PUT_BATCH) {
              checkAborted();
              const batch = bulk.slice(i, i + PUT_BATCH);
              const stored = await backend.putObjects!(cal, batch, (n) => report(Math.min(n, batch.length)));
              await commit(stored);
              done += batch.length;
              imported += stored.length;
              report();
            }
            for (let i = 0; i < single.length; i += IMPORT_CHUNK) {
              checkAborted();
              const stored: RemoteObject[] = [];
              const failures: unknown[] = [];
              await pooled(single.slice(i, i + IMPORT_CHUNK), IMPORT_CONCURRENCY, async (item) => {
                if (failures.length) return;
                try {
                  const saved = await putOne(item);
                  if (saved) stored.push(saved);
                  else unread.push(item.uid);
                  done++;
                  imported++;
                  report();
                } catch (err) {
                  failures.push(err);
                }
              });
              await commit(stored);
              if (failures.length) throw failures[0];
            }
          } catch (err) {
            // What reached the server without reaching the store comes in with a sync.
            if (backend.remote) void get().syncAccount(cal.accountId).catch(() => {});
            if (options.signal?.aborted) throw err;
            throw new ImportError(err, imported, total);
          }
          if (unread.length) void get().syncAccount(cal.accountId).catch(() => {});
          return imported;
        },
      };
    },
    {
      name: 'calendar.data',
      version: DATA_VERSION,
      storage: dataStorage,
      partialize: (s): PersistedData => ({ accounts: s.accounts.map(storedAccount), calendars: s.calendars }),
      migrate: (state, version) => migrateData(state, version),
      // A state of the current version is not migrated, but checked all the same.
      merge: (stored, current) => (stored ? { ...current, ...migrateData(stored, DATA_VERSION) } : current),
    },
  ),
);

/** Whether the items of a calendar can be deleted: it takes changes. */
export function canDeleteItems(cal: Calendar | undefined): boolean {
  return !!cal && !cal.readOnly;
}

export function calendarsFor(component: ComponentType, calendars: Calendar[]) {
  return calendars.filter((c) => c.components.includes(component)).sort((a, b) => a.order - b.order);
}

/**
 * Calendars of an account that its last sync could not bring up to date (the
 * account's `error` says why). What the store holds for them may be behind
 * the server, so nothing that relies on completeness should be built on it.
 */
export function staleCalendars(accountId: string): string[] {
  return [...(stale.get(accountId) ?? [])];
}

/**
 * True for a local calendar whose stored objects could not be read at start.
 * What the store holds for it (nothing) is not what is on disk, so it must
 * neither be written to nor taken as empty.
 */
export function isUnreadable(calendarId: string): boolean {
  return unreadable.has(calendarId);
}

/**
 * The account new calendars go to unless the user picks another: the one that
 * matches the storage chosen on first run, and the device when there is none.
 */
export function defaultAccountId(): string {
  const mode = useApp.getState().storageMode;
  const match = mode && mode !== 'local' ? useData.getState().accounts.find((a) => a.kind === mode) : undefined;
  return match?.id ?? LOCAL_ACCOUNT_ID;
}

/**
 * Names the calendar and the task list that new items go to where none is
 * named yet: the first visible, writable one of the account new calendars go
 * to (`defaultAccountId`). Settings then shows it instead of "—", and it stays
 * put when more calendars come. Run when calendars first arrive: at the end
 * of the welcome screen, when an account's calendars are first listed (an
 * account was added) and when the device's own are made. Nothing is chosen
 * before the welcome screen has settled where calendars are kept, nor from
 * another account; a calendar or list that is named already stays.
 */
export function fillDefaultCalendars(): void {
  const { onboarded, storageMode } = useApp.getState();
  if (!onboarded || !storageMode) return;
  const accountId = defaultAccountId();
  const settings = useSettings.getState();
  const first = (component: ComponentType) => {
    const own = calendarsFor(component, useData.getState().calendars).filter(
      (c) => c.accountId === accountId && !c.readOnly && !isGeneratedCalendar(c) && !unreadable.has(c.id),
    );
    return (own.find((c) => c.visible) ?? own[0])?.id;
  };
  const patch: Partial<Pick<typeof settings, 'defaultCalendarId' | 'defaultTaskListId'>> = {};
  const calendar = settings.defaultCalendarId ? undefined : first('VEVENT');
  const list = settings.defaultTaskListId ? undefined : first('VTODO');
  if (calendar) patch.defaultCalendarId = calendar;
  if (list) patch.defaultTaskListId = list;
  if (calendar || list) settings.update(patch);
}
