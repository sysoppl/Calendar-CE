package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TodayPickTest {
    private static final long NOON = Snap.at(2026, 11, 9, 12, 0);

    @Test
    public void showsTheFirstItemsThatAreNotOver() {
        Snapshot s = Snap.november()
            .timed("c", "over", "Over", Snap.at(2026, 11, 9, 9, 0), Snap.at(2026, 11, 9, 10, 0))
            .timed("c", "now", "Running", Snap.at(2026, 11, 9, 11, 30), Snap.at(2026, 11, 9, 12, 30))
            .timed("c", "a", "A", Snap.at(2026, 11, 9, 14, 0), Snap.at(2026, 11, 9, 15, 0))
            .timed("c", "b", "B", Snap.at(2026, 11, 9, 16, 0), Snap.at(2026, 11, 9, 17, 0))
            .timed("c", "c", "C", Snap.at(2026, 11, 9, 18, 0), Snap.at(2026, 11, 9, 19, 0))
            .allDay("c", "day", "Whole day", "2026-11-09", "2026-11-10")
            .parse();
        TodayPick p = TodayPick.pick(s, new WidgetOptions(), NOON, Snap.WARSAW, 3);
        assertEquals(3, p.today.size());
        assertEquals("day", p.today.get(0).key());
        assertEquals("now", p.today.get(1).key());
        assertEquals("a", p.today.get(2).key());
        assertEquals(2, p.more);
        assertNull(p.tomorrow);
        assertTrue(p.covered);
        assertFalse(p.cut);
    }

    @Test
    public void showsAsManyRowsAsTheWidgetHasRoomFor() {
        assertEquals(TodayPick.DEFAULT_ROWS, TodayPick.rowsFor(0));
        assertEquals(1, TodayPick.rowsFor(80));
        assertEquals(1, TodayPick.rowsFor(110));
        assertEquals(3, TodayPick.rowsFor(146));
        assertEquals(5, TodayPick.rowsFor(224));
        assertEquals(TodayPick.ROWS, TodayPick.rowsFor(600));
    }

    @Test
    public void tasksDueTodayAreIncludedButNotOverdueOnes() {
        Snapshot s = Snap.november()
            .taskOn("c", "today", "Today", "2026-11-09")
            .taskOn("c", "old", "Last week", "2026-11-02")
            .taskDue("c", "at15", "At 15", Snap.at(2026, 11, 9, 15, 0))
            .parse();
        TodayPick p = TodayPick.pick(s, new WidgetOptions(), NOON, Snap.WARSAW, TodayPick.ROWS);
        assertEquals(2, p.today.size());
        assertEquals("today", p.today.get(0).key());
        assertEquals("at15", p.today.get(1).key());
        WidgetOptions noTasks = new WidgetOptions();
        noTasks.tasks = false;
        assertTrue(TodayPick.pick(s, noTasks, NOON, Snap.WARSAW, TodayPick.ROWS).today.isEmpty());
    }

    @Test
    public void withNothingLeftTodayItNamesTomorrowsFirstItem() {
        Snapshot s = Snap.november()
            .timed("c", "over", "Over", Snap.at(2026, 11, 9, 9, 0), Snap.at(2026, 11, 9, 10, 0))
            .timed("c", "late", "Late tomorrow", Snap.at(2026, 11, 10, 20, 0), Snap.at(2026, 11, 10, 21, 0))
            .timed("c", "early", "Dentist", Snap.at(2026, 11, 10, 9, 0), Snap.at(2026, 11, 10, 10, 0))
            .parse();
        TodayPick p = TodayPick.pick(s, new WidgetOptions(), NOON, Snap.WARSAW, TodayPick.ROWS);
        assertTrue(p.today.isEmpty());
        assertEquals("early", p.tomorrow.key());
        assertFalse(p.cut);

        Snapshot empty = Snap.november().parse();
        TodayPick none = TodayPick.pick(empty, new WidgetOptions(), NOON, Snap.WARSAW, TodayPick.ROWS);
        assertTrue(none.today.isEmpty());
        assertNull(none.tomorrow);
        assertTrue(none.covered);
    }

    @Test
    public void saysWhenItDoesNotKnow() {
        // The window ends today: tomorrow is unknown, and only matters when today is empty.
        Snapshot s = new Snap("2026-11-01", "2026-11-10").parse();
        TodayPick p = TodayPick.pick(s, new WidgetOptions(), NOON, Snap.WARSAW, TodayPick.ROWS);
        assertTrue(p.covered);
        assertTrue(p.cut);
        assertNull(p.tomorrow);
        // Past the window: nothing about today is known.
        TodayPick stale = TodayPick.pick(s, new WidgetOptions(), Snap.at(2026, 11, 12, 12, 0), Snap.WARSAW, TodayPick.ROWS);
        assertFalse(stale.covered);
        assertTrue(stale.cut);
        assertTrue(stale.today.isEmpty());
    }
}
