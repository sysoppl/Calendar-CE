// Time zone support.
//
// ical.js only knows time zones that are either defined by a VTIMEZONE in the
// same object or registered in its TimezoneService. Many servers (Fastmail,
// Outlook and others) reference IANA or Windows zone names without shipping a
// VTIMEZONE, so we synthesize definitions from the platform's Intl database
// and register them before any value is read.
import ICAL from 'ical.js';

/** Common Windows zone names seen in Outlook/Exchange generated ICS. */
const WINDOWS_ZONES: Record<string, string> = {
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
};

export function localTimezone(): string {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* very old engines */
  }
  return normalizeOffsetZone(tz);
}

/**
 * Some environments (e.g. Android emulators without a configured zone)
 * report a raw offset like "+00:00", which is not a valid TZID. Map it to
 * UTC or the equivalent fixed Etc/GMT zone (note the inverted sign).
 */
export function normalizeOffsetZone(tz: string): string {
  const m = /^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
  if (!m) return tz;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? 0);
  if (hours === 0 && minutes === 0) return 'UTC';
  if (minutes !== 0) return 'UTC';
  return `Etc/GMT${m[1] === '+' ? '-' : '+'}${hours}`;
}

/**
 * Maps a TZID found in the wild to an IANA zone the platform understands, in
 * the platform's own spelling of it.
 */
export function resolveTzid(tzid: string): string | undefined {
  const cleaned = tzid.trim().replace(/^"|"$/g, '');
  const candidates = [cleaned, WINDOWS_ZONES[cleaned]];
  // e.g. "/freeassociation.sourceforge.net/Tzfile/Europe/Warsaw"
  const segments = cleaned.split('/').filter(Boolean);
  for (const n of [3, 2]) {
    if (segments.length > n) candidates.push(segments.slice(-n).join('/'));
  }
  for (const c of candidates) {
    const zone = c ? spellingOf(c) : undefined;
    if (zone) return zone;
  }
  return undefined;
}

const spellings = new Map<string, string | null>();
/**
 * The platform's name for the zone `tz` names ("europe/warsaw" and
 * "Europe/Warsaw" are both Europe/Warsaw), or undefined when it knows none.
 */
function spellingOf(tz: string): string | undefined {
  let v = spellings.get(tz);
  if (v === undefined) {
    try {
      v = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone || null;
    } catch {
      v = null;
    }
    // Names come from what servers send; the answers are cheap to find again.
    if (spellings.size >= 5000) spellings.clear();
    spellings.set(tz, v);
  }
  return v ?? undefined;
}

