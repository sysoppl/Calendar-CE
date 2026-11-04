import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_COLORS, THEMES } from '@/theme/themes';
import { en } from './en';
import { pl } from './pl';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

/** The files the dictionaries are made of: they define keys, they do not use them. */
const DICTIONARY = /[\\/]i18n[\\/]((\w+\.)?(en|pl)|locales[\\/]\w+)\.ts$/;

/**
 * Key families the source builds from a value (`color.${c.id}`) whose values come from a fixed list.
 * Only the list's members count as used, so a retired colour or theme cannot hide behind the template.
 */
const FAMILIES: Record<string, readonly string[]> = {
  'color.': [...CALENDAR_COLORS.map((c) => c.id), 'custom'],
  'theme.': THEMES.map((theme) => theme.id),
};

/** The keys of one language's own dictionary files, by file stem ('en', 'account.en', …). */
function dictionaryKeys(lang: 'en' | 'pl'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of readdirSync(__dirname)) {
    const m = name.match(new RegExp(`^((\\w+\\.)?)${lang}\\.ts$`));
    if (!m) continue;
    const keys = [...readFileSync(join(__dirname, name), 'utf8').matchAll(/^\s*'([^']+)'\s*:/gm)].map((k) => k[1]);
    out.set(m[1] || '(main)', keys.sort());
  }
  return out;
}

describe('i18n', () => {
  it('has the same keys in English and Polish, file by file', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    const enFiles = dictionaryKeys('en');
    const plFiles = dictionaryKeys('pl');
    expect([...plFiles.keys()].sort()).toEqual([...enFiles.keys()].sort());
    for (const [file, keys] of enFiles) expect(plFiles.get(file), file).toEqual(keys);
  });

  it('uses every key it defines', () => {
    const code = sourceFiles(join(__dirname, '..'))
      .filter((f) => !f.endsWith('.test.tsx') && !DICTIONARY.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    // Keys built from a value: `welcome.${o.key}.title`, `migrate.place.${role}.caldav`. The text before the
    // first value must end with a dot, which leaves out unrelated templates (`w${uid}`).
    const templates = [...new Set([...code.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)*\.\$\{[^`]*)`/g)].map((m) => m[1]))].map((tpl) => {
      const prefix = tpl.slice(0, tpl.indexOf('${'));
      const parts = tpl.split(/\$\{[^}]*\}/).map((s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&'));
      return { prefix, family: FAMILIES[prefix] && parts.length === 2 && parts[1] === '', re: new RegExp(`^${parts.join('[\\w.-]+')}$`) };
    });
    const used = (key: string) =>
      code.includes(`'${key}'`) ||
      code.includes(`"${key}"`) ||
      code.includes(`\`${key}\``) ||
      templates.some((tpl) => tpl.re.test(key) && (!tpl.family || FAMILIES[tpl.prefix].some((v) => key === tpl.prefix + v)));
    expect(Object.keys(en).filter((key) => !used(key))).toEqual([]);
  });

  it('has the same placeholders in every translation', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(vars(pl[key]), key).toBe(vars(en[key]));
    }
  });

  it('words the Polish hints impersonally, addressing nobody', () => {
    // Verbs in the second person singular ("wybierzesz", "możesz") and its pronouns.
    const direct = /\p{L}+(esz|isz|ysz)(?!\p{L})|(?<!\p{L})(twój|twoja|twoje|twoich|twoim|ciebie|tobie|cię)(?!\p{L})/iu;
    const hints = Object.entries(pl).filter(([key]) => /hint/i.test(key));
    expect(hints.length).toBeGreaterThan(10);
    expect(hints.filter(([, text]) => direct.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('defines every key used in the source', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9.\-]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
