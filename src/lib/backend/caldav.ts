// CalDAV accounts: the existing client behind the backend interface.
import { t } from '@/i18n';
import { CalDavClient, type DiscoveryResult } from '@/lib/dav/client';
import { DavHttpError, DavNetworkError } from '@/lib/dav/transport';
import { canonicalHref } from '@/lib/dav/xml';
import { transportFor } from '@/lib/platform';
import type { Account, Calendar } from '@/store/data';
import { objectFileName } from './names';
import { BackendError, type BackendErrorCode, type CalendarBackend, type NewRemoteCalendar, type ObjectChanges, type RemoteCalendar, type RemoteCalendarPatch, type RemoteObject, type RemoteObjectRef } from './types';

function codeFor(status: number): BackendErrorCode {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 429) return 'rate-limit';
  return 'other';
}

/** Turns the DAV layer's errors into what the store understands; anything else passes through. */
export function toBackendError(err: unknown): unknown {
  if (err instanceof DavNetworkError) return new BackendError('network', err.message, { cause: err });
  if (!(err instanceof DavHttpError)) return err;
  // Servers that allow a UID only once per account name the precondition in
  // the answer. Only the answer counts: the message quotes the request URL,
  // and a path may well contain "uid".
  const uidConflict = [403, 409, 412].includes(err.status) && /no-uid-conflict/i.test(err.body);
  return new BackendError(codeFor(err.status), err.message, { status: err.status, uidConflict, cause: err });
}

async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw toBackendError(err);
  }
}

function clientFor(input: Pick<Account, 'useProxy' | 'username' | 'password'>): CalDavClient {
  return new CalDavClient(transportFor(input.useProxy), { username: input.username ?? '', password: input.password ?? '' });
}

/** Finds the principal and calendar home for credentials that are not an account yet. */
export function discoverCalDav(input: { serverUrl: string; username: string; password: string; useProxy: boolean }): Promise<DiscoveryResult> {
  return mapped(() => clientFor(input).discover(input.serverUrl));
}

/** CalDAV colours carry an alpha channel ("#RRGGBBAA"). */
function davColor(color: string | undefined): string | undefined {
  return color ? `${color.toUpperCase()}FF` : undefined;
}

export class CalDavBackend implements CalendarBackend {
  readonly remote = true;
  private readonly client: CalDavClient;
  private readonly home: string;

  constructor(account: Account) {
    // Without the password every request would be a failed login attempt.
    if (account.password === undefined) throw new BackendError('locked', t('data.passwordLost'));
    if (!account.homeUrl) throw new BackendError('other', t('data.noHome'));
    this.client = clientFor(account);
    this.home = account.homeUrl;
  }

  listCalendars(): Promise<RemoteCalendar[]> {
    return mapped(async () => (await this.client.listCalendars(this.home)).map(({ url, ...rest }) => ({ ...rest, remoteId: url, url })));
  }

  createCalendar(input: NewRemoteCalendar): Promise<string> {
    return mapped(() =>
      this.client.createCalendar(this.home, {
        displayName: input.name,
        color: davColor(input.color),
        components: input.components,
        description: input.description,
      }),
    );
  }

  // Visibility and order stay on the device: there is no property for the
  // first, and the second belongs to whichever client the user sorts in.
  updateCalendar(remoteId: string, patch: RemoteCalendarPatch): Promise<void> {
    return mapped(() => this.client.updateCalendar(remoteId, { displayName: patch.name, color: davColor(patch.color), description: patch.description }));
  }

  deleteCalendar(remoteId: string): Promise<void> {
    return mapped(() => this.client.deleteCalendar(remoteId));
  }

  changesSince(remoteId: string, token: string): Promise<ObjectChanges | null> {
    return mapped(async () => {
      const r = await this.client.syncCollection(remoteId, token);
      return r && { changed: r.changed, deleted: r.deleted, token: r.syncToken };
    });
  }

  listObjects(remoteId: string): Promise<RemoteObjectRef[]> {
    return mapped(() => this.client.listObjects(remoteId));
  }

  getObjects(remoteId: string, urls: string[]): Promise<RemoteObject[]> {
    return mapped(() => this.client.multiget(remoteId, urls));
  }

  objectUrl(cal: Calendar, uid: string): string {
    const collection = cal.remoteId ?? '';
    const base = collection.endsWith('/') ? collection : `${collection}/`;
    return canonicalHref(new URL(`${encodeURIComponent(objectFileName(uid))}.ics`, base).toString());
  }

  putObject(_cal: Calendar, url: string, data: string, mode: 'create' | 'update', etag?: string): Promise<RemoteObject | null> {
    return mapped(async () => {
      const saved = await this.client.putObject(url, data, mode, etag);
      if (saved) return { url, etag: saved, data };
      // No etag in the answer: the server may have rewritten the data.
      const fresh = await this.client.getObject(url);
      return fresh ? { url, etag: fresh.etag, data: fresh.data } : null;
    });
  }

  deleteObject(url: string, etag?: string): Promise<void> {
    return mapped(() => this.client.deleteObject(url, etag));
  }
}