export function isValidTimezone(tz: string): boolean {
  return spellingOf(tz) !== undefined;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall clock parts of an instant in a zone. */
export function zonedParts(tz: string, date: Date) {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** UTC offset of a zone at an instant, in minutes (east positive). */
export function offsetMinutes(tz: string, date: Date): number {
  const p = zonedParts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Transition {
  at: Date;
  from: number;
  to: number;
}

function findTransitions(tz: string, year: number): Transition[] {
  const out: Transition[] = [];
  const DAY = 86400000;
  let prevT = Date.UTC(year, 0, 1);
  let prevOff = offsetMinutes(tz, new Date(prevT));
  for (let t = prevT + DAY; t <= Date.UTC(year, 11, 31, 23); t += DAY) {
    const off = offsetMinutes(tz, new Date(t));
    if (off !== prevOff) {
      // Binary search the exact minute.
      let lo = prevT;
      let hi = t;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
        if (offsetMinutes(tz, new Date(mid)) === prevOff) lo = mid;
        else hi = mid;
      }
      out.push({ at: new Date(hi), from: prevOff, to: off });
      prevOff = off;
    }
    prevT = t;
  }
  return out;
}

// A year of a zone takes a few hundred Intl calls to scan; every name for it shares the result.
const transitionCache = new Map<string, Transition[]>();
function transitionsOf(tz: string, year: number): Transition[] {
  const key = `${tz} ${year}`;
  let found = transitionCache.get(key);
  if (!found) {
    found = findTransitions(tz, year);
    transitionCache.set(key, found);
  }
  return found;
}

/** RRULE + DTSTART describing a yearly transition rule. */
function ruleFor(tr: Transition) {
  // Wall clock time just before the transition, in the old offset.
  const local = new Date(tr.at.getTime() + tr.from * 60000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  const wd = local.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const nth = d + 7 > daysInMonth ? -1 : Math.ceil(d / 7);
  // First matching day in 1970 so that DTSTART agrees with the rule.
  let startDay: number;
  if (nth === -1) {
    const last = new Date(Date.UTC(1970, mo, 0));
    startDay = last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
  } else {
    const first = new Date(Date.UTC(1970, mo - 1, 1)).getUTCDay();
    startDay = 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
  }
  return {
    dtstart: `1970${pad(mo)}${pad(startDay)}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}00`,
    rrule: `FREQ=YEARLY;BYMONTH=${mo};BYDAY=${nth}${DAYS[wd]}`,
  };
}

/**
 * Builds a VTIMEZONE block for an IANA zone from the current DST rules.
 * Returns undefined when the platform does not know the zone.
 */
export function buildVTimezone(tzid: string, year = new Date().getFullYear()): string | undefined {
  const iana = resolveTzid(tzid);
  if (!iana) return undefined;
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`];
  const transitions = transitionsOf(iana, year);
  if (transitions.length < 2) {
    const off = fmtOffset(offsetMinutes(iana, new Date(Date.UTC(year, 0, 1))));
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, 'END:STANDARD');
  } else {
    for (const tr of transitions.slice(0, 2)) {
      const kind = tr.to > tr.from ? 'DAYLIGHT' : 'STANDARD';
      const { dtstart, rrule } = ruleFor(tr);
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${dtstart}`,
        `RRULE:${rrule}`,
        `TZOFFSETFROM:${fmtOffset(tr.from)}`,
        `TZOFFSETTO:${fmtOffset(tr.to)}`,
        `END:${kind}`,
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines.join('\r\n');
}

/**
 * Makes sure ical.js knows the zone `tzid` names. Returns the name the zone is
 * registered under, or undefined when there is none.
 *
 * Only the platform's own name of a zone is registered, never the other names
 * calendar data uses for it (Windows names, prefixed or differently written
 * ones): registrations last as long as the page, and data can make up such
 * names without end while the zones are a fixed set. A TZID that is another
 * name is pointed at the registered one instead (`renameTimezones`), so no
 * calendar can use up room the others need.
 */
export function ensureTimezone(tzid: string): string | undefined {
  if (!tzid) return undefined;
  if (tzid === 'UTC' || tzid === 'Z') return 'UTC';
  const zone = resolveTzid(tzid);
  if (!zone) return undefined;
  if (!ICAL.TimezoneService.has(zone)) {
    const block = buildVTimezone(zone);
    if (!block) return undefined;
    const comp = new ICAL.Component(ICAL.parse(block));
    ICAL.TimezoneService.register(new ICAL.Timezone({ component: comp, tzid: zone }));
  }
  return zone;
}

/** Zones one object may have made up for it; real data names two or three. */
const MAX_NEW_ZONES = 32;

/** The name and parameters of a content line: what comes before the first colon outside quotes. */
function propertyHead(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) return line.slice(0, i);
  }
  return line;
}

/**
 * Registers the zone of every TZID referenced in raw ICS text that lacks a
 * definition. Returns those of the TZIDs that name their zone differently,
 * each with the name it is registered under, for `renameTimezones`.
 */
export function ensureTimezonesFor(ics: string): Map<string, string> {
  const defined = new Set<string>();
  const used = new Set<string>();
  let inZone = false;
  // One pass over unfolded lines, so the time grows with the text and not
  // faster, and only parameters count: TZID= inside a description does not.
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const head = propertyHead(line);
    const name = head.split(';', 1)[0].trim().toUpperCase();
    if (name === 'BEGIN' || name === 'END') {
      if (line.slice(head.length + 1).trim().toUpperCase() === 'VTIMEZONE') inZone = name === 'BEGIN';
    } else if (inZone && name === 'TZID') {
      defined.add(line.slice(head.length + 1).trim());
    } else {
      for (const m of head.matchAll(/;TZID=("?)([^:;"]+)\1(?=;|$)/gi)) used.add(m[2]);
    }
  }
  const renamed = new Map<string, string>();
  let made = 0;
  for (const tzid of used) {
    if (defined.has(tzid.trim()) || ICAL.TimezoneService.has(tzid)) continue;
    if (made++ >= MAX_NEW_ZONES) break;
    const zone = ensureTimezone(tzid);
    if (zone && zone !== tzid) renamed.set(tzid, zone);
  }
  return renamed;
}

/**
 * Points every TZID parameter outside the VTIMEZONEs that `renamed` lists at
 * the name its zone is registered under. Only parameters change, so no value
 * has been read yet when this runs right after parsing.
 */
