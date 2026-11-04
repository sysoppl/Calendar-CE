// Persistent storage for calendar object data (IndexedDB). Raw ICS can easily
// reach megabytes, which is why it does not live in localStorage.
import { createStore, del, delMany, get, keys, set } from 'idb-keyval';
import type { RawObject } from './ical/parse';
import { tabIsCurrent } from './tabs';

const store = typeof indexedDB !== 'undefined' ? createStore('calendar', 'objects') : undefined;

/**
 * The stored objects of a calendar, or `null` when they could not be read.
 * The difference matters: an empty answer may be written over, an unknown
 * one may not.
 */
export async function loadObjects(calendarId: string): Promise<RawObject[] | null> {
  if (!store) return [];
  try {
    return (await get<RawObject[]>(calendarId, store)) ?? [];
  } catch (err) {
    console.warn('IndexedDB read failed', err);
    return null;
  }
}

/**
 * Rejects when the write fails (a full disk, mostly), so that a caller for
 * whom this is the only copy can say so. Without IndexedDB there is nothing
 * to write to and the data lives for the session only.
 */
export async function saveObjects(calendarId: string, objects: RawObject[]): Promise<void> {
  // A tab whose accounts are out of date would put back what another tab
  // took away with an account; it is about to load the device's data again.
  if (!store || !tabIsCurrent()) return;
  await set(calendarId, objects, store);
}

/** Never rejects: by the time this runs, the thing it cleans up after is done. */
export async function deleteObjects(calendarId: string): Promise<void> {
  if (!store) return;
  try {
    await del(calendarId, store);
  } catch (err) {
    console.warn('IndexedDB delete failed', err);
  }
}

/** Removes everything stored under ids that start with `prefix` (an account's calendars). Never rejects. */
export async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
  if (!store) return;
  try {
    const all = await keys<IDBValidKey>(store);
    await delMany(
      all.filter((k) => typeof k === 'string' && k.startsWith(prefix)),
      store,
    );
  } catch (err) {
    console.warn('IndexedDB delete failed', err);
  }
}
