// Calendars that exist only on this device. The store itself is their home
// (memory plus IndexedDB), so this backend has nothing to list or fetch: it
// names things and hands out etags.
import type { Calendar } from '@/store/data';
import { objectFileName } from './names';
import type { CalendarBackend, NewObject, PutProgress, RemoteObject } from './types';

function newEtag(): string {
  return `"${crypto.randomUUID()}"`;
}

export class LocalBackend implements CalendarBackend {
  readonly remote = false;

  async listCalendars() {
    return [];
  }

  async createCalendar() {
    return crypto.randomUUID();
  }

  async updateCalendar() {}

  async deleteCalendar() {}

  async changesSince() {
    return null;
  }

  async listObjects() {
    return [];
  }

  async getObjects() {
    return [];
  }

  objectUrl(cal: Calendar, uid: string) {
    return `local://${cal.id}/${objectFileName(uid)}.ics`;
  }

  async putObject(_cal: Calendar, url: string, data: string): Promise<RemoteObject> {
    return { url, etag: newEtag(), data };
  }

  async putObjects(cal: Calendar, items: NewObject[], onProgress?: PutProgress): Promise<RemoteObject[]> {
    const out = items.map((item) => ({ url: this.objectUrl(cal, item.uid), etag: newEtag(), data: item.data }));
    onProgress?.(items.length, items.length);
    return out;
  }

  async deleteObject() {}
}
