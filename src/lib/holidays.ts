// Public holidays, computed on the device from each country's rules, so a
// holiday calendar needs no feed and no request to a third party.
//
// Only nationwide holidays are listed; regional ones (German states, Spanish
// communities, Canadian provinces, ...) are left out.

export type HolidayLang = 'en' | 'pl';
type Name = Record<HolidayLang, string>;

interface RuleBase {
  name: Name;
  /** First and last year the holiday exists. */
  from?: number;
  to?: number;
  /**
   * What happens when the day falls on a weekend: 'next' adds a substitute on
   * the next free weekday (UK), 'nearest' on the Friday before or the Monday
   * after (US federal holidays).
   */
  observed?: 'next' | 'nearest';
}

type Rule = RuleBase &
  (
    | { date: [month: number, day: number] }
    /** Days after Easter Sunday (negative: before). */
    | { easter: number }
    /** The n-th (or with -1 the last) given weekday of a month; 0 = Sunday. */
    | { nth: [n: number, weekday: number, month: number] }
    | { on: (year: number) => Date }
  );

export interface HolidayCountry {
  code: string;
  name: Name;
  rules: Rule[];
}

export interface Holiday {
  date: Date;
  name: Name;
}

const n = (en: string, pl: string): Name => ({ en, pl });

const NEW_YEAR = n("New Year's Day", 'Nowy Rok');
const EPIPHANY = n('Epiphany', 'Święto Trzech Króli');
const MAUNDY_THURSDAY = n('Maundy Thursday', 'Wielki Czwartek');
const GOOD_FRIDAY = n('Good Friday', 'Wielki Piątek');
const EASTER_SUNDAY = n('Easter Sunday', 'Wielkanoc');
const EASTER_MONDAY = n('Easter Monday', 'Poniedziałek Wielkanocny');
const LABOUR_DAY = n('Labour Day', 'Święto Pracy');
const ASCENSION = n('Ascension Day', 'Wniebowstąpienie Pańskie');
const WHIT_SUNDAY = n('Whit Sunday', 'Zielone Świątki');
const WHIT_MONDAY = n('Whit Monday', 'Poniedziałek Zielonoświątkowy');
const CORPUS_CHRISTI = n('Corpus Christi', 'Boże Ciało');
const ASSUMPTION = n('Assumption of Mary', 'Wniebowzięcie Najświętszej Maryi Panny');
const ALL_SAINTS = n("All Saints' Day", 'Wszystkich Świętych');
const IMMACULATE = n('Immaculate Conception', 'Niepokalane Poczęcie Najświętszej Maryi Panny');
const CHRISTMAS_EVE = n('Christmas Eve', 'Wigilia Bożego Narodzenia');
const CHRISTMAS = n('Christmas Day', 'Boże Narodzenie');
const SECOND_CHRISTMAS = n('Second Day of Christmas', 'Drugi dzień Bożego Narodzenia');
const ST_STEPHEN = n("St. Stephen's Day", 'Drugi dzień Bożego Narodzenia');
const BOXING_DAY = n('Boxing Day', 'Drugi dzień Bożego Narodzenia');
const VICTORY_DAY = n('Victory Day', 'Dzień Zwycięstwa');
const ARMISTICE = n('Armistice Day', 'Dzień Zawieszenia Broni');
const MIDSUMMER = n('Midsummer Day', 'Midsommar');

const EASTER: Rule[] = [
  { name: EASTER_SUNDAY, easter: 0 },
  { name: EASTER_MONDAY, easter: 1 },
];

/** The Saturday in the week starting at the given date. */
const saturdayFrom = (month: number, day: number) => (year: number) => {
  const d = new Date(year, month - 1, day);
  d.setDate(day + ((6 - d.getDay() + 7) % 7));
  return d;
};

