// An in-memory server for tests of the store and of everything built on it.
// It behaves like a remote backend with etags, ctags and sync tokens, records
// every call, and lets a test fail or hold any of them.
import type { Calendar } from '@/store/data';
import { objectFileName } from './names';
import { BackendError, type CalendarBackend, type NewObject, type NewRemoteCalendar, type ObjectChanges, type PutProgress, type RemoteCalendar, type RemoteCalendarPatch, type RemoteObject, type RemoteObjectRef } from './types';

interface StoredObject {
  etag: string;
  data: string;
}

interface StoredCalendar {
  info: Omit<RemoteCalendar, 'ctag' | 'syncToken'>;
  objects: Map<string, StoredObject>;
  /** Every change, in order: what a sync token is a position in. */
  log: { rev: number; url: string; deleted: boolean }[];
}

export interface FakeBackendOptions {
  /** Offer the bulk call. Off by default, like a CalDAV server. */
  bulk?: boolean;
  /** Advertise sync tokens. On by default. */
  tokens?: boolean;
  /** Keep `visible` and `order`, like a backend that stores them does. */
  storesView?: boolean;
  /** Refuse a UID that another calendar already has, like some CalDAV servers. */
  uniqueUids?: boolean;
}

const uidIn = (data: string) => /^UID:(.+)$/m.exec(data)?.[1].trim();

export class FakeBackend implements CalendarBackend {
  readonly remote = true;
  readonly calendars = new Map<string, StoredCalendar>();
  /** One entry per call: the method, then its main argument. */
  readonly calls: string[] = [];
  /** Runs before every call with its `calls` entry. Throw to fail the call, return a promise to hold it. */
  before?: (call: string) => void | Promise<void>;
  /** Runs after a write was applied, before it is answered: a slow or lost response. */
  after?: (call: string) => void | Promise<void>;
  putObjects?: (cal: Calendar, items: NewObject[], onProgress?: PutProgress) => Promise<RemoteObject[]>;

  private rev = 0;
  private ids = 0;

  constructor(private readonly options: FakeBackendOptions = {}) {
    if (options.bulk) {
      this.putObjects = async (cal, items, onProgress) => {
        const call = `putObjects ${cal.remoteId} ${items.length}`;
        await this.enter(call);
        const stored = this.need(cal.remoteId ?? '');
        const out = items.map((item, i) => {
          const url = this.objectUrl(cal, item.uid);
          const saved = this.write(stored, url, item.data);
          onProgress?.(i + 1, items.length);
          return { url, ...saved };
        });
        await this.after?.(call);
        return out;
      };
    }
  }

  // ---------------------------------------------------------------------------
  // What a test does to the server behind the app's back

  addCalendar(remoteId: string, info: Partial<StoredCalendar['info']> = {}): StoredCalendar {
    const stored: StoredCalendar = {
      info: { remoteId, displayName: remoteId, components: ['VEVENT'], readOnly: false, ...info },
      objects: new Map(),
      log: [],
    };
    this.calendars.set(remoteId, stored);
    return stored;
  }

  /** Stores an object as another device would; returns its URL. */
  seed(remoteId: string, uid: string, data: string): string {
    const url = `fake://${remoteId}/${objectFileName(uid)}.ics`;
    this.write(this.need(remoteId), url, data);
    return url;
  }

  remove(remoteId: string, url: string) {
    const stored = this.need(remoteId);
    if (stored.objects.delete(url)) stored.log.push({ rev: ++this.rev, url, deleted: true });
  }

  urls(remoteId: string): string[] {
    return [...this.need(remoteId).objects.keys()].sort();
  }

  // ---------------------------------------------------------------------------
  // CalendarBackend

  async listCalendars(): Promise<RemoteCalendar[]> {
    await this.enter('listCalendars');
    return [...this.calendars.values()].map((c) => this.describe(c));
  }

  async createCalendar(input: NewRemoteCalendar): Promise<string> {
    await this.enter(`createCalendar ${input.name}`);
    const remoteId = `cal-${++this.ids}`;
    this.addCalendar(remoteId, {
      displayName: input.name,
      color: input.color,
      description: input.description,
      components: input.components,
      ...(this.options.storesView ? { visible: input.visible, order: input.order } : {}),
    });
    return remoteId;
  }