export function renameTimezones(root: ICAL.Component, renamed: ReadonlyMap<string, string>) {
  if (!renamed.size) return;
  const walk = (comp: ICAL.Component) => {
    if (comp.name === 'vtimezone') return;
    for (const prop of comp.getAllProperties()) {
      const tzid = prop.getParameter('tzid');
      const zone = typeof tzid === 'string' ? renamed.get(tzid) : undefined;
      if (zone) prop.setParameter('tzid', zone);
    }
    comp.getAllSubcomponents().forEach(walk);
  };
  walk(root);
}

/**
 * Parts a time zone rule may use here, with how many values. Real ones name a
 * month and a day in it ("last Sunday", "Sunday on or after the 8th"), some
 * with the hour and minute: at most seven instances a year.
 */
const ZONE_RULE_PARTS: Record<string, number> = { BYMONTH: 1, BYDAY: 1, BYMONTHDAY: 7, BYHOUR: 1, BYMINUTE: 1, BYSECOND: 1, BYSETPOS: 1 };

/**
 * ical.js expands every STANDARD and DAYLIGHT part of a zone from its DTSTART
 * to a few years from now the first time a time in that zone is read. A rule
 * that is not yearly (FREQ=SECONDLY), or yields many changes a year, or whose
 * parts never meet, would make that take for ever, so only rules shaped like
 * real ones are accepted.
 */
function plausibleObservance(observance: ICAL.Component): boolean {
  try {
    for (const prop of observance.getAllProperties('rrule')) {
      const recur = prop.getFirstValue();
      if (!(recur instanceof ICAL.Recur) || recur.freq !== 'YEARLY') return false;
      const parts = recur.parts as Record<string, unknown[]>;
      for (const [part, values] of Object.entries(parts)) {
        const most = ZONE_RULE_PARTS[part];
        if (most === undefined || values.length > most) return false;
      }
      // A day without its month is one every week or month of the year.
      if ((parts.BYDAY || parts.BYMONTHDAY) && !parts.BYMONTH) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** STANDARD and DAYLIGHT parts one VTIMEZONE may have (a zone's whole history has a few dozen). */
export const MAX_ZONE_PARTS = 500;

/**
 * What expanding the zones of one object may cost: a year of one yearly
 * rule, a part without a rule and an RDATE value count one each. Real zones
 * cost a few hundred at most (a zone written from 1601, as some mail
 * programs do, about 850); each unit is some 0.1 ms.
 */
export const ZONE_BUDGET = 5000;

/**
 * How much a STANDARD or DAYLIGHT part costs ical.js when a time in its zone
 * is read: every year of its rules from its DTSTART on (to UNTIL, COUNT or ten
 * years from now), every RDATE value, and itself.
 */
function observanceCost(observance: ICAL.Component, horizonYear: number): number {
  let cost = 1;
  for (const prop of observance.getAllProperties('rdate')) cost += prop.getValues().length;
  const start = observance.getFirstPropertyValue('dtstart');
  const startYear = start instanceof ICAL.Time ? start.year : horizonYear;
  for (const prop of observance.getAllProperties('rrule')) {
    const recur = prop.getFirstValue();
    if (!(recur instanceof ICAL.Recur)) continue;
    const endYear = recur.until ? Math.min(recur.until.year, horizonYear) : horizonYear;
    let years = Math.max(1, endYear - startYear + 1);
    if (recur.count) years = Math.min(years, recur.count);
    cost += years;
  }
  return cost;
}

/**
 * Removes the VTIMEZONEs of a parsed calendar whose rules ical.js could not
 * expand in reasonable time: rules not shaped like real ones, more than
 * `MAX_ZONE_PARTS` parts, or more than the object's `ZONE_BUDGET` (counted in
 * the order the zones come, so the first ones stay). Their TZID is then
 * resolved the way an undefined one is: from the platform when it names a
 * known zone, and added to `renamed` when it names that zone differently.
 */
export function dropImplausibleTimezones(root: ICAL.Component, renamed = new Map<string, string>()) {
  const horizonYear = new Date().getFullYear() + 10;
  let spent = 0;
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const parts = zone.getAllSubcomponents();
    if (parts.length <= MAX_ZONE_PARTS && parts.every(plausibleObservance)) {
      let cost = 0;
      try {
        for (const part of parts) cost += observanceCost(part, horizonYear);
      } catch {
        cost = Infinity;
      }
      if (spent + cost <= ZONE_BUDGET) {
        spent += cost;
        continue;
      }
    }
    root.removeSubcomponent(zone);
    const tzid = zone.getFirstPropertyValue('tzid');
    if (typeof tzid !== 'string') continue;
    const registered = ensureTimezone(tzid);
    if (registered && registered !== tzid) renamed.set(tzid, registered);
  }
}
