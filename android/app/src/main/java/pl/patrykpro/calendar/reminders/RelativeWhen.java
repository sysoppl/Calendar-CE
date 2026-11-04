package pl.patrykpro.calendar.reminders;

import android.content.Context;
import android.os.Build;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

import pl.patrykpro.calendar.R;

/**
 * The time of an item as a reminder words it at the moment it is shown, in
 * the device's language, time zone and clock (12 or 24 hours):
 * - today, tomorrow and yesterday by name: "Today at 18:00", "Jutro o godzinie 9:00";
 * - the rest of the coming week by the day's name: "Thursday at 18:00", "czwartek o godzinie 18:00";
 * - anything further by a short date, with the year when it is another one: "23 Oct at 18:00", "23 paź 2027".
 * An item of whole days gets the day alone.
 */
public final class RelativeWhen implements WhenFormat {
    /** The words around the day and the time, from the app's resources. */
    public static final class Words {
        final String today;
        final String tomorrow;
        final String yesterday;
        /** A day and a time of day: "%1$s at %2$s", "%1$s o godzinie %2$s". */
        final String dayAtTime;

        public Words(String today, String tomorrow, String yesterday, String dayAtTime) {
            this.today = today;
            this.tomorrow = tomorrow;
            this.yesterday = yesterday;
            this.dayAtTime = dayAtTime;
        }
    }

    /** Days ahead that are named by their weekday; a week ahead would be the same name as today. */
    private static final int WEEKDAY_NAMES_UP_TO = 6;

    private final Locale locale;
    private final TimeZone zone;
    private final Words words;
    private final String timePattern;
    private final String datePattern;
    private final String dateYearPattern;

    /**
     * @param timePattern     a time of day, e.g. "H:mm" or "h:mm a"
     * @param datePattern     a day of this year, e.g. "d MMM" or "MMM d"
     * @param dateYearPattern a day of another year, e.g. "d MMM y"
     */
    public RelativeWhen(Locale locale, TimeZone zone, Words words, String timePattern, String datePattern, String dateYearPattern) {
        this.locale = locale;
        this.zone = zone;
        this.words = words;
        this.timePattern = timePattern;
        this.datePattern = datePattern;
        this.dateYearPattern = dateYearPattern;
    }

    /** As the device has it now: its language, zone, clock and the app's words in its language. */
    public static RelativeWhen forDevice(Context context) {
        Locale locale = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            ? context.getResources().getConfiguration().getLocales().get(0)
            : Locale.getDefault();
        boolean clock24 = android.text.format.DateFormat.is24HourFormat(context);
        String time = unpadded(android.text.format.DateFormat.getBestDateTimePattern(locale, clock24 ? "Hm" : "hm"));
        String date = android.text.format.DateFormat.getBestDateTimePattern(locale, "dMMM");
        String dateYear = android.text.format.DateFormat.getBestDateTimePattern(locale, "dMMMy");
        Words words = new Words(
            context.getString(R.string.when_today),
            context.getString(R.string.when_tomorrow),
            context.getString(R.string.when_yesterday),
            context.getString(R.string.when_day_at_time));
        return new RelativeWhen(locale, TimeZone.getDefault(), words, time, date, dateYear);
    }

    /** A time pattern with the hour unpadded: "9:00" rather than "09:00", as one says it. */
    static String unpadded(String pattern) {
        return pattern.replace("HH", "H").replace("hh", "h").replace("kk", "k").replace("KK", "K");
    }

    private Calendar calendar(long millis) {
        Calendar c = new GregorianCalendar(zone, locale);
        c.setTimeInMillis(millis);
        return c;
    }

    /** Days from the day of {@code now} to the day of {@code start}, on this zone's calendar. */
    private long daysBetween(Calendar now, Calendar start) {
        return dayNumber(start) - dayNumber(now);
    }

    /** A count of days that grows by one each calendar day, whatever the length of the day (DST). */
    private static long dayNumber(Calendar c) {
        Calendar utc = new GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        utc.clear();
        utc.set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH));
        return Math.floorDiv(utc.getTimeInMillis(), 86400000L);
    }

    private String pattern(String pattern, long millis) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, locale);
        f.setTimeZone(zone);
        return f.format(new Date(millis));
    }

    /** The day of {@code start} as seen from {@code now}. */
    String day(long now, long start) {
        Calendar today = calendar(now);
        Calendar day = calendar(start);
        long days = daysBetween(today, day);
        if (days == 0) return words.today;
        if (days == 1) return words.tomorrow;
        if (days == -1) return words.yesterday;
        if (days > 1 && days <= WEEKDAY_NAMES_UP_TO) return pattern("EEEE", start);
        boolean sameYear = today.get(Calendar.YEAR) == day.get(Calendar.YEAR);
        return pattern(sameYear ? datePattern : dateYearPattern, start);
    }

    @Override
    public String format(long now, long start, boolean allDay) {
        String day = day(now, start);
        if (allDay) return day;
        return String.format(locale, words.dayAtTime, day, pattern(timePattern, start));
    }
}
