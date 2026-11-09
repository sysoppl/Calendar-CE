package pl.patrykpro.calendar.widgets;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TimeZone;

/**
 * The Month widget's page: six weeks of seven days around one month, starting
 * on the app's first day of the week, each day with a dot per event (up to
 * three) in the event's colour.
 *
 * Six rows always, so the widget does not change its height from month to
 * month; days of the months before and after fill the first and last rows
 * and are drawn dimmed. Today is marked.
 *
 * The arrows move a month at a time, but only to months whose whole page lies
 * inside the snapshot's window: a page with days the widget knows nothing
 * about would show them as free. The current month is always allowed (it is
 * where the widget comes back to every day), and a day the snapshot does not
 * cover gets no dots, which {@link #cut} flags so that the widget can ask for
 * the app to be opened.
 */
final class MonthGrid {
    static final int WEEKS = 6;
    static final int CELLS = WEEKS * 7;
    static final int MAX_DOTS = 3;

    static final class Cell {
        final int day;
        final int dayOfMonth;
        final boolean inMonth;
        final boolean today;
        /** The colours of the day's first events, at most {@link #MAX_DOTS}. */
        final int[] dots;

        Cell(int day, boolean inMonth, boolean today, int[] dots) {
            this.day = day;
            this.dayOfMonth = Days.dayOfMonth(day);
            this.inMonth = inMonth;
            this.today = today;
            this.dots = dots;
        }
    }

    /** The first day of the month shown. */
    final int month;
    /** How many months from the current one it is. */
    final int offset;
    final Cell[] cells;
    final boolean canPrev;
    final boolean canNext;
    /** Whether a day of the page lies outside the snapshot's window. */
    final boolean cut;

    private MonthGrid(int month, int offset, Cell[] cells, boolean canPrev, boolean canNext, boolean cut) {
        this.month = month;
        this.offset = offset;
        this.cells = cells;
        this.canPrev = canPrev;
        this.canNext = canNext;
        this.cut = cut;
    }

    /** The first day on the page of the month that begins on {@code firstOfMonth}. */
    static int gridStart(int firstOfMonth, int weekStart) {
        return firstOfMonth - Math.floorMod(Days.weekday(firstOfMonth) - weekStart, 7);
    }

    /** Whether the whole page of the month {@code offset} months from today's lies in [{@code from}, {@code until}). */
    static boolean allowed(int today, int offset, int weekStart, int from, int until) {
        if (offset == 0) return true;
        int start = gridStart(Days.addMonths(today, offset), weekStart);
        return start >= from && start + CELLS <= until;
    }

    /**
     * The offset a widget may show: {@code wanted} if its page is allowed, else
     * the current month's. An offset kept from before a new snapshot may point
     * past the new window.
     */
    static int clamp(int today, int wanted, int weekStart, int from, int until) {
        return allowed(today, wanted, weekStart, from, until) ? wanted : 0;
    }

    static MonthGrid build(Snapshot snapshot, WidgetOptions options, int today, int wantedOffset, TimeZone zone) {
        int weekStart = snapshot.weekStart;
        int offset = clamp(today, wantedOffset, weekStart, snapshot.from, snapshot.until);
        int first = Days.addMonths(today, offset);
        int start = gridStart(first, weekStart);
        int monthNumber = Days.month(first);

        // The page's events, day by day: all-day ones first, then by start, as in the agenda.
        List<List<Snapshot.Event>> perDay = new ArrayList<>(CELLS);
        for (int i = 0; i < CELLS; i++) perDay.add(new ArrayList<>());
        for (Snapshot.Event e : snapshot.events) {
            if (!options.shows(e.cal, snapshot)) continue;
            int a = Math.max(e.firstDay(zone), start);
            int b = Math.min(e.lastDay(zone), start + CELLS - 1);
            for (int day = a; day <= b; day++) {
                if (snapshot.covers(day)) perDay.get(day - start).add(e);
            }
        }
        Comparator<Snapshot.Event> order = (x, y) -> {
            if (x.allDay != y.allDay) return x.allDay ? -1 : 1;
            if (!x.allDay && x.start != y.start) return Long.compare(x.start, y.start);
            return Integer.compare(x.index, y.index);
        };
        Cell[] cells = new Cell[CELLS];
        boolean cut = false;
        for (int i = 0; i < CELLS; i++) {
            int day = start + i;
            if (!snapshot.covers(day)) cut = true;
            List<Snapshot.Event> events = perDay.get(i);
            Collections.sort(events, order);
            int[] dots = new int[Math.min(MAX_DOTS, events.size())];
            for (int d = 0; d < dots.length; d++) dots[d] = events.get(d).color;
            cells[i] = new Cell(day, Days.month(day) == monthNumber, day == today, dots);
        }
        boolean canPrev = allowed(today, offset - 1, weekStart, snapshot.from, snapshot.until);
        boolean canNext = allowed(today, offset + 1, weekStart, snapshot.from, snapshot.until);
        return new MonthGrid(first, offset, cells, canPrev, canNext, cut);
    }
}
