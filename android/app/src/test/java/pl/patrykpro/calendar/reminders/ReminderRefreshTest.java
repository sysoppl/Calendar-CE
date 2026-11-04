package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

import pl.patrykpro.calendar.vault.MemoryValues;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.TestKeys;

/** The CalDAV part of the background refresh, with the network replaced by a stand-in. */
public class ReminderRefreshTest {
    private static final long DAY = 86400000L;
    private static final long HORIZON = 45 * DAY;
    private static final String ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Call\r\nDTSTART:20261012T070000Z\r\n"
        + "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    private final ReminderStore store = TestStores.store(new MemoryValues(), new SecretVault(new MemoryValues(), new TestKeys()));
    private final List<String> fetched = new ArrayList<>();
    private final List<String> errors = new ArrayList<>();
    private final List<String> log = new ArrayList<>();

    private static long now() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(2026, Calendar.OCTOBER, 1, 0, 0, 0);
        return c.getTimeInMillis();
    }

    private static JSONArray calendars(String... names) throws Exception {
        JSONArray out = new JSONArray();
        for (String name : names) {
            out.put(new JSONObject()
                .put("key", name)
                .put("name", name)
                .put("url", "https://dav.example.org/" + name + "/")
                .put("components", new JSONArray().put("VEVENT")));
        }
        return out;
    }

    /** Every calendar answers with one event, except where the calendar's name says how it fails. */
    private ReminderSyncWorker.CalendarSource source(Runnable onFetch) {
        return new ReminderSyncWorker.CalendarSource() {
            @Override
            public List<String> events(String url, long from, long to) {
                fetched.add(url);
                if (onFetch != null) onFetch.run();
                if (url.contains("/deep/")) throw new StackOverflowError();
                if (url.contains("/huge/")) throw new OutOfMemoryError("Java heap space");
                if (url.contains("/broken/")) throw new IllegalStateException("broken");
                return Collections.singletonList(ICS);
            }

            @Override
            public List<String> tasks(String url) {
                return Collections.emptyList();
            }
        };
    }

    @Test
    public void aCalendarThatBreaksTheParserCostsOnlyItsOwnReminders() throws Exception {
        int refreshed = ReminderSyncWorker.refreshCalDav(store, calendars("deep", "huge", "broken", "fine"), (user, password) -> source(null),
            now(), HORIZON, "", "could not be refreshed", () -> false, errors, log);
        assertEquals(1, refreshed);
        assertEquals(4, fetched.size());
        assertEquals(1, store.getSets().get("fine").items.size());
        assertFalse(store.getSets().containsKey("deep"));
        assertEquals(3, errors.size());
        // No message of its own: a fixed text, never the class name (renamed by R8 in a release build).
        assertEquals("deep: could not be refreshed", errors.get(0));
        assertEquals("huge: Java heap space", errors.get(1));
        assertEquals("broken: broken", errors.get(2));
    }

    @Test
    public void stopsBetweenCalendarsOnceTheRunIsStopped() throws Exception {
        boolean[] stopped = {false};
        int refreshed = ReminderSyncWorker.refreshCalDav(store, calendars("first", "second", "third"), (user, password) -> source(() -> stopped[0] = true),
            now(), HORIZON, "", "could not be refreshed", () -> stopped[0], errors, log);
        // What the first calendar brought is kept; nothing more is asked for.
        assertEquals(1, refreshed);
        assertEquals(Collections.singletonList("https://dav.example.org/first/"), fetched);
        assertTrue(store.getSets().containsKey("first"));
        assertTrue(errors.isEmpty());
    }
}
