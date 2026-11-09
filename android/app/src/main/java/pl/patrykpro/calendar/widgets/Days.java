package pl.patrykpro.calendar.widgets;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Calendar days as plain numbers: days since 1970-01-01, the "epoch day".
 *
 * The widgets reason in local days a lot (which day an event touches, the
 * cells of a month, how far a list reaches) and java.time is not there before
 * Android 8, so the few conversions live here. A day number has no time zone:
 * "2026-11-12" is the same number everywhere, which is what the snapshot's
 * all-day dates mean. Only {@link #dayOf} and {@link #startOf} meet instants,
 * and they take the zone explicitly, so a day of 23 or 25 hours (the change to
 * or from summer time) is still one day.
 *
 * The date arithmetic is the well-known proleptic Gregorian one: exact for
 * every day the app can show, and free of any Android class, so the unit tests
 * run it as it is.
 */
final class Days {
    /** No day: an absent or malformed date. */
    static final int NONE = Integer.MIN_VALUE;

    static final long DAY_MS = 86_400_000L;

    /** Dates outside these years are taken for mistakes, not for days to show. */
    private static final int MIN_YEAR = 1900;
    private static final int MAX_YEAR = 2400;

    private Days() {}

    /** The day of a year, month (1-12) and day of the month; no check that the date exists. */
    static int of(int year, int month, int day) {
        int y = month <= 2 ? year - 1 : year;
        int era = Math.floorDiv(y, 400);
        int yearOfEra = y - era * 400;
        int dayOfYear = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
        int dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
        return era * 146097 + dayOfEra - 719468;
    }

    /** {year, month (1-12), day of the month} of a day. */
    static int[] parts(int day) {
        int z = day + 719468;
        int era = Math.floorDiv(z, 146097);
        int dayOfEra = z - era * 146097;
        int yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
        int dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
        int mp = (5 * dayOfYear + 2) / 153;
        int dayOfMonth = dayOfYear - (153 * mp + 2) / 5 + 1;
        int month = mp < 10 ? mp + 3 : mp - 9;
        int year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
        return new int[] {year, month, dayOfMonth};
    }

    static int year(int day) {
        return parts(day)[0];
    }

    static int month(int day) {
        return parts(day)[1];
    }

    static int dayOfMonth(int day) {
        return parts(day)[2];
    }

    /** 0 for Sunday up to 6 for Saturday, as the snapshot's {@code weekStart} counts. 1970-01-01 was a Thursday. */
    static int weekday(int day) {
        return Math.floorMod(day + 4, 7);
    }

    /** The first day of the month {@code day} is in. */
    static int firstOfMonth(int day) {
        int[] p = parts(day);
        return of(p[0], p[1], 1);
    }

    /** The first day of the month {@code months} months after (or before) the month of {@code day}. */
    static int addMonths(int day, int months) {
        int[] p = parts(day);
        int index = p[0] * 12 + (p[1] - 1) + months;
        return of(Math.floorDiv(index, 12), Math.floorMod(index, 12) + 1, 1);
    }

    /**
     * A "YYYY-MM-DD" date, strictly: four digits, two, two, a date that exists,
     * in a sensible range. Anything else is {@link #NONE}.
     */
    static int parse(String text) {
        if (text == null || text.length() != 10 || text.charAt(4) != '-' || text.charAt(7) != '-') return NONE;
        int year = digits(text, 0, 4);
        int month = digits(text, 5, 7);
        int day = digits(text, 8, 10);
        if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return NONE;
        int result = of(year, month, day);
        // A day past the end of its month (2026-02-30) comes back as another date.
        return dayOfMonth(result) == day ? result : NONE;
    }

    private static int digits(String text, int from, int to) {
        int value = 0;
        for (int i = from; i < to; i++) {
            char c = text.charAt(i);
            if (c < '0' || c > '9') return -1;
            value = value * 10 + (c - '0');
        }
        return value;
    }

    /** "YYYY-MM-DD", as the web app writes days. */
    static String format(int day) {
        int[] p = parts(day);
        return String.format(Locale.ROOT, "%04d-%02d-%02d", p[0], p[1], p[2]);
    }

    /** The local day an instant falls on in {@code zone}. */
    static int dayOf(long millis, TimeZone zone) {
        return (int) Math.floorDiv(millis + zone.getOffset(millis), DAY_MS);
    }

    /**
     * The first instant of a local day in {@code zone}: its midnight, or the
     * first moment after it where a change of the clock skips midnight itself.
     */
    static long startOf(int day, TimeZone zone) {
        int[] p = parts(day);
        GregorianCalendar c = new GregorianCalendar(zone, Locale.ROOT);
        c.clear();
        c.set(p[0], p[1] - 1, p[2], 0, 0, 0);
        c.set(Calendar.MILLISECOND, 0);
        long start = c.getTimeInMillis();
        // A lenient calendar puts a skipped midnight after the gap; one before it would still be the day before.
        while (dayOf(start, zone) < day) start += 60_000L;
        return start;
    }

    /** The day {@code day} as an instant at UTC midnight, for formatting a date without a zone. */
    static long utcMillis(int day) {
        return day * DAY_MS;
    }
}
