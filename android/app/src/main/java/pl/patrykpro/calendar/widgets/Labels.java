package pl.patrykpro.calendar.widgets;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * The words and dates on the widgets, in the language the app is set to
 * (the snapshot's {@code lang}, not necessarily the phone's) and with its
 * clock, 12 or 24 hours.
 *
 * The patterns come from the system's locale data for that language
 * ({@link Texts#labels}), so "Wed, 12 Nov", "śr., 12 lis" and "Mi., 12. Nov."
 * each look as their readers expect, and the few words ("Today", "All day",
 * "From 22:00") from the app's string resources in that language. The class
 * itself touches no Android API, so the unit tests give it patterns and words
 * of their own.
 *
 * A day without a time (a header, an all-day item) is formatted at UTC
 * midnight in UTC, so no time zone or change of the clock can move it to
 * another date.
 */
final class Labels {
    /** The app's words, in its language. */
    static final class Words {
        final String today;
        final String tomorrow;
        final String allDay;
        /** "From %1$s": the first day of a timed event that goes on past midnight. */
        final String fromTime;
        /** "Until %1$s": the last day of one that began before. */
        final String untilTime;
        /** "%1$s – %2$s": a time range. */
        final String range;

        Words(String today, String tomorrow, String allDay, String fromTime, String untilTime, String range) {
            this.today = today;
            this.tomorrow = tomorrow;
            this.allDay = allDay;
            this.fromTime = fromTime;
            this.untilTime = untilTime;
            this.range = range;
        }
    }

    /** The patterns, as the system's best pattern for each skeleton in the language. */
    static final class Patterns {
        /** "Hm" or "hm": "09:00", "9:00 AM". */
        final String time;
        /** "EEEdMMM": "Wed, 12 Nov". */
        final String dayHeader;
        /** "dMMM": "12 Nov". */
        final String date;
        /** "dMMMy": "12 Nov 2027". */
        final String dateYear;
        /** "LLLLy": "November 2026". */
        final String monthYear;
        /** "dMMMM": "9 November". */
        final String longDate;

        Patterns(String time, String dayHeader, String date, String dateYear, String monthYear, String longDate) {
            this.time = time;
            this.dayHeader = dayHeader;
            this.date = date;
            this.dateYear = dateYear;
            this.monthYear = monthYear;
            this.longDate = longDate;
        }
    }

    final Locale locale;
    private final TimeZone zone;
    private final Words words;
    private final Patterns patterns;
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    Labels(Locale locale, TimeZone zone, Words words, Patterns patterns) {
        this.locale = locale;
        this.zone = zone;
        this.words = words;
        this.patterns = patterns;
    }

    private String format(String pattern, long millis, TimeZone in) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, locale);
        f.setTimeZone(in);
        return f.format(new Date(millis));
    }

    private String formatDay(String pattern, int day) {
        return format(pattern, Days.utcMillis(day), UTC);
    }

    /** The first letter in capitals: month and weekday names are lower case in several languages. */
    String capitalized(String text) {
        if (text == null || text.isEmpty()) return text;
        int first = text.codePointAt(0);
        int length = Character.charCount(first);
        return text.substring(0, length).toUpperCase(locale) + text.substring(length);
    }

    String time(long millis) {
        return format(patterns.time, millis, zone);
    }

    String range(long start, long end) {
        if (end <= start) return time(start);
        return String.format(locale, words.range, time(start), time(end));
    }

    String today() {
        return words.today;
    }

    String tomorrow() {
        return words.tomorrow;
    }

    String allDay() {
        return words.allDay;
    }

    /** A date, with the year only when it is not the year of {@code today}. */
    String date(int day, int today) {
        boolean sameYear = Days.year(day) == Days.year(today);
        return formatDay(sameYear ? patterns.date : patterns.dateYear, day);
    }

    /** A day header of the agenda: "Today", "Tomorrow", else "Wed, 12 Nov". */
    String dayHeader(int day, int today) {
        if (day == today) return words.today;
        if (day == today + 1) return words.tomorrow;
        return capitalized(formatDay(patterns.dayHeader, day));
    }

    /** The month's title: "November 2026". */
    String monthTitle(int firstOfMonth) {
        return capitalized(formatDay(patterns.monthYear, firstOfMonth));
    }

    /** "Monday". */
    String weekday(int day) {
        return capitalized(formatDay("EEEE", day));
    }

    /** "9 November". */
    String longDate(int day) {
        return formatDay(patterns.longDate, day);
    }

    /** "November", as a month is named on its own. */
    String monthName(int day) {
        return capitalized(formatDay("LLLL", day));
    }

    /** How an event's time reads on a day of the agenda: "09:00 – 10:00", "From 22:00", "Until 10:00", "All day". */
    String eventTime(Agenda.Item item) {
        Snapshot.Event e = item.event;
        switch (item.span) {
            case Agenda.SPAN_FROM:
                return String.format(locale, words.fromTime, time(e.start));
            case Agenda.SPAN_UNTIL:
                return String.format(locale, words.untilTime, time(e.end));
            case Agenda.SPAN_ALL_DAY:
                return words.allDay;
            default:
                return range(e.start, e.end);
        }
    }

    /**
     * The short time of an item in the Today widget's narrow column: the
     * start, "Until 10:00" for one that began before today, "All day"; a task
     * due today without a time has none.
     */
    String shortTime(Agenda.Item item) {
        if (item.task != null) return item.task.timed() ? time(item.task.due) : "";
        Snapshot.Event e = item.event;
        switch (item.span) {
            case Agenda.SPAN_UNTIL:
                return String.format(locale, words.untilTime, time(e.end));
            case Agenda.SPAN_ALL_DAY:
                return words.allDay;
            default:
                return time(e.start);
        }
    }

    /**
     * A task's label in the agenda: its time on its day, or for an overdue one
     * from an earlier day the day it was due; none for one due that day
     * without a time (the day header says it all).
     */
    String agendaTask(Agenda.Item item, int today) {
        Snapshot.Task t = item.task;
        int due = t.dueDay(zone);
        if (due < item.day) return date(due, today);
        return t.timed() ? time(t.due) : "";
    }

    /** A task's due label in the Tasks widget. */
    String due(TaskRows.Row row, int today) {
        switch (row.dueKind) {
            case TaskRows.DUE_TIME:
                return time(row.task.due);
            case TaskRows.DUE_TODAY:
                return words.today;
            case TaskRows.DUE_TOMORROW:
                return words.tomorrow;
            case TaskRows.DUE_DATE:
                return date(row.dueDay, today);
            default:
                return "";
        }
    }
}
