package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.TimeZone;

public class DaysTest {
    @Test
    public void readsAndWritesTheWebAppsDates() {
        assertEquals(0, Days.parse("1970-01-01"));
        assertEquals("1970-01-01", Days.format(0));
        for (String date : new String[] {"2026-11-09", "2024-02-29", "2000-02-29", "1999-12-31", "2027-03-08", "2100-03-01"}) {
            assertEquals(date, Days.format(Days.parse(date)));
        }
        assertEquals(Days.parse("2026-11-10"), Days.parse("2026-11-09") + 1);
        assertEquals(Days.parse("2027-01-01"), Days.parse("2026-12-31") + 1);
        assertEquals(Days.parse("2024-03-01"), Days.parse("2024-02-29") + 1);
    }

    @Test
    public void refusesWhatIsNotADate() {
        for (String text : new String[] {null, "", "2026-11-9", "2026/11/09", "2026-13-01", "2026-00-10", "2026-02-29",
            "2026-11-31", "2026-11-00", "1800-01-01", "2026-11-09T10:00", " 2026-11-09", "２０２６-11-09", "abcd-ef-gh"}) {
            assertEquals(String.valueOf(text), Days.NONE, Days.parse(text));
        }
    }

    @Test
    public void knowsTheWeekdays() {
        // 1970-01-01 was a Thursday; 9 November 2026 is a Monday.
        assertEquals(4, Days.weekday(0));
        assertEquals(1, Days.weekday(Days.parse("2026-11-09")));
        assertEquals(0, Days.weekday(Days.parse("2026-11-08")));
        assertEquals(6, Days.weekday(Days.parse("2026-11-14")));
        assertEquals(3, Days.weekday(Days.parse("1969-12-31")));
    }

    @Test
    public void movesByMonths() {
        int day = Days.parse("2026-11-09");
        assertEquals("2026-11-01", Days.format(Days.firstOfMonth(day)));
        assertEquals("2026-12-01", Days.format(Days.addMonths(day, 1)));
        assertEquals("2027-01-01", Days.format(Days.addMonths(day, 2)));
        assertEquals("2026-10-01", Days.format(Days.addMonths(day, -1)));
        assertEquals("2025-11-01", Days.format(Days.addMonths(day, -12)));
        assertEquals("2026-02-01", Days.format(Days.addMonths(Days.parse("2026-01-31"), 1)));
        assertEquals(2026, Days.year(day));
        assertEquals(11, Days.month(day));
        assertEquals(9, Days.dayOfMonth(day));
    }

    @Test
    public void findsTheLocalDayOfAnInstant() {
        // 23:30 in Warsaw on 9 November is 22:30 UTC: the 9th there, the 9th in UTC too; 00:30 is the 10th in Warsaw only.
        long late = Snap.at(2026, 11, 9, 23, 30);
        assertEquals(Days.parse("2026-11-09"), Days.dayOf(late, Snap.WARSAW));
        long afterMidnight = Snap.at(2026, 11, 10, 0, 30);
        assertEquals(Days.parse("2026-11-10"), Days.dayOf(afterMidnight, Snap.WARSAW));
        assertEquals(Days.parse("2026-11-09"), Days.dayOf(afterMidnight, Snap.UTC));
        assertEquals(Days.parse("1969-12-31"), Days.dayOf(-1, Snap.UTC));
    }

    @Test
    public void daysAroundTheChangesOfTheClockHaveTheirOwnLength() {
        // Summer time begins on 29 March 2026 in Warsaw (a day of 23 hours) and ends on 25 October (25 hours).
        int spring = Days.parse("2026-03-29");
        assertEquals(23 * 3_600_000L, Days.startOf(spring + 1, Snap.WARSAW) - Days.startOf(spring, Snap.WARSAW));
        int autumn = Days.parse("2026-10-25");
        assertEquals(25 * 3_600_000L, Days.startOf(autumn + 1, Snap.WARSAW) - Days.startOf(autumn, Snap.WARSAW));
        assertEquals(Snap.at(2026, 11, 9, 0, 0), Days.startOf(Days.parse("2026-11-09"), Snap.WARSAW));
    }

    @Test
    public void aSkippedMidnightStartsTheDayAfterTheGap() {
        // Until 2019, summer time in Sao Paulo began at midnight: 4 November 2018 had no 00:00.
        TimeZone saoPaulo = TimeZone.getTimeZone("America/Sao_Paulo");
        int day = Days.parse("2018-11-04");
        long start = Days.startOf(day, saoPaulo);
        assertEquals(day, Days.dayOf(start, saoPaulo));
        assertEquals(day - 1, Days.dayOf(start - 1, saoPaulo));
    }
}
