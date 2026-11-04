// .ics import (split a calendar file into one object per UID) and export.
import ICAL from 'ical.js';
import { addMissingTimezones } from './ical/events';
import { newUid, parseIcs, wrapCalendar, type RawObject } from './ical/parse';

export interface ImportItem {
  uid: string;
  data: string;
  kind: 'event' | 'task';
}

/** Splits an .ics file into storable calendar objects. */
export function splitIcsFile(text: string): ImportItem[] {
  const root = parseIcs(text);
  // By TZID once, and each object pushed onto its group: a file of many objects sharing one UID stays linear.
  const timezones = new Map(root.getAllSubcomponents('vtimezone').map((tz) => [String(tz.getFirstPropertyValue('tzid')), tz]));
  const groups = new Map<string, ICAL.Component[]>();
  for (const comp of [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')]) {
    let uid = comp.getFirstPropertyValue('uid') as string | null;
    if (!uid) {
      uid = newUid();
      comp.updatePropertyWithValue('uid', uid);
    }
    const group = groups.get(uid);
    if (group) group.push(comp);
    else groups.set(uid, [comp]);
  }
  const out: ImportItem[] = [];
  for (const [uid, comps] of groups) {
    const usedTz = new Set<string>();
    for (const c of comps) {
      for (const p of c.getAllProperties()) {
        const tz = p.getParameter('tzid');
        if (typeof tz === 'string') usedTz.add(tz);
      }
    }
    const cal = wrapCalendar();
    for (const id of usedTz) {
      const tz = timezones.get(id);
      if (tz) cal.addSubcomponent(ICAL.Component.fromString(tz.toString()));
    }
    for (const c of comps) cal.addSubcomponent(ICAL.Component.fromString(c.toString()));
    addMissingTimezones(cal);
    out.push({ uid, data: cal.toString() + '\r\n', kind: comps[0].name === 'vtodo' ? 'task' : 'event' });
  }
  return out;
}

/** Merges all objects of a calendar into a single .ics document. */
export function mergeObjects(objects: RawObject[], name?: string): string {
  const cal = wrapCalendar();
  if (name) cal.updatePropertyWithValue('x-wr-calname', name);
  const seenTz = new Set<string>();
  for (const raw of objects) {
    try {
      const root = parseIcs(raw.data);
      for (const tz of [...root.getAllSubcomponents('vtimezone')]) {
        const id = String(tz.getFirstPropertyValue('tzid'));
        if (seenTz.has(id)) continue;
        seenTz.add(id);
        cal.addSubcomponent(tz);
      }
      for (const c of [...root.getAllSubcomponents()]) {
        if (c.name !== 'vtimezone') cal.addSubcomponent(c);
      }
    } catch {
      /* skip unparsable objects */
    }
  }
  return cal.toString() + '\r\n';
}

export function downloadText(filename: string, text: string, type = 'text/calendar') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
