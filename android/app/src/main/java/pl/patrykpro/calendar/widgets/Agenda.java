package pl.patrykpro.calendar.widgets;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TimeZone;

/**
 * The rows of the Agenda widget, and the items of one day, which the Today
 * widget shows too.
 *
 * The list runs from today for the chosen number of days, day by day, and
 * names only the days that have something: a day header ("Today",
 * "Tomorrow", "Wed, 12 Nov"), then the day's items in the order the app's
 * own agenda uses: tasks overdue from before (today only), all-day events,
 * tasks due that day without a time, then whatever has a time, by that time.
 *
 * An event belongs to every day it touches. An all-day event from the 12th
 * to the 15th (exclusive, as the snapshot gives it) is on the 12th, 13th and
 * 14th; a timed one from 22:00 to 10:00 the next day reads "From 22:00" on
 * the first day and "Until 10:00" on the second, and "All day" on any day in
 * between. One that ends exactly at midnight does not touch the next day.
 * Today, a timed event that is over is left out: the list is about what is
 * still to come.
 *
 * The widget never claims a day it does not know. When the chosen days
 * reach past the snapshot's window (or begin before it, after the clock was
 * put back), the days outside are left out and the list ends with a quiet
 * line asking for the app to be opened, which brings a new snapshot.
 */
final class Agenda {
    static final int HEADER = 0;
    static final int EVENT = 1;
    static final int TASK = 2;
    /** The quiet line at the end: the list reaches past what the snapshot covers. */
    static final int NOTE = 3;

    /** Starts and ends that day: "09:00 – 10:00", or "09:00" when it has no length. */
    static final int SPAN_RANGE = 0;
    /** Starts that day and ends on a later one: "From 22:00". */
    static final int SPAN_FROM = 1;
    /** Started on an earlier day and ends that day: "Until 10:00". */
    static final int SPAN_UNTIL = 2;
    /** An all-day event, or a day in the middle of a longer timed one: "All day". */
    static final int SPAN_ALL_DAY = 3;

    /** The groups of a day, in their order. */
    private static final int GROUP_OVERDUE = 0;
    private static final int GROUP_ALL_DAY = 1;
    private static final int GROUP_DAY_TASKS = 2;
    private static final int GROUP_TIMED = 3;

    /** More rows than anyone scrolls through in a widget; the list ends there. */
    static final int MAX_ROWS = 600;

    /** An event or a task on a day. */
    static final class Item {
        /** One of the two is set. */
        final Snapshot.Event event;
        final Snapshot.Task task;
        final int day;
        /** For an event, how its time reads that day. */
        final int span;
        /** For a task, whether it is past its due time or day. */
        final boolean overdue;
        final int group;
        /** Within a group: the time it sorts by. */
        final long time;

        private Item(Snapshot.Event event, Snapshot.Task task, int day, int span, boolean overdue, int group, long time) {
            this.event = event;
            this.task = task;
            this.day = day;
            this.span = span;
            this.overdue = overdue;
            this.group = group;
            this.time = time;
        }

        private int index() {
            return event != null ? event.index : task.index;
        }

        String cal() {
            return event != null ? event.cal : task.cal;
        }

        String key() {
            return event != null ? event.key : task.key;
        }

        String title() {
            return event != null ? event.title : task.title;
        }

        int color() {
            return event != null ? event.color : task.color;
        }
    }

    static final class Row {
        final int type;
        final int day;
        /** For EVENT and TASK rows. */
        final Item item;

        Row(int type, int day, Item item) {
            this.type = type;
            this.day = day;
            this.item = item;
        }

        /** An id that stays the same for the same row across refreshes, so the list does not jump. */
        long stableId() {
            long h = type * 31L + day;
            if (item != null) {
                h = h * 31 + item.cal().hashCode();
                h = h * 31 + item.key().hashCode();
                h = h * 31 + item.span;
            }
            return h;
        }
    }

    static final class Result {
        final List<Row> rows;
        /** Whether the chosen days reach outside the snapshot's window. */
        final boolean cut;
        /** Whether any event or task is listed. */
        final boolean anything;

        Result(List<Row> rows, boolean cut, boolean anything) {
            this.rows = rows;
            this.cut = cut;
            this.anything = anything;
        }
    }

