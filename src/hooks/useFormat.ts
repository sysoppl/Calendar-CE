import { useMemo } from 'react';
import { dateFnsLocale, intlLocale, useLang, type Lang } from '@/i18n';
import { useSettings } from '@/store/settings';
import type { ViewType } from '@/store/settings';
import type { Range } from '@/lib/date';

export interface Formatter {
  lang: Lang;
  locale: string;
  hour12: boolean;
  dfLocale: ReturnType<typeof dateFnsLocale>;
  time: (d: Date) => string;
  /** Compact hour label for the time gutter ("13", "1 PM"). */
  hourLabel: (hour: number) => string;
  timeRange: (a: Date, b: Date) => string;
  date: (d: Date, opts: Intl.DateTimeFormatOptions) => string;
  weekdayShort: (d: Date) => string;
  weekdayNarrow: (d: Date) => string;
  monthLong: (d: Date) => string;
  title: (view: ViewType, range: Range, date: Date) => string;
  relativeTime: (d: Date) => string;
  /** Short name of a time zone ("CEST", "GMT+2"); the local zone when omitted. */
  zoneName: (timeZone?: string) => string;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, opts: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

export function makeFormatter(lang: Lang, timeFormat: '12h' | '24h' | 'auto'): Formatter {
  const locale = intlLocale(lang);
  const autoCycle = dtf(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  const hour12 = timeFormat === 'auto' ? autoCycle === 'h11' || autoCycle === 'h12' : timeFormat === '12h';
  const timeFmt = dtf(locale, { hour: 'numeric', minute: '2-digit', hour12 });
  const date = (d: Date, opts: Intl.DateTimeFormatOptions) => dtf(locale, opts).format(d);
  const sameYear = (d: Date) => d.getFullYear() === new Date().getFullYear();

  return {
    lang,
    locale,
    hour12,
    dfLocale: dateFnsLocale(lang),
    time: (d) => timeFmt.format(d),
    hourLabel: (hour) => {
      const d = new Date(2000, 0, 1, hour);
      if (hour12) return dtf(locale, { hour: 'numeric', hour12: true }).format(d);
      return `${String(hour).padStart(2, '0')}:00`;
    },
    timeRange: (a, b) => `${timeFmt.format(a)} – ${timeFmt.format(b)}`,
    date,
    weekdayShort: (d) => date(d, { weekday: 'short' }).replace('.', ''),
    weekdayNarrow: (d) => date(d, { weekday: 'narrow' }),
    monthLong: (d) => date(d, { month: 'long' }),
    title: (view, range, d) => {
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      switch (view) {
        case 'day':
          return cap(date(d, { weekday: 'long', day: 'numeric', month: 'long', year: sameYear(d) ? undefined : 'numeric' }));
        case 'year':
          return String(d.getFullYear());
        case 'month':
          return cap(date(d, { month: 'long', year: 'numeric' }));
        default: {
          const last = new Date(range.end.getTime() - 1);
          if (range.start.getMonth() === last.getMonth()) return cap(date(range.start, { month: 'long', year: 'numeric' }));
          if (range.start.getFullYear() === last.getFullYear()) {
            return cap(`${date(range.start, { month: 'short' })} – ${date(last, { month: 'short', year: 'numeric' })}`);
          }
          return cap(`${date(range.start, { month: 'short', year: 'numeric' })} – ${date(last, { month: 'short', year: 'numeric' })}`);
        }
      }
    },
    relativeTime: (d) => {
      const diff = (d.getTime() - Date.now()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      return rtf.format(Math.round(diff / 86400), 'day');
    },
    zoneName: (timeZone) => {
      try {
        const parts = dtf(locale, { timeZone, timeZoneName: 'short' }).formatToParts(new Date());
        return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone ?? '';
      } catch {
        return timeZone ?? '';
      }
    },
  };
}

export function useFormat(): Formatter {
  const lang = useLang();
  const timeFormat = useSettings((s) => s.timeFormat);
  return useMemo(() => makeFormatter(lang, timeFormat), [lang, timeFormat]);
}
