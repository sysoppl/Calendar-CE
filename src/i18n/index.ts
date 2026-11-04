import { cs as csLocale, de as deLocale, enGB, enUS, es as esLocale, fr as frLocale, it as itLocale, nl as nlLocale, pl as plLocale, pt as ptLocale, ptBR, uk as ukLocale, type Locale } from 'date-fns/locale';
import { create } from 'zustand';
import { useSettings, type Settings } from '@/store/settings';
import { en, type MessageKey } from './en';
import { pl } from './pl';
import { pickLang, type ExtraLang, type Lang } from './languages';
import { loadLocale } from './locales/load';
import type { LocaleModule } from './locales/types';

export type { MessageKey, Lang, ExtraLang };
export { LANGS, EXTRA_LANGS, LANGUAGE_NAMES, detectLanguage, isLang, isExtraLang } from './languages';

const loaded = new Map<ExtraLang, LocaleModule>();
const loading = new Map<ExtraLang, Promise<void>>();

/** Counts the dictionaries loaded, so that what is shown in English for want of one is shown again once it is there. */
const useLoaded = create<{ count: number }>(() => ({ count: 0 }));

/** Loads the dictionary of `lang` if it has one that is not loaded yet. Never rejects: until it is there, texts are English. */
export function loadLanguage(lang: Lang): Promise<void> {
  if (lang === 'en' || lang === 'pl' || loaded.has(lang)) return Promise.resolve();
  let pending = loading.get(lang);
  if (!pending) {
    pending = loadLocale(lang)
      .then((module) => {
        if (!module) return;
        loaded.set(lang, module);
        useLoaded.setState((s) => ({ count: s.count + 1 }));
      })
      .finally(() => loading.delete(lang));
    loading.set(lang, pending);
  }
  return pending;
}

/** How many dictionaries have arrived: for work that follows the language's texts (holiday names). */
export function useDictionaryCount(): number {
  return useLoaded((s) => s.count);
}

/** The loaded dictionary of an extra language, if any. */
export function localeModule(lang: Lang): LocaleModule | undefined {
  return lang === 'en' || lang === 'pl' ? undefined : loaded.get(lang);
}

/** The language of these settings: see `pickLang`. */
export function resolveLang(settings: Pick<Settings, 'language'> & Partial<Pick<Settings, 'deviceLanguage'>>): Lang {
  return pickLang(settings.language, settings.deviceLanguage);
}

/**
 * The settings that choose `choice`: 'auto', English and Polish go into
 * `language`, another language into `deviceLanguage`. Waits for that
 * language's dictionary, so that nothing (reminders, holiday names) is
 * written in English for the moment it takes to load.
 */
export async function languageChoice(choice: 'auto' | Lang): Promise<Pick<Settings, 'language' | 'deviceLanguage'> | Pick<Settings, 'deviceLanguage'>> {
  if (choice === 'auto' || choice === 'en' || choice === 'pl') return { language: choice, deviceLanguage: '' };
  await loadLanguage(choice);
  return { deviceLanguage: choice };
}

let watching = false;

/**
 * Loads the dictionary the settings ask for, and from then on the one of
 * each new choice. The app waits for it before its first screen.
 */
export function prepareLanguage(): Promise<void> {
  if (!watching) {
    watching = true;
    useSettings.subscribe((s, prev) => {
      if (s.language !== prev.language || s.deviceLanguage !== prev.deviceLanguage) void loadLanguage(resolveLang(s));
    });
  }
  return loadLanguage(resolveLang(useSettings.getState()));
}

/** A typical region per language, for dates and numbers when the device names none of its own. */
const REGIONS: Record<Lang, string> = {
  en: 'en-US',
  pl: 'pl-PL',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
  uk: 'uk-UA',
  cs: 'cs-CZ',
  nl: 'nl-NL',
};

/** BCP 47 tag used for Intl formatting: the device's own variant of the language (en-GB, de-AT), else its usual one. */
export function intlLocale(lang: Lang): string {
  if (lang === 'pl') return 'pl-PL';
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  const code = nav?.toLowerCase().split(/[-_]/)[0];
  return nav && code === lang ? nav : REGIONS[lang];
}

export function dateFnsLocale(lang: Lang): Locale {
  switch (lang) {
    case 'pl':
      return plLocale;
    case 'de':
      return deLocale;
    case 'es':
      return esLocale;
    case 'fr':
      return frLocale;
    case 'it':
      return itLocale;
    case 'pt':
      return intlLocale(lang).toLowerCase() === 'pt-pt' ? ptLocale : ptBR;
    case 'uk':
      return ukLocale;
    case 'cs':
      return csLocale;
    case 'nl':
      return nlLocale;
    default:
      return intlLocale(lang) === 'en-US' ? enUS : enGB;
  }
}

function dictionary(lang: Lang): Partial<Record<MessageKey, string>> | undefined {
  if (lang === 'en') return en;
  if (lang === 'pl') return pl;
  return loaded.get(lang)?.messages;
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionary(lang)?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, () => String(v));
  return s;
}

/** A name kept in English and Polish (a holiday), in `lang`: the extra languages translate the English one. */
export function localName(name: { en: string; pl: string }, lang: Lang): string {
  if (lang === 'en' || lang === 'pl') return name[lang];
  return loaded.get(lang)?.holidays[name.en] ?? name.en;
}

/** A country's name in `lang`, from the engine for the extra languages. */
export function countryName(country: { code: string; name: { en: string; pl: string } }, lang: Lang): string {
  if (lang === 'en' || lang === 'pl') return country.name[lang];
  try {
    return new Intl.DisplayNames([intlLocale(lang)], { type: 'region' }).of(country.code) ?? country.name.en;
  } catch {
    return country.name.en;
  }
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function useLang(): Lang {
  return useSettings((s) => pickLang(s.language, s.deviceLanguage));
}

export function useT(): TFunction {
  const lang = useLang();
  // Read so that the texts are drawn again once the language's dictionary has arrived.
  useLoaded((s) => s.count);
  return (key, vars) => translate(lang, key, vars);
}

/** Non-hook accessor for use outside components. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(resolveLang(useSettings.getState()), key, vars);
}