    private static final Comparator<Item> ORDER = (a, b) -> {
        if (a.group != b.group) return Integer.compare(a.group, b.group);
        if (a.time != b.time) return Long.compare(a.time, b.time);
        // At the same time an event comes before a task, then the snapshot's order.
        boolean aEvent = a.event != null;
        boolean bEvent = b.event != null;
        if (aEvent != bEvent) return aEvent ? -1 : 1;
        return Integer.compare(a.index(), b.index());
    };

    private Agenda() {}

    /**
     * The agenda from the day of {@code now} for {@code options.days} days.
     * Never more than {@link #MAX_ROWS} rows, the quiet line included.
     */
    static Result build(Snapshot snapshot, WidgetOptions options, long now, TimeZone zone) {
        int today = Days.dayOf(now, zone);
        int end = today + options.days;
        boolean cut = snapshot.from > today || snapshot.until < end;
        List<Row> rows = new ArrayList<>();
        boolean anything = false;
        int limit = cut ? MAX_ROWS - 1 : MAX_ROWS;
        for (int day = today; day < end && rows.size() < limit - 1; day++) {
            if (!snapshot.covers(day)) continue;
            List<Item> items = itemsOn(snapshot, options, day, now, zone, options.tasks, options.tasks && day == today);
            if (items.isEmpty()) continue;
            rows.add(new Row(HEADER, day, null));
            for (Item item : items) {
                if (rows.size() >= limit) break;
                rows.add(new Row(item.event != null ? EVENT : TASK, day, item));
                anything = true;
            }
        }
        if (cut) rows.add(new Row(NOTE, Days.NONE, null));
        return new Result(rows, cut, anything);
    }

    /**
     * The items of one day, in the order above. Today ({@code now}'s day),
     * timed events that are over are left out. {@code withTasks}: tasks due
     * that day; {@code withOverdue} adds the open tasks due before it.
     */
    static List<Item> itemsOn(Snapshot snapshot, WidgetOptions options, int day, long now, TimeZone zone, boolean withTasks, boolean withOverdue) {
        List<Item> items = new ArrayList<>();
        if (!snapshot.covers(day)) return items;
        boolean isToday = day == Days.dayOf(now, zone);
        long dayStart = Days.startOf(day, zone);
        long nextStart = Days.startOf(day + 1, zone);
        for (Snapshot.Event e : snapshot.events) {
            if (!options.shows(e.cal, snapshot)) continue;
            int first = e.firstDay(zone);
            int last = e.lastDay(zone);
            if (day < first || day > last) continue;
            if (e.allDay) {
                items.add(new Item(e, null, day, SPAN_ALL_DAY, false, GROUP_ALL_DAY, 0));
                continue;
            }
            int span;
            long ends;
            if (first == last) {
                span = SPAN_RANGE;
                ends = e.end;
            } else if (day == first) {
                span = SPAN_FROM;
                ends = nextStart;
            } else if (day == last) {
                span = SPAN_UNTIL;
                ends = e.end;
            } else {
                items.add(new Item(e, null, day, SPAN_ALL_DAY, false, GROUP_ALL_DAY, 0));
                continue;
            }
            // Over already: an event of no length is over once its time has come.
            if (isToday && ends <= now) continue;
            long time = span == SPAN_UNTIL ? dayStart : e.start;
            items.add(new Item(e, null, day, span, false, GROUP_TIMED, time));
        }
        if (withTasks || withOverdue) {
            int today = Days.dayOf(now, zone);
            for (Snapshot.Task t : snapshot.tasks) {
                if (!t.hasDue() || !options.shows(t.cal, snapshot)) continue;
                int due = t.dueDay(zone);
                if (due == day && withTasks) {
                    boolean overdue = t.timed() ? t.due < now : due < today;
                    if (t.timed()) items.add(new Item(null, t, day, SPAN_RANGE, overdue, GROUP_TIMED, t.due));
                    else items.add(new Item(null, t, day, SPAN_ALL_DAY, overdue, GROUP_DAY_TASKS, 0));
                } else if (due < day && withOverdue) {
                    long time = t.timed() ? t.due : Days.startOf(due, zone);
                    items.add(new Item(null, t, day, t.timed() ? SPAN_RANGE : SPAN_ALL_DAY, true, GROUP_OVERDUE, time));
                }
            }
        }
        Collections.sort(items, ORDER);
        return items;
    }
}
