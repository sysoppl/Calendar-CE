package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class SnapshotTest {
    /** The example of the contract, as the web app sends it. */
    private static final String EXAMPLE = "{"
        + "\"v\": 1, \"made\": 1762682400000, \"from\": \"2026-09-28\", \"until\": \"2027-03-08\","
        + "\"lang\": \"pl\", \"hour12\": false, \"weekStart\": 1,"
        + "\"calendars\": [ { \"id\": \"local|personal\", \"name\": \"My calendar\", \"color\": \"#d12e2c\", \"events\": true, \"tasks\": false, \"visible\": true } ],"
        + "\"events\": ["
        + "  { \"cal\": \"local|personal\", \"key\": \"k1\", \"title\": \"Dentist\", \"place\": \"Main St 1\", \"color\": \"#1d6cd6\", \"allDay\": false, \"start\": 1762700000000, \"end\": 1762703600000 },"
        + "  { \"cal\": \"local|personal\", \"key\": \"k2\", \"title\": \"Trip\", \"color\": \"#1b8037\", \"allDay\": true, \"day\": \"2026-11-12\", \"endDay\": \"2026-11-15\" } ],"
        + "\"tasks\": ["
        + "  { \"cal\": \"local|tasks\", \"key\": \"t1\", \"title\": \"Buy milk\", \"color\": \"#1d6cd6\", \"due\": 1762700000000, \"allDay\": false },"
        + "  { \"cal\": \"local|tasks\", \"key\": \"t2\", \"title\": \"Call mum\", \"color\": \"#123456\", \"allDay\": true, \"day\": \"2026-11-10\" },"
        + "  { \"cal\": \"local|tasks\", \"key\": \"t3\", \"title\": \"Someday\", \"color\": \"#abcdef\" } ]"
        + "}";

    @Test
    public void readsTheContractsExample() throws Exception {
        Snapshot s = Snapshot.parse(new JSONObject(EXAMPLE));
        assertNotNull(s);
        assertEquals(1762682400000L, s.made);
        assertEquals(Days.parse("2026-09-28"), s.from);
        assertEquals(Days.parse("2027-03-08"), s.until);
        assertEquals("pl", s.lang);
        assertFalse(s.hour12);
        assertEquals(1, s.weekStart);
        assertEquals(1, s.calendars.size());
        Snapshot.Calendar c = s.calendar("local|personal");
        assertEquals("My calendar", c.name);
        assertEquals(0xFFD12E2C, c.color);
        assertTrue(c.events);
        assertFalse(c.tasks);
        assertTrue(c.visible);

        assertEquals(2, s.events.size());
        Snapshot.Event dentist = s.events.get(0);
        assertFalse(dentist.allDay);
        assertEquals(1762700000000L, dentist.start);
        assertEquals(1762703600000L, dentist.end);
        assertEquals("Main St 1", dentist.place);
        assertEquals(0xFF1D6CD6, dentist.color);
        Snapshot.Event trip = s.events.get(1);
        assertTrue(trip.allDay);
        assertEquals(Days.parse("2026-11-12"), trip.day);
        assertEquals(Days.parse("2026-11-15"), trip.endDay);
        assertEquals(Days.parse("2026-11-12"), trip.firstDay(Snap.WARSAW));
        assertEquals(Days.parse("2026-11-14"), trip.lastDay(Snap.WARSAW));
        assertNull(trip.place);

        assertEquals(3, s.tasks.size());
        assertTrue(s.tasks.get(0).timed());
        assertEquals(1762700000000L, s.tasks.get(0).due);
        assertFalse(s.tasks.get(1).timed());
        assertEquals(Days.parse("2026-11-10"), s.tasks.get(1).day);
        assertFalse(s.tasks.get(2).hasDue());
        assertTrue(s.covers(Days.parse("2026-11-09")));
        assertFalse(s.covers(Days.parse("2027-03-08")));
        assertFalse(s.covers(Days.parse("2026-09-27")));
    }

    @Test
    public void refusesWhatIsNoSnapshot() throws Exception {
        assertNull(Snapshot.parse(null));
        assertNull(Snapshot.parse("{}"));
        assertNull(Snapshot.parse(new JSONArray()));
        assertNull(Snapshot.parse(new JSONObject()));
        assertNull(Snapshot.parse(JSONObject.NULL));
        // Another version, no window, a window the wrong way round or absurdly long.
        assertNull(Snapshot.parse(Snap.november().put("v", 2).json));
        assertNull(Snapshot.parse(Snap.november().put("v", "1").json));
        assertNull(Snapshot.parse(Snap.november().put("from", "2026-9-28").json));
        assertNull(Snapshot.parse(Snap.november().put("until", JSONObject.NULL).json));
        assertNull(Snapshot.parse(new Snap("2026-11-09", "2026-11-09").json));
        assertNull(Snapshot.parse(new Snap("2026-11-09", "2026-11-01").json));
        assertNull(Snapshot.parse(new Snap("2000-01-01", "2030-01-01").json));
    }

    @Test
    public void dropsTheEntriesItCannotReadAndKeepsTheRest() throws Exception {
        Snap snap = Snap.november()
            .timed("c", "good", "Good", Snap.at(2026, 11, 9, 9, 0), Snap.at(2026, 11, 9, 10, 0));
        snap.events.put("not an object");
        snap.events.put(JSONObject.NULL);
        snap.events.put(new JSONObject().put("cal", "c").put("title", "No key").put("start", 1L));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "").put("start", 1L));
        snap.events.put(new JSONObject().put("cal", 5).put("key", "k").put("start", 1L));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "k").put("start", "soon"));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "k").put("start", 1e300));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "k").put("allDay", true).put("day", "2026-02-30"));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "k\nk").put("start", 1L));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "t").put("allDay", true).put("day", "tomorrow"));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "t").put("due", "soon"));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "kept").put("due", JSONObject.NULL));
        snap.calendars.put(new JSONObject().put("name", "no id"));
        snap.calendars.put(42);
        Snapshot s = snap.parse();
        assertEquals(1, s.events.size());
        assertEquals("good", s.events.get(0).key);
        assertEquals(1, s.tasks.size());
        assertEquals("kept", s.tasks.get(0).key);
        assertFalse(s.tasks.get(0).hasDue());
        assertTrue(s.calendars.isEmpty());
    }

    @Test
    public void ignoresUnknownFieldsAndFillsInMissingOnes() throws Exception {
        Snap snap = Snap.november().put("future", new JSONObject().put("x", 1)).put("lang", "tlh").put("weekStart", 9).put("hour12", "yes");
        snap.events.put(new JSONObject().put("cal", "c").put("key", "k").put("start", Snap.at(2026, 11, 9, 9, 0))
            .put("end", Snap.at(2026, 11, 9, 8, 0)).put("color", "red").put("recurrence", "FREQ=DAILY").put("place", "   "));
        snap.events.put(new JSONObject().put("cal", "c").put("key", "a").put("allDay", true).put("day", "2026-11-09").put("endDay", "2026-11-09"));
        snap.calendars.put(new JSONObject().put("id", "c"));
        Snapshot s = snap.parse();
        assertNull(s.lang);
        assertEquals(1, s.weekStart);
        assertFalse(s.hour12);
        Snapshot.Event e = s.events.get(0);
        // An end before the start is taken as no length; a colour that is not #rrggbb gets the neutral one.
        assertEquals(e.start, e.end);
        assertEquals(Snapshot.FALLBACK_COLOR, e.color);
        assertEquals("", e.title);
        assertNull(e.place);
        Snapshot.Event a = s.events.get(1);
        assertEquals(a.day + 1, a.endDay);
        Snapshot.Calendar c = s.calendar("c");
        assertEquals("", c.name);
        assertTrue(c.events && c.tasks && c.visible);
    }

    @Test
    public void takesEveryLanguageOfTheAppAndEveryFirstDayOfTheWeek() {
        for (String lang : new String[] {"en", "pl", "de", "es", "fr", "it", "pt", "uk", "cs", "nl"}) {
            assertEquals(lang, Snap.november().put("lang", lang).parse().lang);
        }
        assertEquals(0, Snap.november().put("weekStart", 0).parse().weekStart);
        assertEquals(6, Snap.november().put("weekStart", 6).parse().weekStart);
        assertTrue(Snap.november().put("hour12", true).parse().hour12);
    }

    @Test
    public void capsCountsAndLengths() throws Exception {
        Snap snap = Snap.november();
        StringBuilder longTitle = new StringBuilder();
        for (int i = 0; i < 400; i++) longTitle.append('x');
        long start = Snap.at(2026, 11, 9, 9, 0);
        for (int i = 0; i < Snapshot.MAX_EVENTS + 500; i++) snap.timed("c", "k" + i, longTitle.toString(), start, start + 60_000L);
        for (int i = 0; i < Snapshot.MAX_TASKS + 10; i++) snap.taskUndated("c", "t" + i, "Task\twith\ttabs\nand a line");
        Snapshot s = snap.parse();
        assertEquals(Snapshot.MAX_EVENTS, s.events.size());
        assertEquals(Snapshot.MAX_TASKS, s.tasks.size());
        assertEquals(Snapshot.MAX_TITLE, s.events.get(0).title.length());
        assertEquals("Task with tabs and a line", s.tasks.get(0).title);
        // The order of the snapshot is kept as the order among equals.
        assertEquals(0, s.events.get(0).index);
        assertEquals(Snapshot.MAX_EVENTS - 1, s.events.get(Snapshot.MAX_EVENTS - 1).index);
    }

    @Test
    public void neverCutsBetweenTheHalvesOfACharacter() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < Snapshot.MAX_TITLE - 1; i++) text.append('a');
        text.append("📅");
        String cut = Snapshot.text(text.toString(), Snapshot.MAX_TITLE);
        assertEquals(Snapshot.MAX_TITLE - 1, cut.length());
        assertFalse(Character.isHighSurrogate(cut.charAt(cut.length() - 1)));
    }

    @Test
    public void readsColours() {
        assertEquals(0xFF1D6CD6, Snapshot.color("#1d6cd6", 0));
        assertEquals(0xFFABCDEF, Snapshot.color("#ABCDEF", 0));
        assertEquals(7, Snapshot.color("#abc", 7));
        assertEquals(7, Snapshot.color("1d6cd6", 7));
        assertEquals(7, Snapshot.color("#1d6cdz", 7));
        assertEquals(7, Snapshot.color("#1d6cd6ff", 7));
        assertEquals(7, Snapshot.color(null, 7));
    }

    @Test
    public void readsTheThreeKindsOfTask() throws Exception {
        Snap snap = Snap.november();
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "a").put("due", 1762700000000L));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "b").put("day", "2026-11-10"));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "c").put("allDay", true));
        snap.tasks.put(new JSONObject().put("cal", "c").put("key", "d").put("allDay", true).put("day", "2026-11-10").put("due", 1762700000000L));
        Snapshot s = snap.parse();
        assertTrue(s.tasks.get(0).timed());
        assertEquals(Days.parse("2026-11-10"), s.tasks.get(1).day);
        assertFalse(s.tasks.get(1).timed());
        assertFalse(s.tasks.get(2).hasDue());
        assertFalse(s.tasks.get(3).timed());
        assertEquals(Days.parse("2026-11-10"), s.tasks.get(3).dueDay(Snap.WARSAW));
    }

    @Test
    public void aTimedEventTouchesTheDaysItRunsOn() {
        Snapshot s = Snap.november()
            .timed("c", "night", "Night", Snap.at(2026, 11, 9, 22, 0), Snap.at(2026, 11, 10, 10, 0))
            .timed("c", "midnight", "To midnight", Snap.at(2026, 11, 9, 22, 0), Snap.at(2026, 11, 10, 0, 0))
            .timed("c", "point", "No length", Snap.at(2026, 11, 10, 0, 0), Snap.at(2026, 11, 10, 0, 0))
            .parse();
        int ninth = Days.parse("2026-11-09");
        assertEquals(ninth, s.events.get(0).firstDay(Snap.WARSAW));
        assertEquals(ninth + 1, s.events.get(0).lastDay(Snap.WARSAW));
        assertEquals(ninth, s.events.get(1).lastDay(Snap.WARSAW));
        assertEquals(ninth + 1, s.events.get(2).firstDay(Snap.WARSAW));
        assertEquals(ninth + 1, s.events.get(2).lastDay(Snap.WARSAW));
    }
}
