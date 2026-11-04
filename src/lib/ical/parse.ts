// Parsing of raw calendar objects with memoization by URL + etag.
import ICAL from 'ical.js';
// Bounds ical.js's search for recurrences before anything is read (see there).
import './recurrence';
import { dropImplausibleTimezones, ensureTimezonesFor, renameTimezones } from './timezone';

export interface RawObject {
  url: string;
  etag: string;
  calendarId: string;
  data: string;
}

export type ObjectKind = 'event' | 'task' | 'journal' | 'unknown';

export interface ParsedObject extends RawObject {
  root: ICAL.Component;
  kind: ObjectKind;
  uid: string;
}

// Keyed by URL and validated against the exact data: etags are not reliable
// enough on their own (optimistic updates and feeds reuse them).
const cache = new Map<string, { etag: string; data: string; result: ParsedObject | null }>();
const MAX_CACHE = 20000;

/**
 * What a log line may say about a parser or expansion failure: the kind of
 * error, never its message, which quotes the calendar text it choked on.
 */
export function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Time zones as ical.js reads them, by the text of their VTIMEZONE. ical.js
 * expands a zone's STANDARD and DAYLIGHT rules from their DTSTART (often
 * decades back) the first time a time in it is read, and does that once for
 * every object, as each holds its own copy of the definition: thousands of
 * items in one zone cost seconds at every start. Objects whose definition
 * reads the same share the zone read once. Each zone is built from a copy of
 * the VTIMEZONE alone, so it holds nothing of the item it came from.
 */
const zones = new Map<string, ICAL.Timezone>();
/** Real data uses a few zones; a feed that makes up many only costs the time saved. */
const MAX_ZONES = 256;

/** Hands `root` the shared zone of each of its VTIMEZONEs, the first one of a TZID as ical.js takes it. */
function shareTimezones(root: ICAL.Component) {
  // Where ical.js keeps the zones it read from a calendar's own VTIMEZONEs.
  const own = (root as unknown as { _timezoneCache?: unknown })._timezoneCache;
  if (!(own instanceof Map)) return;
  for (const comp of root.getAllSubcomponents('vtimezone')) {
    const tzid = comp.getFirstPropertyValue('tzid');
    if (typeof tzid !== 'string' || own.has(tzid)) continue;
    const text = comp.toString();
    let zone = zones.get(text);
    if (!zone) {
      if (zones.size >= MAX_ZONES) zones.clear();
      zone = new ICAL.Timezone({ component: new ICAL.Component(comp.toJSON()), tzid });
      zones.set(text, zone);
    }
    own.set(tzid, zone);
  }
}

export function parseIcs(data: string): ICAL.Component {
  const renamed = ensureTimezonesFor(data);
  const jcal = ICAL.parse(data);
  let root = new ICAL.Component(jcal);
  if (root.name !== 'vcalendar') {
    // Some servers wrap multiple calendars; take the first VCALENDAR.
    root = root.getFirstSubcomponent('vcalendar') ?? root;
  }
  // Before any value is read: reading a time is what expands its zone, and
  // what looks up the zone its TZID names.
  dropImplausibleTimezones(root, renamed);
  renameTimezones(root, renamed);
  shareTimezones(root);
  return root;
}

export function parseObject(raw: RawObject): ParsedObject | null {
  const cacheKey = `${raw.calendarId}\n${raw.url}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.etag === raw.etag && hit.data === raw.data) return hit.result;
  let result: ParsedObject | null = null;
  try {
    const root = parseIcs(raw.data);
    const first =
      root.getFirstSubcomponent('vevent') ?? root.getFirstSubcomponent('vtodo') ?? root.getFirstSubcomponent('vjournal');
    const kind: ObjectKind = !first
      ? 'unknown'
      : first.name === 'vevent'
        ? 'event'
        : first.name === 'vtodo'
          ? 'task'
          : 'journal';
    result = {
      ...raw,
      root,
      kind,
      uid: String(first?.getFirstPropertyValue('uid') ?? raw.url),
    };
  } catch (err) {
    // The kind only: the parser's message quotes the line it stopped at
    // (calendar content), the address names the server.
    console.warn('Could not parse calendar object', errorKind(err));
  }
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(cacheKey, { etag: raw.etag, data: raw.data, result });
  return result;
}

/**
 * Forgets what was parsed for calendars whose id starts with `calendarPrefix`
 * (an account's `${accountId}|`, or one calendar's exact id), or everything.
 * The cache holds the text of every item shown, so an account that is
 * removed must not leave it in the tab's memory.
 */
export function clearParseCache(calendarPrefix?: string, exact = false): void {
  if (calendarPrefix === undefined) {
    zones.clear();
    return cache.clear();
  }
  for (const key of cache.keys()) {
    const calendarId = key.slice(0, key.indexOf('\n'));
    if (exact ? calendarId === calendarPrefix : calendarId.startsWith(calendarPrefix)) cache.delete(key);
  }
}

/** Returns a fresh, mutable copy of the object's component tree. */
export function cloneRoot(obj: ParsedObject): ICAL.Component {
  return parseIcs(obj.data);
}

export function newUid(): string {
  return `${crypto.randomUUID()}@calendar.patryk.pro`;
}

export function wrapCalendar(...components: ICAL.Component[]): ICAL.Component {
  const cal = new ICAL.Component('vcalendar');
  cal.updatePropertyWithValue('prodid', '-//patryk.pro//Calendar//EN');
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('calscale', 'GREGORIAN');
  for (const c of components) cal.addSubcomponent(c);
  return cal;
}
