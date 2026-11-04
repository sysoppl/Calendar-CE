// Hidden events: the calendar shows "Hidden event" instead of the name (and
// no place) until the event is opened. For a surprise or anything not meant
// for whoever glances at the screen; it is no access control.
//
// X-PATRYKPRO-HIDDEN:TRUE on the series' master, like X-PATRYKPRO-SINCE
// (milestone.ts). CLASS:PRIVATE is not used: CalDAV servers act on it (a
// shared calendar then hides the event from the people it is shared with),
// which a choice made for this screen must not do. Earlier versions of the
// app keep the property when they save and show the name.
import type ICAL from 'ical.js';
import type { TFunction } from '@/i18n';
import { titleWithYears } from './milestone';

export const HIDDEN_PROPERTY = 'x-patrykpro-hidden';

/** Whether a VEVENT is hidden: TRUE, in any case; anything else is not. */
export function readHidden(comp: ICAL.Component): boolean {
  const value = comp.getFirstPropertyValue(HIDDEN_PROPERTY);
  return value != null && String(value).trim().toUpperCase() === 'TRUE';
}

/** Writes (or, for a shown event, removes) the property. */
export function writeHidden(comp: ICAL.Component, hidden: boolean | undefined) {
  if (hidden) comp.updatePropertyWithValue(HIDDEN_PROPERTY, 'TRUE');
  else comp.removeAllProperties(HIDDEN_PROPERTY);
}

/**
 * The title as the grids, the agenda, search and reminders show it: "Hidden
 * event" for a hidden one (without the years of a birthday, which would give
 * it away), else the title with them.
 */
export function shownTitle(item: { title: string; since?: Date; start: Date; hidden?: boolean }, t: TFunction): string {
  return item.hidden ? t('event.hidden') : titleWithYears(item, t('grid.noTitle'));
}
