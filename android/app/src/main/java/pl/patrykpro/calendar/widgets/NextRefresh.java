package pl.patrykpro.calendar.widgets;

import java.util.TimeZone;

/**
 * When the widgets next have to be drawn again without being asked.
 *
 * What they show changes on its own only at a few moments: at midnight
 * (today becomes yesterday, the month may turn, all-day items move on), when
 * a timed event of today ends (the agenda leaves it out from then on), when
 * one starts (the Today widget's "next" moves on), and when a task's due time
 * passes (its label turns to the overdue colour). The next of these, or the
 * coming midnight if there is none before it, is when the one alarm of the
 * widgets is set for ({@link Widgets#schedule}). Every refresh sets it again.
 *
 * The alarm is an inexact one, which needs no permission and lets the system
 * fit it in with others; a widget a minute late is fine. Moments that lie a
 * second or less ahead are moved a little further, so that a refresh never
 * sets an alarm for the moment it is in.
 */
final class NextRefresh {
    /** The shortest wait between two refreshes. */
    static final long MIN_GAP_MS = 30_000L;
    /** The alarm comes this long after the moment, so that the change is there when the widgets are drawn. */
    static final long MARGIN_MS = 1_000L;

    private NextRefresh() {}

    /** The next local midnight after {@code now}. */
    static long midnightAfter(long now, TimeZone zone) {
        return Days.startOf(Days.dayOf(now, zone) + 1, zone);
    }

    /** When to draw again: the next change before the coming midnight, else that midnight. */
    static long at(Snapshot snapshot, long now, TimeZone zone) {
        long best = midnightAfter(now, zone);
        if (snapshot != null) {
            for (Snapshot.Event e : snapshot.events) {
                if (e.allDay) continue;
                if (e.start > now && e.start < best) best = e.start;
                if (e.end > now && e.end < best) best = e.end;
            }
            for (Snapshot.Task t : snapshot.tasks) {
                if (t.timed() && t.due > now && t.due < best) best = t.due;
            }
        }
        return Math.max(best + MARGIN_MS, now + MIN_GAP_MS);
    }
}