  async updateCalendar(remoteId: string, patch: RemoteCalendarPatch): Promise<void> {
    await this.enter(`updateCalendar ${remoteId} ${Object.keys(patch).sort().join(',')}`);
    const { info } = this.need(remoteId);
    if (patch.name !== undefined) info.displayName = patch.name;
    if (patch.color !== undefined) info.color = patch.color;
    if (patch.description !== undefined) info.description = patch.description;
    if (this.options.storesView) {
      if (patch.visible !== undefined) info.visible = patch.visible;
      if (patch.order !== undefined) info.order = patch.order;
    }
  }

  async deleteCalendar(remoteId: string): Promise<void> {
    await this.enter(`deleteCalendar ${remoteId}`);
    this.calendars.delete(remoteId);
  }

  async changesSince(remoteId: string, token: string): Promise<ObjectChanges | null> {
    await this.enter(`changesSince ${remoteId} ${token}`);
    const stored = this.need(remoteId);
    const since = /^t(\d+)$/.exec(token);
    if (!since) return null;
    const latest = new Map<string, boolean>();
    for (const entry of stored.log) if (entry.rev > Number(since[1])) latest.set(entry.url, entry.deleted);
    const changed: RemoteObjectRef[] = [];
    const deleted: string[] = [];
    for (const [url, gone] of latest) {
      if (gone) deleted.push(url);
      else changed.push({ url, etag: stored.objects.get(url)!.etag });
    }
    return { changed, deleted, token: `t${stored.log.at(-1)?.rev ?? 0}` };
  }

  async listObjects(remoteId: string): Promise<RemoteObjectRef[]> {
    await this.enter(`listObjects ${remoteId}`);
    return [...this.need(remoteId).objects].map(([url, o]) => ({ url, etag: o.etag }));
  }

  async getObjects(remoteId: string, urls: string[]): Promise<RemoteObject[]> {
    // Answered from what is there when the request arrives, not when it is let through.
    const stored = this.need(remoteId);
    const found = urls.flatMap((url) => {
      const o = stored.objects.get(url);
      return o ? [{ url, ...o }] : [];
    });
    await this.enter(`getObjects ${remoteId} ${urls.length}`);
    return found;
  }

  objectUrl(cal: Calendar, uid: string): string {
    return `fake://${cal.remoteId}/${objectFileName(uid)}.ics`;
  }

  async putObject(cal: Calendar, url: string, data: string, mode: 'create' | 'update', etag?: string): Promise<RemoteObject | null> {
    const call = `putObject ${mode} ${url}${etag ? ` ${etag}` : ''}`;
    await this.enter(call);
    const stored = this.need(cal.remoteId ?? '');
    const existing = stored.objects.get(url);
    if (mode === 'create' && existing) throw new BackendError('conflict', 'The item exists already', { status: 412 });
    if (mode === 'update' && etag && existing?.etag !== etag) throw new BackendError('conflict', 'The item was changed on the server', { status: 412 });
    if (mode === 'create' && this.options.uniqueUids) {
      const uid = uidIn(data);
      for (const other of this.calendars.values()) {
        if (other !== stored && [...other.objects.values()].some((o) => uidIn(o.data) === uid)) {
          throw new BackendError('conflict', 'The UID is in use', { status: 409, uidConflict: true });
        }
      }
    }
    const saved = this.write(stored, url, data);
    await this.after?.(call);
    return { url, ...saved };
  }

  async deleteObject(url: string, etag?: string): Promise<void> {
    const call = `deleteObject ${url}${etag ? ` ${etag}` : ''}`;
    await this.enter(call);
    for (const [remoteId, stored] of this.calendars) {
      const existing = stored.objects.get(url);
      if (!existing) continue;
      if (etag && existing.etag !== etag) throw new BackendError('conflict', 'The item was changed on the server', { status: 412 });
      this.remove(remoteId, url);
    }
    await this.after?.(call);
  }

  // ---------------------------------------------------------------------------

  private async enter(call: string) {
    this.calls.push(call);
    await this.before?.(call);
  }

  private need(remoteId: string): StoredCalendar {
    const stored = this.calendars.get(remoteId);
    if (!stored) throw new BackendError('not-found', `No calendar ${remoteId}`, { status: 404 });
    return stored;
  }

  private write(stored: StoredCalendar, url: string, data: string): StoredObject {
    const saved = { etag: `"${++this.rev}"`, data };
    stored.objects.set(url, saved);
    stored.log.push({ rev: this.rev, url, deleted: false });
    return saved;
  }

  private describe(stored: StoredCalendar): RemoteCalendar {
    const last = stored.log.at(-1)?.rev ?? 0;
    return { ...stored.info, ctag: `c${last}`, ...(this.options.tokens === false ? {} : { syncToken: `t${last}` }) };
  }
}
