package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MonthGridTest {
    private static final int NINTH = Days.parse("2026-11-09");

    @Test
    public void startsTheWeekOnTheAppsDay() {
        int first = Days.parse("2026-11-01"); // a Sunday
        assertEquals("2026-10-26", Days.format(MonthGrid.gridStart(first, 1)));
        assertEquals("2026-11-01", Days.format(MonthGrid.gridStart(first, 0)));
        assertEquals("2026-10-31", Days.format(MonthGrid.gridStart(first, 6)));
        int march = Days.parse("2027-03-01"); // a Monday
        assertEquals("2027-03-01", Days.format(MonthGrid.gridStart(march, 1)));
        assertEquals("2027-02-28", Days.format(MonthGrid.gridStart(march, 0)));
        assertEquals("2027-02-27", Days.format(MonthGrid.gridStart(march, 6)));
    }

    @Test
    public void hasSixWeeksWithTheMonthAndTodayMarked() {
        for (int weekStart : new int[] {0, 1, 6}) {
            Snapshot s = Snap.november().put("weekStart", weekStart).parse();
            MonthGrid g = MonthGrid.build(s, new WidgetOptions(), NINTH, 0, Snap.WARSAW);
            assertEquals(42, g.cells.length);
            assertEquals(weekStart, Days.weekday(g.cells[0].day));
            int inMonth = 0;
            int today = 0;
            for (int i = 0; i < 42; i++) {
                MonthGrid.Cell c = g.cells[i];
                if (i > 0) assertEquals(g.cells[i - 1].day + 1, c.day);
                if (c.inMonth) inMonth++;
                if (c.today) {
                    today++;
                    assertEquals(NINTH, c.day);
                    assertEquals(9, c.dayOfMonth);
                }
                assertEquals(Days.month(c.day) == 11, c.inMonth);
            }
            assertEquals(30, inMonth);
            assertEquals(1, today);
            assertEquals("2026-11-01", Days.format(g.month));
            assertFalse(g.cut);
        }
    }

    @Test
    public void marksTheDaysWithUpToThreeDotsInTheirEventsColours() throws Exception {
        Snap snap = Snap.november();
        snap.events.put(new org.json.JSONObject().put("cal", "c").put("key", "late").put("color", "#000003")
            .put("start", Snap.at(2026, 11, 12, 18, 0)).put("end", Snap.at(2026, 11, 12, 19, 0)));
        snap.events.put(new org.json.JSONObject().put("cal", "c").put("key", "early").put("color", "#000002")
            .put("start", Snap.at(2026, 11, 12, 8, 0)).put("end", Snap.at(2026, 11, 12, 9, 0)));
        snap.events.put(new org.json.JSONObject().put("cal", "c").put("key", "allday").put("color", "#000001")
            .put("allDay", true).put("day", "2026-11-12").put("endDay", "2026-11-14"));
        snap.events.put(new org.json.JSONObject().put("cal", "c").put("key", "fourth").put("color", "#000004")
            .put("start", Snap.at(2026, 11, 12, 20, 0)).put("end", Snap.at(2026, 11, 12, 21, 0)));
        Snapshot s = snap.parse();
        MonthGrid g = MonthGrid.build(s, new WidgetOptions(), NINTH, 0, Snap.WARSAW);
        MonthGrid.Cell twelfth = cellOf(g, Days.parse("2026-11-12"));
        assertArrayEquals(new int[] {0xFF000001, 0xFF000002, 0xFF000003}, twelfth.dots);
        assertArrayEquals(new int[] {0xFF000001}, cellOf(g, Days.parse("2026-11-13")).dots);
        assertEquals(0, cellOf(g, Days.parse("2026-11-14")).dots.length);
    }

    @Test
    public void leavesOutHiddenCalendars() {
        Snapshot s = Snap.november()
            .calendar("hidden", "Hidden", "#1b8037", true, true, false)
            .timed("hidden", "h", "Hidden", Snap.at(2026, 11, 12, 9, 0), Snap.at(2026, 11, 12, 10, 0))
            .parse();
        assertEquals(0, cellOf(MonthGrid.build(s, new WidgetOptions(), NINTH, 0, Snap.WARSAW), Days.parse("2026-11-12")).dots.length);
        WidgetOptions all = new WidgetOptions();
        all.calendars = WidgetOptions.CALENDARS_ALL;
        assertEquals(1, cellOf(MonthGrid.build(s, all, NINTH, 0, Snap.WARSAW), Days.parse("2026-11-12")).dots.length);
    }

    @Test
    public void movesOnlyToMonthsTheSnapshotHoldsWhole() {
        // 2026-09-28 .. 2027-03-08, weeks from Monday: October's page starts on 28 September.
        Snapshot s = Snap.november().parse();
        int from = s.from;
        int until = s.until;
        assertTrue(MonthGrid.allowed(NINTH, -1, 1, from, until));
        assertFalse(MonthGrid.allowed(NINTH, -2, 1, from, until));
        // January 2027's page runs to 7 February; February's (from Monday 1 February) to 14 March, past the window.
        assertTrue(MonthGrid.allowed(NINTH, 2, 1, from, until));
        assertFalse(MonthGrid.allowed(NINTH, 3, 1, from, until));

        MonthGrid october = MonthGrid.build(s, new WidgetOptions(), NINTH, -1, Snap.WARSAW);
        assertEquals("2026-10-01", Days.format(october.month));
        assertFalse(october.canPrev);
        assertTrue(october.canNext);
        MonthGrid january = MonthGrid.build(s, new WidgetOptions(), NINTH, 2, Snap.WARSAW);
        assertEquals("2027-01-01", Days.format(january.month));
        assertTrue(january.canPrev);
        assertFalse(january.canNext);
        // An offset kept from an older snapshot that points too far falls back to the current month.
        MonthGrid tooFar = MonthGrid.build(s, new WidgetOptions(), NINTH, 7, Snap.WARSAW);
        assertEquals(0, tooFar.offset);
        assertEquals("2026-11-01", Days.format(tooFar.month));
        assertEquals(0, MonthGrid.clamp(NINTH, -5, 1, from, until));
        assertEquals(2, MonthGrid.clamp(NINTH, 2, 1, from, until));
    }

    @Test
    public void theCurrentMonthIsAlwaysShownAndSaysWhatItDoesNotKnow() {
        // A snapshot that begins on the 5th: the first days of the page are unknown.
        Snapshot s = new Snap("2026-11-05", "2026-12-20")
            .allDay("c", "early", "Early", "2026-11-02", "2026-11-03")
            .allDay("c", "known", "Known", "2026-11-06", "2026-11-07")
            .parse();
        MonthGrid g = MonthGrid.build(s, new WidgetOptions(), NINTH, 0, Snap.WARSAW);
        assertEquals("2026-11-01", Days.format(g.month));
        assertTrue(g.cut);
        assertFalse(g.canPrev);
        assertFalse(g.canNext);
        assertEquals(0, cellOf(g, Days.parse("2026-11-02")).dots.length);
        assertEquals(1, cellOf(g, Days.parse("2026-11-06")).dots.length);
    }

    @Test
    public void weekStartsOnSundayAndSaturdayMoveTheLimitsToo() {
        Snapshot sunday = Snap.november().put("weekStart", 0).parse();
        // From Sunday, October's page starts on 27 September, which the snapshot does not hold.
        assertFalse(MonthGrid.allowed(NINTH, -1, 0, sunday.from, sunday.until));
        Snapshot saturday = Snap.november().put("weekStart", 6).parse();
        assertFalse(MonthGrid.allowed(NINTH, -1, 6, saturday.from, saturday.until));
        assertFalse(MonthGrid.build(saturday, new WidgetOptions(), NINTH, 0, Snap.WARSAW).canPrev);
    }

    private static MonthGrid.Cell cellOf(MonthGrid g, int day) {
        for (MonthGrid.Cell c : g.cells) {
            if (c.day == day) return c;
        }
        throw new AssertionError("not on the page: " + Days.format(day));
    }
}
