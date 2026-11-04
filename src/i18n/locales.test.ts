import { describe, expect, it } from 'vitest';
import { HOLIDAY_COUNTRIES } from '@/lib/holidays';
import { en } from './en';
import { EXTRA_LANGS, detectLanguage, pickLang } from './languages';
import { loadLocale } from './locales/load';

const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

/** Every holiday's English name, which the extra languages translate. */
const HOLIDAY_NAMES = [...new Set(HOLIDAY_COUNTRIES.flatMap((c) => c.rules.map((r) => r.name.en)))].sort();

describe('the extra languages', () => {
  for (const lang of EXTRA_LANGS) {
    describe(lang, () => {
      it('has every text, with the same placeholders, none empty', async () => {
        const locale = (await loadLocale(lang))!;
        expect(Object.keys(locale.messages).sort()).toEqual(Object.keys(en).sort());
        for (const [key, text] of Object.entries(locale.messages)) {
          expect(text.trim(), key).not.toBe('');
          expect(vars(text), key).toBe(vars(en[key as keyof typeof en]));
        }
      });

      it('names every holiday', async () => {
        const locale = (await loadLocale(lang))!;
        expect(Object.keys(locale.holidays).sort()).toEqual(HOLIDAY_NAMES);
        for (const [name, text] of Object.entries(locale.holidays)) expect(text.trim(), name).not.toBe('');
      });
    });
  }
});

describe('detectLanguage', () => {
  it('prefers Polish anywhere in the list, as it always did', () => {
    expect(detectLanguage(['en-US', 'pl-PL'])).toBe('pl');
    expect(detectLanguage(['de-DE', 'pl'])).toBe('pl');
  });

  it('takes the first language the app has, else English', () => {
    expect(detectLanguage(['de-AT', 'en-US'])).toBe('de');
    expect(detectLanguage(['ja-JP', 'pt-BR', 'fr'])).toBe('pt');
    expect(detectLanguage(['uk_UA'])).toBe('uk');
    expect(detectLanguage(['en-GB', 'nl'])).toBe('en');
    expect(detectLanguage(['ja-JP'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});

describe('pickLang', () => {
  it('takes the device\'s extra language over the language setting', () => {
    expect(pickLang('pl', 'de', ['en'])).toBe('de');
    expect(pickLang('auto', 'cs', ['en'])).toBe('cs');
  });

  it('takes the language setting, where auto asks the device', () => {
    expect(pickLang('en', '', ['pl'])).toBe('en');
    expect(pickLang('pl', undefined, ['en'])).toBe('pl');
    expect(pickLang('auto', '', ['fr-CA'])).toBe('fr');
  });

  it('ignores values it does not know', () => {
    expect(pickLang('xx', 'en', ['es'])).toBe('es');
    expect(pickLang(undefined, 'pl', ['it'])).toBe('it');
  });
});
