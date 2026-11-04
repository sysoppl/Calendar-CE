import { useLang } from '@/i18n';

/**
 * Polish typesetting keeps a one-letter word (a, i, o, u, w, z) off the end
 * of a line, and a dash off the start of one. Applied to the longer copy of
 * the first start, where lines are short and such breaks are easy to see.
 */
export function typeset(text: string, lang: string): string {
  if (lang !== 'pl') return text;
  return text.replace(/(^|[\s(„])([aiouwzAIOUWZ]) /g, '$1$2 ').replace(/ –/g, ' –');
}

export function useTypeset(): (text: string) => string {
  const lang = useLang();
  return (text) => typeset(text, lang);
}
