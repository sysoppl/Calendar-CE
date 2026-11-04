package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * How a reminder names the time of its item, worded at the moment the
 * notification is shown: "Dzisiaj o godzinie 18:00", "Jutro o godzinie 9:00",
 * "czwartek o godzinie 18:00", further away the short date.
 */
public class RelativeWhenTest {
    private static final TimeZone WARSAW = TimeZone.getTimeZone("Europe/Warsaw");
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");
    private static final Locale PL = Locale.forLanguageTag("pl-PL");

    /** The words of res/values-pl/strings_when.xml and res/values/strings_when.xml. */
    private static final RelativeWhen.Words POLISH = new RelativeWhen.Words("Dzisiaj", "Jutro", "Wczoraj", "%1$s o godzinie %2$s");
    private static final RelativeWhen.Words ENGLISH = new RelativeWhen.Words("Today", "Tomorrow", "Yesterday", "%1$s at %2$s");

    private static final RelativeWhen PL_24 = new RelativeWhen(PL, WARSAW, POLISH, "H:mm", "d MMM", "d MMM y");
    private static final RelativeWhen GB_24 = new RelativeWhen(Locale.UK, WARSAW, ENGLISH, "H:mm", "d MMM", "d MMM y");
    private static final RelativeWhen US_12 = new RelativeWhen(Locale.US, NEW_YORK, ENGLISH, "h:mm a", "MMM d", "MMM d, y");

    private static long at(TimeZone zone, int year, int month, int day, int hour, int minute) {
        Calendar c = new GregorianCalendar(zone, Locale.ROOT);
        c.clear();
        c.set(year, month - 1, day, hour, minute, 0);
        return c.getTimeInMillis();
    }

    /** Thursday 15 October 2026, 17:00 in Warsaw: when the reminder fired. */
    private static final long NOW = at(WARSAW, 2026, 10, 15, 17, 0);

    @Test
    public void namesTodayTomorrowAndYesterday() {
        assertEquals("Dzisiaj o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 15, 18, 0), false));
        assertEquals("Jutro o godzinie 9:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 16, 9, 0), false));
        assertEquals("Wczoraj o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 14, 18, 0), false));
        assertEquals("Today at 18:00", GB_24.format(NOW, at(WARSAW, 2026, 10, 15, 18, 0), false));
        assertEquals("Tomorrow at 9:00", GB_24.format(NOW, at(WARSAW, 2026, 10, 16, 9, 0), false));
        assertEquals("Yesterday at 18:00", GB_24.format(NOW, at(WARSAW, 2026, 10, 14, 18, 0), false));
        // Earlier today is still today: a reminder shown late says so.
        assertEquals("Dzisiaj o godzinie 0:30", PL_24.format(NOW, at(WARSAW, 2026, 10, 15, 0, 30), false));
    }

    @Test
    public void namesTheRestOfTheComingWeekByItsDays() {
        assertEquals("sobota o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 17, 18, 0), false));
        assertEquals("poniedziałek o godzinie 8:15", PL_24.format(NOW, at(WARSAW, 2026, 10, 19, 8, 15), false));
        assertEquals("środa o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 21, 18, 0), false));
        assertEquals("Saturday at 18:00", GB_24.format(NOW, at(WARSAW, 2026, 10, 17, 18, 0), false));
        // A week ahead would share today's name: it gets its date.
        assertEquals("22 paź o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 22, 18, 0), false));
        assertEquals("22 Oct at 18:00", GB_24.format(NOW, at(WARSAW, 2026, 10, 22, 18, 0), false));
    }

    @Test
    public void givesTheDateFurtherAwayWithTheYearWhenItIsAnother() {
        assertEquals("13 paź o godzinie 18:00", PL_24.format(NOW, at(WARSAW, 2026, 10, 13, 18, 0), false));
        assertEquals("5 sty 2027 o godzinie 9:00", PL_24.format(NOW, at(WARSAW, 2027, 1, 5, 9, 0), false));
        assertEquals("5 Jan 2027", GB_24.format(NOW, at(WARSAW, 2027, 1, 5, 0, 0), true));
    }

    @Test
    public void namesTheDayAloneForAnItemOfWholeDays() {
        assertEquals("Dzisiaj", PL_24.format(NOW, at(WARSAW, 2026, 10, 15, 0, 0), true));
        assertEquals("Jutro", PL_24.format(NOW, at(WARSAW, 2026, 10, 16, 0, 0), true));
        assertEquals("poniedziałek", PL_24.format(NOW, at(WARSAW, 2026, 10, 19, 0, 0), true));
        assertEquals("30 paź", PL_24.format(NOW, at(WARSAW, 2026, 10, 30, 0, 0), true));
        assertEquals("Tomorrow", GB_24.format(NOW, at(WARSAW, 2026, 10, 16, 0, 0), true));
    }

    @Test
    public void followsTheClockAndTheOrderOfTheLanguage() {
        long now = at(NEW_YORK, 2026, 10, 15, 8, 0);
        assertEquals("Today at 6:00 PM", US_12.format(now, at(NEW_YORK, 2026, 10, 15, 18, 0), false));
        assertEquals("Tomorrow at 9:05 AM", US_12.format(now, at(NEW_YORK, 2026, 10, 16, 9, 5), false));
        assertEquals("Oct 30 at 9:00 AM", US_12.format(now, at(NEW_YORK, 2026, 10, 30, 9, 0), false));
    }

    @Test
    public void countsCalendarDaysAcrossMidnightAndTheChangeOfTime() {
        // A minute to midnight, an event a few minutes after: tomorrow.
        long late = at(WARSAW, 2026, 10, 15, 23, 59);
        assertEquals("Jutro o godzinie 0:01", PL_24.format(late, at(WARSAW, 2026, 10, 16, 0, 1), false));
        // The clocks go back in the night to 25 October: that day has 25 hours, still one day.
        long saturday = at(WARSAW, 2026, 10, 24, 23, 30);
        assertEquals("Jutro o godzinie 23:00", PL_24.format(saturday, at(WARSAW, 2026, 10, 25, 23, 0), false));
        assertEquals("poniedziałek o godzinie 0:30", PL_24.format(saturday, at(WARSAW, 2026, 10, 26, 0, 30), false));
        // The days are the device's: in New York the same instant is still the evening before.
        assertEquals("Today at 7:00 PM", US_12.format(at(NEW_YORK, 2026, 10, 15, 8, 0), at(WARSAW, 2026, 10, 16, 1, 0), false));
    }

    @Test
    public void saysTheHourAsOneSaysIt() {
        assertEquals("H:mm", RelativeWhen.unpadded("HH:mm"));
        assertEquals("H.mm", RelativeWhen.unpadded("HH.mm"));
        assertEquals("h:mm a", RelativeWhen.unpadded("hh:mm a"));
        assertEquals("h:mm a", RelativeWhen.unpadded("h:mm a"));
    }
}
