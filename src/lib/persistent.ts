// Persistent notifications: an event's or a task's reminder stays until it is
// dealt with. On Android it is pinned: a swipe brings it back at once, without
// a sound, and a restart or an update of the app puts it up again; Done (a
// task: the app opens and marks it done), Snooze and Dismiss end it, and so do
// completing, deleting or moving the item, or turning the choice off. In a
// browser it asks to stay on screen until it is clicked or closed
// (`requireInteraction`), where the browser allows that.
//
// X-PATRYKPRO-PERSISTENT:TRUE on the series' master or the VTODO, like
// X-PATRYKPRO-HIDDEN (hidden.ts). Earlier versions of the app and other
// clients keep the property when they save, and remind as usual.
import type ICAL from 'ical.js';

export const PERSISTENT_PROPERTY = 'x-patrykpro-persistent';

/** Whether an item's reminders persist: TRUE, in any case; anything else is not. */
export function readPersistent(comp: ICAL.Component): boolean {
  const value = comp.getFirstPropertyValue(PERSISTENT_PROPERTY);
  return value != null && String(value).trim().toUpperCase() === 'TRUE';
}

/** Writes (or, for ordinary reminders, removes) the property. */
export function writePersistent(comp: ICAL.Component, persistent: boolean | undefined) {
  if (persistent) comp.updatePropertyWithValue(PERSISTENT_PROPERTY, 'TRUE');
  else comp.removeAllProperties(PERSISTENT_PROPERTY);
}
