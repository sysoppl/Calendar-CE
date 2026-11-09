package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;

import org.json.JSONObject;
import org.junit.Test;

public class WidgetActionTest {
    private static final long START = 1762700000000L;

    @Test
    public void namesTheActionsAsTheWebAppKnowsThem() {
        assertEquals("open", WidgetAction.name("pl.patrykpro.calendar.widget.OPEN"));
        assertEquals("event", WidgetAction.name("pl.patrykpro.calendar.widget.EVENT"));
        assertEquals("newEvent", WidgetAction.name("pl.patrykpro.calendar.widget.NEW_EVENT"));
        assertEquals("newTask", WidgetAction.name("pl.patrykpro.calendar.widget.NEW_TASK"));
        assertEquals("task", WidgetAction.name("pl.patrykpro.calendar.widget.TASK"));
        assertEquals("taskDone", WidgetAction.name("pl.patrykpro.calendar.widget.TASK_DONE"));
        assertNull(WidgetAction.name(Intent.ACTION_MAIN));
        assertNull(WidgetAction.name("pl.patrykpro.calendar.REMINDER_DONE"));
        assertNull(WidgetAction.name(null));
        assertFalse(WidgetAction.isOurs(Intent.ACTION_VIEW));
    }

    @Test
    public void opensADayAndAView() throws Exception {
        JSONObject e = WidgetAction.event(WidgetAction.OPEN, "2026-11-12", "day", null, null, null);
        assertEquals("open", e.getString("action"));
        assertEquals("2026-11-12", e.getString("day"));
        assertEquals("day", e.getString("view"));
        assertEquals(3, e.length());

        JSONObject plain = WidgetAction.event(WidgetAction.OPEN, null, null, null, null, null);
        assertEquals(1, plain.length());
        // Extras that are not right are dropped, the tap still opens the app.
        JSONObject odd = WidgetAction.event(WidgetAction.OPEN, "2026-13-40", "settings", "c", "k", START);
        assertEquals(1, odd.length());
        assertEquals("tasks", WidgetAction.event(WidgetAction.OPEN, null, "tasks", null, null, null).getString("view"));
        assertEquals("agenda", WidgetAction.event(WidgetAction.OPEN, null, "agenda", null, null, null).getString("view"));
    }

    @Test
    public void opensAnEventByItsStartOrDay() throws Exception {
        JSONObject timed = WidgetAction.event(WidgetAction.EVENT, null, null, "local|personal", "key-1", START);
        assertEquals("event", timed.getString("action"));
        assertEquals("local|personal", timed.getString("cal"));
        assertEquals("key-1", timed.getString("key"));
        assertEquals(START, timed.getLong("start"));
        assertFalse(timed.has("day"));

        JSONObject allDay = WidgetAction.event(WidgetAction.EVENT, "2026-11-12", null, "c", "k", null);
        assertEquals("2026-11-12", allDay.getString("day"));
        assertFalse(allDay.has("start"));

        // No item, or no time: nothing to open.
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, "c", "k", null));
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, null, "k", START));
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, "c", "", START));
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, "c", "k\u0000", START));
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, "c", "k", 99_999_999_999_999L));
        assertNull(WidgetAction.event(WidgetAction.EVENT, null, null, "c", 5, START));
    }

    @Test
    public void tasksNeedTheirCalendarAndKey() throws Exception {
        JSONObject done = WidgetAction.event(WidgetAction.TASK_DONE, "2026-11-12", "day", "local|tasks", "t1", START);
        assertEquals("taskDone", done.getString("action"));
        assertEquals("local|tasks", done.getString("cal"));
        assertEquals("t1", done.getString("key"));
        assertEquals(3, done.length());
        assertEquals("task", WidgetAction.event(WidgetAction.TASK, null, null, "c", "k", null).getString("action"));
        assertNull(WidgetAction.event(WidgetAction.TASK_DONE, null, null, "c", null, null));
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i <= Snapshot.MAX_ID; i++) tooLong.append('k');
        assertNull(WidgetAction.event(WidgetAction.TASK, null, null, "c", tooLong.toString(), null));
    }

    @Test
    public void newItemsTakeAtMostADay() throws Exception {
        JSONObject event = WidgetAction.event(WidgetAction.NEW_EVENT, "2026-11-12", "tasks", "c", "k", START);
        assertEquals("newEvent", event.getString("action"));
        assertEquals("2026-11-12", event.getString("day"));
        assertEquals(2, event.length());
        JSONObject task = WidgetAction.event(WidgetAction.NEW_TASK, "2026-11-12", null, "c", "k", START);
        assertEquals("newTask", task.getString("action"));
        assertEquals(1, task.length());
        assertNull(WidgetAction.event("pl.patrykpro.calendar.widget.DELETE", null, null, "c", "k", null));
    }

    @Test
    public void tellsTapsFromOtherIntents() {
        int history = Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY;
        // A new intent while the activity runs: passed on.
        assertTrue(WidgetsPlugin.isTap(WidgetAction.OPEN, 0, false, false));
        // The launch intent: only on a fresh start.
        assertTrue(WidgetsPlugin.isTap(WidgetAction.EVENT, 0, true, true));
        assertFalse(WidgetsPlugin.isTap(WidgetAction.EVENT, 0, true, false));
        // From the recent apps: never.
        assertFalse(WidgetsPlugin.isTap(WidgetAction.TASK_DONE, history, true, true));
        assertFalse(WidgetsPlugin.isTap(WidgetAction.TASK_DONE, history, false, false));
        assertFalse(WidgetsPlugin.isTap(Intent.ACTION_MAIN, 0, true, true));
        assertFalse(WidgetsPlugin.isTap(null, 0, false, true));
    }

    @Test
    public void theSystemReceiverTakesOnlyTheSystemsBroadcasts() {
        assertTrue(WidgetsSystemReceiver.accepts(Intent.ACTION_BOOT_COMPLETED));
        assertTrue(WidgetsSystemReceiver.accepts(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertTrue(WidgetsSystemReceiver.accepts(Intent.ACTION_TIME_CHANGED));
        assertTrue(WidgetsSystemReceiver.accepts(Intent.ACTION_TIMEZONE_CHANGED));
        assertTrue(WidgetsSystemReceiver.accepts(Intent.ACTION_LOCALE_CHANGED));
        assertFalse(WidgetsSystemReceiver.accepts(Widgets.ACTION_TICK));
        assertFalse(WidgetsSystemReceiver.accepts("android.intent.action.QUICKBOOT_POWERON"));
        assertFalse(WidgetsSystemReceiver.accepts(null));
    }
}
