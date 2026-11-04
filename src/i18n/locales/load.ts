// The extra languages' dictionaries, each its own chunk: a device loads the
// one it uses and no other. Imports no store (the page shown before the app
// runs loads them too).
import type { ExtraLang } from '../languages';
import type { LocaleModule } from './types';

const LOADERS: Record<ExtraLang, () => Promise<{ locale: LocaleModule }>> = {
  de: () => import('./de'),
  es: () => import('./es'),
  fr: () => import('./fr'),
  it: () => import('./it'),
  pt: () => import('./pt'),
  uk: () => import('./uk'),
  cs: () => import('./cs'),
  nl: () => import('./nl'),
};

/** The dictionary of `lang`, or undefined when its chunk could not be loaded (offline, not cached). Never rejects. */
export async function loadLocale(lang: ExtraLang): Promise<LocaleModule | undefined> {
  try {
    return (await LOADERS[lang]()).locale;
  } catch {
    return undefined;
  }
}
