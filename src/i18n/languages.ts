// The interface's languages, and which one the device asks for. Nothing
// here loads a store, so the page shown before the app runs (another tab,
// a failed load) can use it too.

/** Every interface language, in the order the pickers list them after English and Polish. */
export const LANGS = ['en', 'pl', 'de', 'es', 'fr', 'it', 'pt', 'uk', 'cs', 'nl'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Languages whose dictionaries are loaded when needed (`src/i18n/locales`).
 * They are kept in a setting of their own (`deviceLanguage`): the `language`
 * setting stays 'auto' | 'en' | 'pl', the values every version of the app reads.
 */
export type ExtraLang = Exclude<Lang, 'en' | 'pl'>;
export const EXTRA_LANGS = LANGS.filter((l): l is ExtraLang => l !== 'en' && l !== 'pl');

/** Each language named in itself, so it can be found by someone who does not read the current one. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português (Brasil)',
  uk: 'Українська',
  cs: 'Čeština',
  nl: 'Nederlands',
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function isExtraLang(value: unknown): value is ExtraLang {
  return isLang(value) && value !== 'en' && value !== 'pl';
}

function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/**
 * The language the device asks for. Polish anywhere in the list wins, as it
 * always did (a Polish speaker with an English phone); otherwise the first
 * language of the list the app has, else English.
 */
export function detectLanguage(langs: readonly string[] = deviceLanguages()): Lang {
  const codes = langs.map((l) => l?.toLowerCase().split(/[-_]/)[0]);
  if (codes.includes('pl')) return 'pl';
  return codes.find(isLang) ?? 'en';
}

/**
 * The language in use: this device's own choice of one of the extra
 * languages, else the `language` setting, where 'auto' asks the device.
 */
export function pickLang(language: unknown, deviceLanguage: unknown, langs?: readonly string[]): Lang {
  if (isExtraLang(deviceLanguage)) return deviceLanguage;
  if (language === 'en' || language === 'pl') return language;
  return detectLanguage(langs);
}
