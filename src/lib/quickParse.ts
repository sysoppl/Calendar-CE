// Tiny natural-language parser for quick-add task titles (EN + PL).
// Recognises a trailing (or leading) date phrase and an optional "!" priority:
//   "Call Anna tomorrow", "Pay rent fri", "Raport jutro", "Dentist 24.10",
//   "Submit report !!" (priority high), "Buy milk next week".

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, niedziela: 0, niedz: 0, nd: 0, niedzielę: 0,
  monday: 1, mon: 1, poniedziałek: 1, pon: 1, poniedzialek: 1,
  tuesday: 2, tue: 2, tues: 2, wtorek: 2, wt: 2,
  wednesday: 3, wed: 3, środa: 3, sroda: 3, śr: 3, sr: 3, środę: 3, srode: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, czwartek: 4, czw: 4,
  friday: 5, fri: 5, piątek: 5, piatek: 5, pt: 5,
  saturday: 6, sat: 6, sobota: 6, sob: 6, sobotę: 6, sobote: 6,
};

export interface QuickParseResult {
  title: string;
  due?: Date;
  priority?: number;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function matchDate(phrase: string, now: Date): Date | undefined {
  const p = phrase.toLowerCase().trim();
  const today = startOfDay(now);
  if (['today', 'tonight', 'dziś', 'dzis', 'dzisiaj'].includes(p)) return today;
  if (['tomorrow', 'tmr', 'jutro'].includes(p)) return addDays(today, 1);
  if (['day after tomorrow', 'pojutrze'].includes(p)) return addDays(today, 2);
  if (['next week', 'w przyszłym tygodniu', 'za tydzień', 'za tydzien'].includes(p)) {
    const toMonday = (8 - today.getDay()) % 7 || 7;
    return addDays(today, toMonday);
  }
  const inDays = /^(?:in|za)\s+(\d{1,3})\s+(?:days?|dni|dzień|dzien)$/.exec(p);
  if (inDays) return addDays(today, Number(inDays[1]));

  const wd = /^(?:next\s+|on\s+|w\s+|we\s+)?(\p{L}+)$/u.exec(p);
  if (wd && wd[1] in WEEKDAYS) {
    const target = WEEKDAYS[wd[1]];
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0 || p.startsWith('next')) diff = diff || 7;
    return addDays(today, diff);
  }

  // 24.10, 24.10.2026, 24/10, 2026-10-24
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(p);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dm = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(p);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]) - 1;
    if (month > 11 || day > 31) return undefined;
    let year = dm[3] ? Number(dm[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month, day);
    if (!dm[3] && d < today) d = new Date(year + 1, month, day);
    return d;
  }
  return undefined;
}

export function quickParse(input: string, now = new Date()): QuickParseResult {
  let title = input.trim();
  let priority: number | undefined;

  const bang = /\s*(!{1,3})$/.exec(title);
  if (bang) {
    priority = bang[1].length === 3 ? 1 : bang[1].length === 2 ? 1 : 5;
    title = title.slice(0, bang.index).trim();
  }

  const words = title.split(/\s+/);
  // Try the longest trailing phrase first (up to 4 words), then leading.
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const due = matchDate(words.slice(-n).join(' '), now);
    if (due) return { title: words.slice(0, -n).join(' '), due, priority };
  }
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const due = matchDate(words.slice(0, n).join(' '), now);
    if (due) return { title: words.slice(n).join(' '), due, priority };
  }
  return { title, priority };
}
