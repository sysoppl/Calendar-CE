// What the store needs from a place that keeps calendars. The sync engine and
// the write path talk to this interface only; there is one implementation per
// account kind (see ./index.ts for how they are looked up).
import type { ComponentType, RemoteObject, RemoteObjectRef } from '@/lib/dav/client';
import type { Account, Calendar } from '@/store/data';

export type { ComponentType, RemoteObject, RemoteObjectRef };

export type AccountKind = 'local' | 'caldav';

export interface RemoteCalendar {
  /** The calendar's id on the backend. The calendar id in the store is `${accountId}|${remoteId}`. */
  remoteId: string;
  displayName: string;
  description?: string;
  color?: string;
  order?: number;
  /** Set only by backends that store it; otherwise visibility is kept per device. */
  visible?: boolean;
  components: ComponentType[];
  readOnly: boolean;
  /** Address of the collection, for backends that have one (CalDAV). */
  url?: string;
  /** Opaque state of the calendar. Unchanged since the last sync means nothing to fetch. */
  ctag?: string;
  /**
   * Cursor for `changesSince` that describes the calendar as it is now. The
   * engine stores it after a full listing, and skips the calendar when it
   * equals the stored one. A backend without such a value per calendar hands
   * out a fresh cursor here (a timestamp taken before listing, for example).
   */
  syncToken?: string;
}

export interface NewRemoteCalendar {
  name: string;
  color: string;
  components: ComponentType[];
  description?: string;
  order?: number;
  visible?: boolean;
}

/** Fields a backend may not store (`visible`, `order`) are ignored by it. */
export interface RemoteCalendarPatch {
  name?: string;
  color?: string;
  description?: string;
  visible?: boolean;
  order?: number;
}

export interface ObjectChanges {
  changed: RemoteObjectRef[];
  /** URLs of objects that are gone. */
  deleted: string[];
  /** Cursor for the next call; without it the calendar's `syncToken` is used. */
  token?: string;
}

export interface NewObject {
  uid: string;
  data: string;
}

/** `done` of `total` items of one `putObjects` call are stored. */
export type PutProgress = (done: number, total: number) => void;

/**
 * Why a backend call failed. 'auth': the server no longer takes the
 * credentials (a CalDAV password).
 */
export type BackendErrorCode = 'auth' | 'forbidden' | 'conflict' | 'not-found' | 'network' | 'rate-limit' | 'locked' | 'other';

export class BackendError extends Error {
  code: BackendErrorCode;
  status?: number;
  /**
   * The create was refused because the same UID already exists somewhere else
   * in the account (CalDAV `no-uid-conflict`). A move then has to delete first.
   */
  uidConflict?: boolean;

  constructor(code: BackendErrorCode, message?: string, options: { status?: number; uidConflict?: boolean; cause?: unknown } = {}) {
    super(message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BackendError';
    this.code = code;
    this.status = options.status;
    if (options.uidConflict) this.uidConflict = true;
  }
}

export function isBackendError(err: unknown, ...codes: BackendErrorCode[]): err is BackendError {
  return err instanceof BackendError && (!codes.length || codes.includes(err.code));
}

export interface CalendarBackend {
  /** False for calendars that exist only in the store (the local account): there is nothing to sync. */
  readonly remote: boolean;

  listCalendars(): Promise<RemoteCalendar[]>;
  /** Resolves to the new calendar's `remoteId`. */
  createCalendar(input: NewRemoteCalendar): Promise<string>;
  updateCalendar(remoteId: string, patch: RemoteCalendarPatch): Promise<void>;
  deleteCalendar(remoteId: string): Promise<void>;

  /** Changes since `token`, or `null` when the token is no longer usable and everything has to be listed. */
  changesSince(remoteId: string, token: string): Promise<ObjectChanges | null>;
  listObjects(remoteId: string): Promise<RemoteObjectRef[]>;
  /** Objects that no longer exist are left out of the answer. */
  getObjects(remoteId: string, urls: string[]): Promise<RemoteObject[]>;

  /** Where a new object with this UID goes. The same UID always gives the same URL. */
  objectUrl(cal: Calendar, uid: string): string;
  /**
   * Stores one object. `create` is for a URL the store believes to be free: a
   * backend that can tell fails with `conflict` when it is taken. `update`
   * checks `etag` when one is given and overwrites otherwise. `null` means it
   * was stored but could not be read back.
   */
  putObject(cal: Calendar, url: string, data: string, mode: 'create' | 'update', etag?: string): Promise<RemoteObject | null>;
  /**
   * Stores many objects at once, replacing the ones that exist. Only for
   * backends that can do better than one request per object; the store falls
   * back to `putObject` otherwise. Called with at most `PUT_BATCH` items.
   */
  putObjects?(cal: Calendar, items: NewObject[], onProgress?: PutProgress): Promise<RemoteObject[]>;
  /** A missing object counts as deleted. */
  deleteObject(url: string, etag?: string): Promise<void>;
}

/** Largest batch the store hands to `putObjects`. */
export const PUT_BATCH = 100;

export type BackendFactory = (account: Account) => CalendarBackend;
