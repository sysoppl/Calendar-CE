package pl.patrykpro.calendar.widgets;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TimeZone;

/**
 * The rows of the Tasks widget: the open tasks of the chosen lists, overdue
 * ones first, then by when they are due, then those without a due date in
 * the order the app gave them.
 *
 * Each row says when it is due the shortest way that is still clear: the
 * time for one due later today ("09:00"), "Today" for one due today without
 * a time, "Tomorrow", else the date. Overdue ones are marked, so that the
 * widget can draw their label in the accent colour.
 *
 * The snapshot lists every open task, not a window of them; once today is
 * past its window the list may still be right, but it is not known to be
 * ({@link Result#cut}), and the widget asks for the app to be opened.
 */
final class TaskRows {
    static final int DUE_NONE = 0;
    /** A time later (or earlier) today. */
    static final int DUE_TIME = 1;
    static final int DUE_TODAY = 2;
    static final int DUE_TOMORROW = 3;
    static final int DUE_DATE = 4;

    static final int MAX_ROWS = 400;

    static final class Row {
        final Snapshot.Task task;
        final int dueKind;
        final boolean overdue;
        /** The day it is due on, for the date label; {@link Days#NONE} without one. */
        final int dueDay;
        private final long sortTime;

        Row(Snapshot.Task task, int dueKind, boolean overdue, int dueDay, long sortTime) {
            this.task = task;
            this.dueKind = dueKind;
            this.overdue = overdue;
            this.dueDay = dueDay;
            this.sortTime = sortTime;
        }

        long stableId() {
            return task.cal.hashCode() * 31L + task.key.hashCode();
        }
    }

    static final class Result {
        final List<Row> rows;
        final boolean cut;

        Result(List<Row> rows, boolean cut) {
            this.rows = rows;
            this.cut = cut;
        }
    }

    private static final Comparator<Row> ORDER = (a, b) -> {
        int ga = a.task.hasDue() ? (a.overdue ? 0 : 1) : 2;
        int gb = b.task.hasDue() ? (b.overdue ? 0 : 1) : 2;
        if (ga != gb) return Integer.compare(ga, gb);
        if (a.sortTime != b.sortTime) return Long.compare(a.sortTime, b.sortTime);
        return Integer.compare(a.task.index, b.task.index);
    };

    private TaskRows() {}

    static Result build(Snapshot snapshot, WidgetOptions options, long now, TimeZone zone) {
        int today = Days.dayOf(now, zone);
        List<Row> rows = new ArrayList<>();
        for (Snapshot.Task t : snapshot.tasks) {
            if (!options.shows(t.cal, snapshot)) continue;
            if (!t.hasDue()) {
                if (options.undated) rows.add(new Row(t, DUE_NONE, false, Days.NONE, 0));
                continue;
            }
            int day = t.dueDay(zone);
            boolean overdue = t.timed() ? t.due < now : day < today;
            int kind;
            if (day == today) kind = t.timed() ? DUE_TIME : DUE_TODAY;
            else if (day == today + 1) kind = DUE_TOMORROW;
            else kind = DUE_DATE;
            // A day without a time counts from its start, so it comes before the timed ones of that day.
            long time = t.timed() ? t.due : Days.startOf(day, zone);
            rows.add(new Row(t, kind, overdue, day, time));
        }
        Collections.sort(rows, ORDER);
        if (rows.size() > MAX_ROWS) rows = new ArrayList<>(rows.subList(0, MAX_ROWS));
        return new Result(rows, !snapshot.covers(today));
    }
}
