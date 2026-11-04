// Conversions between JS Dates and ICAL.Time values.
import ICAL from 'ical.js';
import { ensureTimezone, zonedParts } from './timezone';

/** The IANA zone (or 'UTC'/'floating') a time is anchored to. */
export function zoneOf(t: ICAL.Time | undefined | null): string {
  if (!t || t.isDate) return 'floating';
  const tzid = t.zone?.tzid;
  if (!tzid || tzid === 'floating') return 'floating';
  if (tzid === 'UTC' || tzid === 'Z') return 'UTC';
  return tzid;
}

/**
 * Builds an ICAL.Time for an instant, expressed in `tz`. All-day values use
 * the local calendar date of `date`.
 */
export function dateToIcal(date: Date, tz: string, allDay: boolean): ICAL.Time {
  if (allDay) {
    return ICAL.Time.fromData({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      isDate: true,
    });
  }
  // A zone read under another name (a Windows name, say) is written under the zone's own.
  const zone = tz === 'floating' ? undefined : ensureTimezone(tz);
  if (zone === 'UTC') return ICAL.Time.fromJSDate(date, true);
  if (!zone) {
    return ICAL.Time.fromData({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: 0,
      isDate: false,
    });
  }
  const p = zonedParts(zone, date);
  return ICAL.Time.fromData(
    { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second, isDate: false },
    ICAL.TimezoneService.get(zone),
  );
}

/** Sets a date/date-time property, maintaining TZID and VALUE parameters. */
export function setTimeProp(comp: ICAL.Component, name: string, time: ICAL.Time) {
  let prop = comp.getFirstProperty(name);
  if (!prop) {
    prop = new ICAL.Property(name);
    comp.addProperty(prop);
  }
  const tzid = time.isDate ? undefined : time.zone?.tzid;
  if (!tzid || tzid === 'UTC' || tzid === 'floating') prop.removeParameter('tzid');
  else prop.setParameter('tzid', tzid);
  prop.resetType(time.isDate ? 'date' : 'date-time');
  prop.setValue(time);
}

/**
 * Sets a property from a string. ical.js escapes line breaks only in TEXT
 * values; a URI (URL) or a value of no known type (COLOR) is written as it
 * is, so a line break read from a VALUE=TEXT property elsewhere would start a
 * property of its own. Such values lose their control characters.
 */
export function setTextProp(comp: ICAL.Component, name: string, value: string | undefined) {
  const type = (ICAL.design.icalendar.property as Record<string, { defaultType?: string } | undefined>)[name]?.defaultType;
  const clean = value !== undefined && type !== 'text' ? value.replace(/[\u0000-\u001f\u007f]/g, '') : value;
  if (clean === undefined || clean === '') comp.removeAllProperties(name);
  else comp.updatePropertyWithValue(name, clean);
}

export function nowUtc(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true);
}

/** Start of the local day. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
