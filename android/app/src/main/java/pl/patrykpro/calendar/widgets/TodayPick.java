package pl.patrykpro.calendar.widgets;

import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

/**
 * What the small Today widget has room for: the first few of today's items
 * that are not over yet, in the agenda's order ({@link Agenda#itemsOn}).
 *
 * When nothing is left today it says so ("Nothing else today") and looks one
 * day ahead, naming tomorrow's first item, so that a glance in the evening
 * still tells something. Tasks are those due today; overdue ones belong to
 * the Agenda and Tasks widgets, which have room to list them.
 */
final class TodayPick {
    /** Rows the widget has in its layout, and how many it shows when its size is not known. */
    static final int ROWS = 5;
    static final int DEFAULT_ROWS = 3;
    /** The date at the top with the padding, and the height of one row, in dp. */
    private static final int HEADER_DP = 76;
    private static final int ROW_DP = 21;

    /**
     * How many rows fit a widget {@code heightDp} tall (as the launcher reports
     * it; 0 when it does not): at least one, at most {@link #ROWS}.
     */
    static int rowsFor(int heightDp) {
        if (heightDp <= 0) return DEFAULT_ROWS;
        return Math.max(1, Math.min(ROWS, (heightDp - HEADER_DP) / ROW_DP));
    }

    /** Today's first items, as many as there are rows. */
    final List<Agenda.Item> today;
    /** How many of today's items did not fit. */
    final int more;
    /** When nothing is left today: tomorrow's first item, or null. */
    final Agenda.Item tomorrow;
    /** Whether the snapshot covers today (false: show nothing as known, ask for the app). */
    final boolean covered;
    /** Whether something the widget would show lies outside the snapshot (tomorrow, when it is needed). */
    final boolean cut;

    private TodayPick(List<Agenda.Item> today, int more, Agenda.Item tomorrow, boolean covered, boolean cut) {
        this.today = today;
        this.more = more;
        this.tomorrow = tomorrow;
        this.covered = covered;
        this.cut = cut;
    }

    static TodayPick pick(Snapshot snapshot, WidgetOptions options, long now, TimeZone zone, int rows) {
        int today = Days.dayOf(now, zone);
        if (!snapshot.covers(today)) return new TodayPick(Collections.emptyList(), 0, null, false, true);
        List<Agenda.Item> items = Agenda.itemsOn(snapshot, options, today, now, zone, options.tasks, false);
        if (!items.isEmpty()) {
            int shown = Math.min(rows, items.size());
            return new TodayPick(items.subList(0, shown), items.size() - shown, null, true, false);
        }
        if (!snapshot.covers(today + 1)) return new TodayPick(items, 0, null, true, true);
        List<Agenda.Item> next = Agenda.itemsOn(snapshot, options, today + 1, now, zone, options.tasks, false);
        return new TodayPick(items, 0, next.isEmpty() ? null : next.get(0), true, false);
    }
}
