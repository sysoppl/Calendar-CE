package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class AgendaTest {
    private static final int NINTH = Days.parse("2026-11-09");
    /** Monday 9 November 2026, 12:00 in Warsaw. */
    private static final long NOON = Snap.at(2026, 11, 9, 12, 0);

    private static WidgetOptions days(int days) {
        WidgetOptions o = new WidgetOptions();
        o.days = days;
        return o;
    }

    /** The rows as short strings: "H 2026-11-09", "E key span", "T key [overdue]", "N". */
    private static List<String> shape(Agenda.Result result) {
        List<String> out = new ArrayList<>();
        for (Agenda.Row row : result.rows) {
            switch (row.type) {
                case Agenda.HEADER:
                    out.add("H " + Days.format(row.day));
                    break;
                case Agenda.EVENT:
                    out.add("E " + row.item.key() + " " + row.item.span);
                    break;
                case Agenda.TASK:
                    out.add("T " + row.item.key() + (row.item.overdue ? " overdue" : ""));
                    break;
                default:
                    out.add("N");
            }
        }
        return out;
    }

    private static List<String> list(String... rows) {
        List<String> out = new ArrayList<>();
        for (String row : rows) out.add(row);
        return out;
    }

    @Test
    public void groupsTheComingDaysAndNamesOnlyThoseWithSomething() {
        Snapshot s = Snap.november()
            .timed("c", "later", "Later today", Snap.at(2026, 11, 9, 15, 0), Snap.at(2026, 11, 9, 16, 0))
            .timed("c", "soon", "Soon", Snap.at(2026, 11, 9, 13, 0), Snap.at(2026, 11, 9, 14, 0))
            .allDay("c", "day", "Whole day", "2026-11-09", "2026-11-10")
            .timed("c", "thu", "Thursday", Snap.at(2026, 11, 12, 9, 0), Snap.at(2026, 11, 12, 10, 0))
            .timed("c", "far", "Too far", Snap.at(2026, 11, 20, 9, 0), Snap.at(2026, 11, 20, 10, 0))
            .parse();
        Agenda.Result r = Agenda.build(s, days(7), NOON, Snap.WARSAW);
        assertEquals(list("H 2026-11-09", "E day 3", "E soon 0", "E later 0", "H 2026-11-12", "E thu 0"), shape(r));
        assertFalse(r.cut);
        assertTrue(r.anything);
    }

    @Test
    public void leavesOutWhatIsOverToday() {
        Snapshot s = Snap.november()
            .timed("c", "morning", "Over", Snap.at(2026, 11, 9, 8, 0), Snap.at(2026, 11, 9, 9, 0))
            .timed("c", "endsNow", "Ends now", Snap.at(2026, 11, 9, 11, 0), NOON)
            .timed("c", "running", "Still on", Snap.at(2026, 11, 9, 11, 0), Snap.at(2026, 11, 9, 13, 0))
            .timed("c", "point", "Was at 11", Snap.at(2026, 11, 9, 11, 0), Snap.at(2026, 11, 9, 11, 0))
            .timed("c", "pointLater", "At 18", Snap.at(2026, 11, 9, 18, 0), Snap.at(2026, 11, 9, 18, 0))
            .parse();
        assertEquals(list("H 2026-11-09", "E running 0", "E pointLater 0"), shape(Agenda.build(s, days(1), NOON, Snap.WARSAW)));
        // Yesterday's morning event of tomorrow would not be over: only today is checked.
        Snapshot t = Snap.november().timed("c", "tomorrowMorning", "x", Snap.at(2026, 11, 10, 8, 0), Snap.at(2026, 11, 10, 9, 0)).parse();
        assertEquals(list("H 2026-11-10", "E tomorrowMorning 0"), shape(Agenda.build(t, days(3), NOON, Snap.WARSAW)));
    }

    @Test
    public void aLongAllDayEventIsOnEveryOneOfItsDays() {
        Snapshot s = Snap.november().allDay("c", "trip", "Trip", "2026-11-08", "2026-11-11").parse();
        // From the 8th to the 10th: today (the 9th) and tomorrow; the day it began is past.
        assertEquals(list("H 2026-11-09", "E trip 3", "H 2026-11-10", "E trip 3"), shape(Agenda.build(s, days(7), NOON, Snap.WARSAW)));
    }

    @Test
    public void anOvernightEventReadsFromAndUntil() {
        Snapshot s = Snap.november()
            .timed("c", "night", "Night shift", Snap.at(2026, 11, 9, 22, 0), Snap.at(2026, 11, 10, 6, 0))
            .timed("c", "conference", "Three days", Snap.at(2026, 11, 10, 18, 0), Snap.at(2026, 11, 12, 12, 0))
            .timed("c", "toMidnight", "Ends at midnight", Snap.at(2026, 11, 9, 20, 0), Snap.at(2026, 11, 10, 0, 0))
            .parse();
        Agenda.Result r = Agenda.build(s, days(7), NOON, Snap.WARSAW);
        assertEquals(list(
            "H 2026-11-09", "E toMidnight 0", "E night 1",
            "H 2026-11-10", "E night 2", "E conference 1",
            "H 2026-11-11", "E conference 3",
            "H 2026-11-12", "E conference 2"), shape(r));
    }

    @Test
    public void theLastPartOfAnOvernightEventEndsToday() {
        // At 07:00 the night that ended at 06:00 is over; at 05:00 it is still on, "Until 06:00".
        Snapshot s = Snap.november().timed("c", "night", "Night", Snap.at(2026, 11, 8, 22, 0), Snap.at(2026, 11, 9, 6, 0)).parse();
        assertTrue(Agenda.build(s, days(1), Snap.at(2026, 11, 9, 7, 0), Snap.WARSAW).rows.isEmpty());
        assertEquals(list("H 2026-11-09", "E night 2"), shape(Agenda.build(s, days(1), Snap.at(2026, 11, 9, 5, 0), Snap.WARSAW)));
    }

    @Test
    public void tasksJoinTheirDaysAndOverdueOnesComeFirstToday() {
        Snapshot s = Snap.november()
            .timed("c", "meeting", "Meeting", Snap.at(2026, 11, 9, 14, 0), Snap.at(2026, 11, 9, 15, 0))
            .allDay("c", "holiday", "Holiday", "2026-11-09", "2026-11-10")
            .taskDue("c", "due13", "Due at 13", Snap.at(2026, 11, 9, 13, 0))
            .taskDue("c", "due10", "Was due at 10", Snap.at(2026, 11, 9, 10, 0))
            .taskOn("c", "today", "Some time today", "2026-11-09")
            .taskOn("c", "lastWeek", "From last week", "2026-11-02")
            .taskDue("c", "yesterday", "From yesterday", Snap.at(2026, 11, 8, 18, 0))
            .taskOn("c", "wednesday", "Wednesday", "2026-11-11")
            .taskUndated("c", "someday", "Someday")
            .parse();
        Agenda.Result r = Agenda.build(s, days(7), NOON, Snap.WARSAW);
        assertEquals(list(
            "H 2026-11-09",
            "T lastWeek overdue", "T yesterday overdue",
            "E holiday 3", "T today",
            "T due10 overdue", "T due13", "E meeting 0",
            "H 2026-11-11", "T wednesday"), shape(r));

        WidgetOptions noTasks = days(7);
        noTasks.tasks = false;
        assertEquals(list("H 2026-11-09", "E holiday 3", "E meeting 0"), shape(Agenda.build(s, noTasks, NOON, Snap.WARSAW)));
    }

    @Test
    public void neverClaimsDaysOutsideTheSnapshot() {
        // The snapshot ends on the 12th (exclusive): a week from the 9th shows the 9th to the 11th, then the note.
        Snapshot s = new Snap("2026-11-01", "2026-11-12")
            .timed("c", "wed", "Wednesday", Snap.at(2026, 11, 11, 9, 0), Snap.at(2026, 11, 11, 10, 0))
            .allDay("c", "long", "Long", "2026-11-11", "2026-11-20")
            .parse();
        Agenda.Result r = Agenda.build(s, days(7), NOON, Snap.WARSAW);
        assertEquals(list("H 2026-11-11", "E long 3", "E wed 0", "N"), shape(r));
        assertTrue(r.cut);
        assertNull(r.rows.get(r.rows.size() - 1).item);

        // Today past the window: nothing is known, only the note.
        Agenda.Result stale = Agenda.build(s, days(3), Snap.at(2026, 11, 13, 12, 0), Snap.WARSAW);
        assertEquals(list("N"), shape(stale));
        assertFalse(stale.anything);

        // A window that begins after today (the clock was put back) is cut too.
        Agenda.Result early = Agenda.build(s, days(3), Snap.at(2026, 10, 31, 12, 0), Snap.WARSAW);
        assertTrue(early.cut);

        // A window that holds all the days is not.
        assertFalse(Agenda.build(s, days(3), NOON, Snap.WARSAW).cut);
    }

    @Test
    public void showsOnlyTheCalendarsItIsSetTo() {
        Snap snap = Snap.november()
            .calendar("work", "Work", "#1d6cd6", true, true, true)
            .calendar("hidden", "Hidden", "#1b8037", true, true, false)
            .timed("work", "w", "Work", Snap.at(2026, 11, 9, 13, 0), Snap.at(2026, 11, 9, 14, 0))
            .timed("hidden", "h", "Hidden", Snap.at(2026, 11, 9, 14, 0), Snap.at(2026, 11, 9, 15, 0))
            .timed("unknown", "u", "Unknown calendar", Snap.at(2026, 11, 9, 15, 0), Snap.at(2026, 11, 9, 16, 0))
            .taskDue("hidden", "ht", "Hidden task", Snap.at(2026, 11, 9, 17, 0));
        Snapshot s = snap.parse();
        WidgetOptions app = days(1);
        assertEquals(list("H 2026-11-09", "E w 0", "E u 0"), shape(Agenda.build(s, app, NOON, Snap.WARSAW)));
        WidgetOptions all = days(1);
        all.calendars = WidgetOptions.CALENDARS_ALL;
        assertEquals(list("H 2026-11-09", "E w 0", "E h 0", "E u 0", "T ht"), shape(Agenda.build(s, all, NOON, Snap.WARSAW)));
        WidgetOptions chosen = days(1);
        chosen.calendars = WidgetOptions.CALENDARS_CHOSEN;
        chosen.chosen.add("hidden");
        assertEquals(list("H 2026-11-09", "E h 0", "T ht"), shape(Agenda.build(s, chosen, NOON, Snap.WARSAW)));
    }

    @Test
    public void reachesAsFarAsTheChosenDays() {
        Snap snap = Snap.november();
        for (int d = 0; d < 40; d++) {
            long start = Days.startOf(NINTH + d, Snap.WARSAW) + 18 * 3_600_000L;
            snap.timed("c", "e" + d, "Evening " + d, start, start + 3_600_000L);
        }
        Snapshot s = snap.parse();
        for (int days : WidgetOptions.DAY_CHOICES) {
            Agenda.Result r = Agenda.build(s, days(days), NOON, Snap.WARSAW);
            assertEquals(days * 2, r.rows.size());
            assertEquals(NINTH + days - 1, r.rows.get(r.rows.size() - 1).day);
        }
    }

    @Test
    public void stopsAtTheRowLimit() {
        Snap snap = Snap.november();
        long start = Snap.at(2026, 11, 10, 9, 0);
        for (int i = 0; i < Agenda.MAX_ROWS + 100; i++) snap.timed("c", "e" + i, "E", start, start + 60_000L);
        Agenda.Result r = Agenda.build(snap.parse(), days(7), NOON, Snap.WARSAW);
        assertEquals(Agenda.MAX_ROWS, r.rows.size());
        assertEquals(Agenda.HEADER, r.rows.get(0).type);
    }

    @Test
    public void rowsKeepTheirIdsAcrossRefreshes() {
        Snapshot s = Snap.november().timed("c", "k", "A", Snap.at(2026, 11, 10, 9, 0), Snap.at(2026, 11, 10, 10, 0)).parse();
        Agenda.Result a = Agenda.build(s, days(7), NOON, Snap.WARSAW);
        Agenda.Result b = Agenda.build(s, days(7), NOON + 60_000L, Snap.WARSAW);
        assertEquals(a.rows.get(1).stableId(), b.rows.get(1).stableId());
        assertFalse(a.rows.get(0).stableId() == a.rows.get(1).stableId());
    }
}
