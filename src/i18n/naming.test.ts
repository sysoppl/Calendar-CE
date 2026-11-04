// How the app names itself and its places, checked over the dictionaries and
// the Android strings: only the hosted edition's cloud is ever said to be
// end-to-end encrypted, never this device or a CalDAV server.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { pl } from './pl';

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

/** The Android value resources (strings.xml and any other file of them), joined by folder (values, values-pl, …). */
function androidStrings(): Record<string, string> {
  const res = 'android/app/src/main/res/';
  const out: Record<string, string> = {};
  for (const dir of readdirSync(new URL(res, ROOT))) {
    if (!dir.startsWith('values')) continue;
    const files = readdirSync(new URL(`${res}${dir}/`, ROOT)).filter((name) => name.endsWith('.xml'));
    out[dir] = files.map((name) => read(`${res}${dir}/${name}`)).join('\n');
  }
  return out;
}

/** The translatable strings of one strings.xml, by name. */
function stringsOf(xml: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g)) {
    if (/translatable="false"/.test(m[2])) continue;
    found.set(m[1], m[3]);
  }
  return found;
}

/** What a sentence says the end-to-end encryption covers: the place named nearest to each mention of it. */
const PLACES: [place: string, pattern: RegExp][] = [
  ['cloud', /cloud|chmur/giu],
  ['device', /this device|tym urządzeniu/giu],
  ['caldav', /CalDAV/gu],
];
const CLAIM = /end[-‑ ]to[-‑ ]end|E2EE/giu;

function encryptedPlaces(text: string): string[] {
  // The promoted name says what the product is; it is not a claim about one place.
  const plain = text.replace(/E2EE Calendar|Kalendarz E2EE/gu, '');
  const claimed: string[] = [];
  for (const sentence of plain.split(/(?<=[.!?:])\s+/u)) {
    for (const claim of sentence.matchAll(CLAIM)) {
      const at = claim.index;
      let nearest: [string, number] | null = null;
      for (const [place, pattern] of PLACES) {
        for (const m of sentence.matchAll(pattern)) {
          const distance = m.index < at ? at - (m.index + m[0].length) : m.index - (at + claim[0].length);
          if (!nearest || distance < nearest[1]) nearest = [place, distance];
        }
      }
      if (nearest) claimed.push(nearest[0]);
    }
  }
  return claimed;
}

describe('naming', () => {
  it('names the app Calendar', () => {
    expect(en['app.name']).toBe('Calendar');
    expect(pl['app.name']).toBe('Kalendarz');
    const android = androidStrings();
    expect(stringsOf(android.values).get('app_name')).toBe('Calendar');
    expect(stringsOf(android['values-pl']).get('app_name')).toBe('Kalendarz');
  });

  it('never says that this device or a CalDAV server is end-to-end encrypted', () => {
    const wrong: string[] = [];
    for (const [lang, dict] of Object.entries({ en, pl })) {
      for (const [key, text] of Object.entries(dict)) {
        if (encryptedPlaces(text).some((place) => place !== 'cloud')) wrong.push(`${lang} ${key}: ${text}`);
      }
    }
    expect(wrong).toEqual([]);
    // The link to the hosted edition gives the claim to its cloud.
    for (const key of ['promo.cloud.text'] as const) {
      expect(encryptedPlaces(en[key]), key).toEqual(['cloud']);
      expect(encryptedPlaces(pl[key]), key).toEqual(['cloud']);
    }
  });

  it('tells a claim about the cloud from one about the other places', () => {
    expect(encryptedPlaces('Keep them on this device, on a CalDAV server or in the cloud, end-to-end encrypted.')).toEqual(['cloud']);
    expect(encryptedPlaces('Keep them in the cloud, or on this device, end-to-end encrypted.')).toEqual(['device']);
    expect(encryptedPlaces('Sync with the cloud. Keep them on a CalDAV server, end‑to‑end encrypted.')).toEqual(['caldav']);
    expect(encryptedPlaces('E2EE Calendar for the web and Android.')).toEqual([]);
    expect(encryptedPlaces('Na tym urządzeniu albo na serwerze CalDAV z szyfrowaniem end‑to‑end.')).toEqual(['caldav']);
  });

  it('has every Android string in both languages, with the same placeholders', () => {
    const android = androidStrings();
    const english = stringsOf(android.values);
    const polish = stringsOf(android['values-pl']);
    expect([...polish.keys()].sort()).toEqual([...english.keys()].sort());
    const args = (s: string) => (s.match(/%\d+\$[sd]/g) ?? []).sort().join();
    for (const [name, text] of english) expect(args(polish.get(name)!), name).toBe(args(text));
  });
});