export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  {
    code: 'PL',
    name: n('Poland', 'Polska'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      ...EASTER,
      { name: LABOUR_DAY, date: [5, 1] },
      { name: n('Constitution Day', 'Święto Konstytucji 3 Maja'), date: [5, 3] },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: CORPUS_CHRISTI, easter: 60 },
      { name: ASSUMPTION, date: [8, 15] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: n('Independence Day', 'Narodowe Święto Niepodległości'), date: [11, 11] },
      { name: CHRISTMAS_EVE, date: [12, 24], from: 2025 },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'US',
    name: n('United States', 'Stany Zjednoczone'),
    rules: [
      { name: NEW_YEAR, date: [1, 1], observed: 'nearest' },
      { name: n('Martin Luther King Jr. Day', 'Dzień Martina Luthera Kinga'), nth: [3, 1, 1] },
      { name: n("Presidents' Day", 'Dzień Prezydentów'), nth: [3, 1, 2] },
      { name: n('Memorial Day', 'Dzień Pamięci'), nth: [-1, 1, 5] },
      { name: n('Juneteenth', 'Juneteenth'), date: [6, 19], from: 2021, observed: 'nearest' },
      { name: n('Independence Day', 'Dzień Niepodległości'), date: [7, 4], observed: 'nearest' },
      { name: n('Labor Day', 'Święto Pracy'), nth: [1, 1, 9] },
      { name: n('Columbus Day', 'Dzień Kolumba'), nth: [2, 1, 10] },
      { name: n('Veterans Day', 'Dzień Weteranów'), date: [11, 11], observed: 'nearest' },
      { name: n('Thanksgiving Day', 'Święto Dziękczynienia'), nth: [4, 4, 11] },
      { name: CHRISTMAS, date: [12, 25], observed: 'nearest' },
    ],
  },
  {
    code: 'GB',
    name: n('United Kingdom (England & Wales)', 'Wielka Brytania (Anglia i Walia)'),
    rules: [
      { name: NEW_YEAR, date: [1, 1], observed: 'next' },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: EASTER_MONDAY, easter: 1 },
      { name: n('Early May bank holiday', 'Majowe święto bankowe'), nth: [1, 1, 5] },
      { name: n('Spring bank holiday', 'Wiosenne święto bankowe'), nth: [-1, 1, 5] },
      { name: n('Summer bank holiday', 'Letnie święto bankowe'), nth: [-1, 1, 8] },
      { name: CHRISTMAS, date: [12, 25], observed: 'next' },
      { name: BOXING_DAY, date: [12, 26], observed: 'next' },
    ],
  },
  {
    code: 'DE',
    name: n('Germany', 'Niemcy'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: EASTER_MONDAY, easter: 1 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: n('German Unity Day', 'Dzień Jedności Niemiec'), date: [10, 3] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'FR',
    name: n('France', 'Francja'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EASTER_MONDAY, easter: 1 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: n('Victory in Europe Day', 'Dzień Zwycięstwa'), date: [5, 8] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: n('Bastille Day', 'Święto Narodowe Francji'), date: [7, 14] },
      { name: ASSUMPTION, date: [8, 15] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: ARMISTICE, date: [11, 11] },
      { name: CHRISTMAS, date: [12, 25] },
    ],
  },
  {
    code: 'ES',
    name: n('Spain', 'Hiszpania'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASSUMPTION, date: [8, 15] },
      { name: n('National Day of Spain', 'Święto Narodowe Hiszpanii'), date: [10, 12] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: n('Constitution Day', 'Dzień Konstytucji'), date: [12, 6] },
      { name: IMMACULATE, date: [12, 8] },
      { name: CHRISTMAS, date: [12, 25] },
    ],
  },
  {
    code: 'IT',
    name: n('Italy', 'Włochy'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      ...EASTER,
      { name: n('Liberation Day', 'Dzień Wyzwolenia'), date: [4, 25] },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: n('Republic Day', 'Święto Republiki'), date: [6, 2] },
      { name: ASSUMPTION, date: [8, 15] },
      { name: n('Feast of St. Francis of Assisi', 'Święto św. Franciszka z Asyżu'), date: [10, 4], from: 2026 },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: IMMACULATE, date: [12, 8] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: ST_STEPHEN, date: [12, 26] },
    ],
  },
  {
    code: 'NL',
    name: n('Netherlands', 'Holandia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: GOOD_FRIDAY, easter: -2 },
      ...EASTER,
      // Celebrated a day early when the 27th is a Sunday.
      { name: n("King's Day", 'Dzień Króla'), on: (y) => new Date(y, 3, new Date(y, 3, 27).getDay() === 0 ? 26 : 27) },
      { name: n('Liberation Day', 'Dzień Wyzwolenia'), date: [5, 5] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'BE',
    name: n('Belgium', 'Belgia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EASTER_MONDAY, easter: 1 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: n('Belgian National Day', 'Święto Narodowe Belgii'), date: [7, 21] },
      { name: ASSUMPTION, date: [8, 15] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: ARMISTICE, date: [11, 11] },
      { name: CHRISTMAS, date: [12, 25] },
    ],
  },
  {
    code: 'AT',
    name: n('Austria', 'Austria'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      { name: EASTER_MONDAY, easter: 1 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: CORPUS_CHRISTI, easter: 60 },
      { name: ASSUMPTION, date: [8, 15] },
      { name: n('Austrian National Day', 'Święto Narodowe Austrii'), date: [10, 26] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: IMMACULATE, date: [12, 8] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: ST_STEPHEN, date: [12, 26] },
    ],
  },
  {
    code: 'CZ',
    name: n('Czechia', 'Czechy'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: EASTER_MONDAY, easter: 1 },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: VICTORY_DAY, date: [5, 8] },
      { name: n('Saints Cyril and Methodius Day', 'Dzień Świętych Cyryla i Metodego'), date: [7, 5] },
      { name: n('Jan Hus Day', 'Dzień Jana Husa'), date: [7, 6] },
      { name: n('Czech Statehood Day', 'Dzień Czeskiej Państwowości'), date: [9, 28] },
      { name: n('Independent Czechoslovak State Day', 'Dzień Powstania Niepodległej Czechosłowacji'), date: [10, 28] },
      { name: n('Struggle for Freedom and Democracy Day', 'Dzień Walki o Wolność i Demokrację'), date: [11, 17] },
      { name: CHRISTMAS_EVE, date: [12, 24] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: ST_STEPHEN, date: [12, 26] },
    ],
  },
  {
    code: 'IE',
    name: n('Ireland', 'Irlandia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      {
        // The first Monday of February, or the 1st itself when it is a Friday.
        name: n("St. Brigid's Day", 'Dzień Świętej Brygidy'),
        from: 2023,
        on: (y) => (new Date(y, 1, 1).getDay() === 5 ? new Date(y, 1, 1) : nthWeekday(y, 2, 1, 1)),
      },
      { name: n("St. Patrick's Day", 'Dzień Świętego Patryka'), date: [3, 17] },
      { name: EASTER_MONDAY, easter: 1 },
      { name: n('May bank holiday', 'Majowe święto bankowe'), nth: [1, 1, 5] },
      { name: n('June bank holiday', 'Czerwcowe święto bankowe'), nth: [1, 1, 6] },
      { name: n('August bank holiday', 'Sierpniowe święto bankowe'), nth: [1, 1, 8] },
      { name: n('October bank holiday', 'Październikowe święto bankowe'), nth: [-1, 1, 10] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: ST_STEPHEN, date: [12, 26] },
    ],
  },
  {
    code: 'PT',
    name: n('Portugal', 'Portugalia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: EASTER_SUNDAY, easter: 0 },
      { name: n('Freedom Day', 'Dzień Wolności'), date: [4, 25] },
      { name: LABOUR_DAY, date: [5, 1] },
      { name: CORPUS_CHRISTI, easter: 60 },
      { name: n('Portugal Day', 'Dzień Portugalii'), date: [6, 10] },
      { name: ASSUMPTION, date: [8, 15] },
      { name: n('Republic Day', 'Święto Republiki'), date: [10, 5] },
      { name: ALL_SAINTS, date: [11, 1] },
      { name: n('Restoration of Independence', 'Dzień Restauracji Niepodległości'), date: [12, 1] },
      { name: IMMACULATE, date: [12, 8] },
      { name: CHRISTMAS, date: [12, 25] },
    ],
  },
  {
    code: 'SE',
    name: n('Sweden', 'Szwecja'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      { name: GOOD_FRIDAY, easter: -2 },
      ...EASTER,
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: n('National Day of Sweden', 'Święto Narodowe Szwecji'), date: [6, 6] },
      { name: MIDSUMMER, on: saturdayFrom(6, 20) },
      { name: ALL_SAINTS, on: saturdayFrom(10, 31) },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'NO',
    name: n('Norway', 'Norwegia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: MAUNDY_THURSDAY, easter: -3 },
      { name: GOOD_FRIDAY, easter: -2 },
      ...EASTER,
      { name: LABOUR_DAY, date: [5, 1] },
      { name: n('Constitution Day', 'Dzień Konstytucji'), date: [5, 17] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'DK',
    name: n('Denmark', 'Dania'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: MAUNDY_THURSDAY, easter: -3 },
      { name: GOOD_FRIDAY, easter: -2 },
      ...EASTER,
      { name: ASCENSION, easter: 39 },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: WHIT_MONDAY, easter: 50 },
      { name: CHRISTMAS, date: [12, 25] },
      { name: SECOND_CHRISTMAS, date: [12, 26] },
    ],
  },
  {
    code: 'FI',
    name: n('Finland', 'Finlandia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: EPIPHANY, date: [1, 6] },
      { name: GOOD_FRIDAY, easter: -2 },
      ...EASTER,
      { name: LABOUR_DAY, date: [5, 1] },
      { name: ASCENSION, easter: 39 },
      { name: WHIT_SUNDAY, easter: 49 },
      { name: MIDSUMMER, on: saturdayFrom(6, 20) },
      { name: ALL_SAINTS, on: saturdayFrom(10, 31) },
      { name: n('Independence Day', 'Dzień Niepodległości'), date: [12, 6] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: ST_STEPHEN, date: [12, 26] },
    ],
  },
  {
    code: 'CA',
    name: n('Canada', 'Kanada'),
    rules: [
      { name: NEW_YEAR, date: [1, 1] },
      { name: GOOD_FRIDAY, easter: -2 },
      {
        // The Monday before 25 May.
        name: n('Victoria Day', 'Dzień Wiktorii'),
        on: (y) => {
          const d = new Date(y, 4, 24);
          d.setDate(24 - ((d.getDay() + 6) % 7));
          return d;
        },
      },
      { name: n('Canada Day', 'Dzień Kanady'), date: [7, 1] },
      { name: LABOUR_DAY, nth: [1, 1, 9] },
      { name: n('National Day for Truth and Reconciliation', 'Narodowy Dzień Prawdy i Pojednania'), date: [9, 30], from: 2021 },
      { name: n('Thanksgiving', 'Święto Dziękczynienia'), nth: [2, 1, 10] },
      { name: n('Remembrance Day', 'Dzień Pamięci'), date: [11, 11] },
      { name: CHRISTMAS, date: [12, 25] },
      { name: BOXING_DAY, date: [12, 26] },
    ],
  },
  {
    code: 'AU',
    name: n('Australia', 'Australia'),
    rules: [
      { name: NEW_YEAR, date: [1, 1], observed: 'next' },
      { name: n('Australia Day', 'Dzień Australii'), date: [1, 26], observed: 'next' },
      { name: GOOD_FRIDAY, easter: -2 },
      { name: EASTER_MONDAY, easter: 1 },
      { name: n('Anzac Day', 'Dzień ANZAC'), date: [4, 25] },
      { name: CHRISTMAS, date: [12, 25], observed: 'next' },
      { name: BOXING_DAY, date: [12, 26], observed: 'next' },
    ],
  },
];

/** Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** The n-th weekday of a month (1-based month); n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  if (nth > 0) {
    const first = new Date(year, month - 1, 1);
    return new Date(year, month - 1, 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7);
  }
  const last = new Date(year, month, 0);
  return new Date(year, month - 1, last.getDate() - ((last.getDay() - weekday + 7) % 7) + (nth + 1) * 7);
}

function ruleDate(rule: Rule, year: number): Date {
  if ('date' in rule) return new Date(year, rule.date[0] - 1, rule.date[1]);
  if ('easter' in rule) {
    const e = easterSunday(year);
    return new Date(year, e.getMonth(), e.getDate() + rule.easter);
  }
  if ('nth' in rule) return nthWeekday(year, rule.nth[2], rule.nth[1], rule.nth[0]);
  return rule.on(year);
}

const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

export function holidayCountry(code: string): HolidayCountry | undefined {
  return HOLIDAY_COUNTRIES.find((c) => c.code === code);
}

/**
 * A country's holidays for one year, in date order. A substitute day can
 * fall just outside the year (1 January on a Saturday is observed on
 * 31 December in the US).
 */
export function holidaysIn(code: string, year: number): Holiday[] {
  const country = holidayCountry(code);
  if (!country) return [];
  const rules = country.rules.filter((r) => year >= (r.from ?? -Infinity) && year <= (r.to ?? Infinity));
  const out: Holiday[] = rules.map((r) => ({ date: ruleDate(r, year), name: r.name }));
  const taken = new Set(out.map((h) => dayKey(h.date)));

  rules.forEach((rule, i) => {
    const day = out[i].date.getDay();
    if (!rule.observed || (day !== 0 && day !== 6)) return;
    const date = new Date(out[i].date);
    if (rule.observed === 'nearest') date.setDate(date.getDate() + (day === 6 ? -1 : 1));
    else {
      // The next weekday that is not a holiday (or another substitute) itself.
      do date.setDate(date.getDate() + 1);
      while (date.getDay() === 0 || date.getDay() === 6 || taken.has(dayKey(date)));
    }
    taken.add(dayKey(date));
    const suffix = rule.observed === 'nearest' ? n('observed', 'dzień wolny') : n('substitute day', 'dzień wolny');
    out.push({ date, name: n(`${rule.name.en} (${suffix.en})`, `${rule.name.pl} (${suffix.pl})`) });
  });
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
