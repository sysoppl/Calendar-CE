package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NextRefreshTest {
    private static final long NOON = Snap.at(2026, 11, 9, 12, 0);
    private static final long MARGIN = NextRefresh.MARGIN_MS;

    @Test
    public void withNothingAheadTodayItIsTheComingMidnight() {
        Snapshot s = Snap.november()
            .timed("c", "tomorrow", "Tomorrow", Snap.at(2026, 11, 10, 9, 0), Snap.at(2026, 11, 10, 10, 0))
            .allDay("c", "day", "Whole day", "2026-11-09", "2026-11-10")
            .parse();
        assertEquals(Snap.at(2026, 11, 10, 0, 0) + MARGIN, NextRefresh.at(s, NOON, Snap.WARSAW));
        assertEquals(Snap.at(2026, 11, 10, 0, 0) + MARGIN, NextRefresh.at(null, NOON, Snap.WARSAW));
    }

    @Test
    public void theNextStartEndOrDueTimeComesFirst() {
        Snapshot s = Snap.november()
            .timed("c", "running", "Running", Snap.at(2026, 11, 9, 11, 0), Snap.at(2026, 11, 9, 15, 0))
            .timed("c", "next", "Next", Snap.at(2026, 11, 9, 14, 0), Snap.at(2026, 11, 9, 16, 0))
            .parse();
        assertEquals(Snap.at(2026, 11, 9, 14, 0) + MARGIN, NextRefresh.at(s, NOON, Snap.WARSAW));
        // The end of the running one, once the next has begun.
        assertEquals(Snap.at(2026, 11, 9, 15, 0) + MARGIN, NextRefresh.at(s, Snap.at(2026, 11, 9, 14, 30), Snap.WARSAW));
        Snapshot task = Snap.november().taskDue("c", "t", "Due", Snap.at(2026, 11, 9, 13, 0)).parse();
        assertEquals(Snap.at(2026, 11, 9, 13, 0) + MARGIN, NextRefresh.at(task, NOON, Snap.WARSAW));
    }

    @Test
    public void neverSoonerThanTheShortestGap() {
        Snapshot s = Snap.november().timed("c", "now", "Ends in a moment", NOON - 60_000L, NOON + 5_000L).parse();
        assertEquals(NOON + NextRefresh.MIN_GAP_MS, NextRefresh.at(s, NOON, Snap.WARSAW));
    }

    @Test
    public void midnightIsTheLocalOneOnDaysTheClockChanges() {
        // 29 March 2026 has 23 hours in Warsaw, 25 October 25: midnight is not 24 hours after the last one.
        long spring = Snap.at(2026, 3, 29, 12, 0);
        assertEquals(Snap.at(2026, 3, 30, 0, 0), NextRefresh.midnightAfter(spring, Snap.WARSAW));
        assertEquals(Snap.at(2026, 3, 29, 0, 0) + 23 * 3_600_000L, NextRefresh.midnightAfter(spring, Snap.WARSAW));
        long autumn = Snap.at(2026, 10, 25, 1, 0);
        assertEquals(Snap.at(2026, 10, 26, 0, 0), NextRefresh.midnightAfter(autumn, Snap.WARSAW));
        assertEquals(Snap.at(2026, 10, 25, 0, 0) + 25 * 3_600_000L, NextRefresh.midnightAfter(autumn, Snap.WARSAW));
        assertEquals(Snap.at(2026, 10, 26, 0, 0) + MARGIN, NextRefresh.at(null, autumn, Snap.WARSAW));
    }
}
