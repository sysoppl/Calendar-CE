package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

import pl.patrykpro.calendar.vault.MemoryValues;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.TestKeys;
import pl.patrykpro.calendar.vault.VaultException;

public class ReminderStoreTest {
    private static final TimeZone WARSAW = TimeZone.getTimeZone("Europe/Warsaw");
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");

    private final MemoryValues prefs = new MemoryValues();
    private final MemoryValues vaultFile = new MemoryValues();
    private final TestKeys keys = new TestKeys();
    private final SecretVault vault = new SecretVault(vaultFile, keys);
    private ReminderStore store = new ReminderStore(prefs, vault);
    private TimeZone zoneBefore;

    @Before
    public void fixZone() {
        zoneBefore = TimeZone.getDefault();
        TimeZone.setDefault(WARSAW);
    }

    @After
    public void restoreZone() {
        TimeZone.setDefault(zoneBefore);
    }

    /** A second process start: nothing cached, the same files. */
    private void restart() {
        store = new ReminderStore(prefs, vault);
    }

    private static long at(TimeZone zone, int year, int month, int day, int hour, int minute) {
        Calendar c = new GregorianCalendar(zone, Locale.ROOT);
        c.clear();
        c.set(year, month - 1, day, hour, minute, 0);
        return c.getTimeInMillis();
    }

    private static Map<String, List<Reminder>> sets(Object... keyThenItems) {
        Map<String, List<Reminder>> out = new HashMap<>();
        for (int i = 0; i < keyThenItems.length; i += 2) {
            Object items = keyThenItems[i + 1];
            out.put((String) keyThenItems[i], items instanceof Reminder ? Collections.singletonList((Reminder) items) : new ArrayList<>(Arrays.asList((Reminder[]) items)));
        }
        return out;
    }

    private boolean anyFileReveals(String text) {
        return prefs.reveals(text) || vaultFile.reveals(text);
    }

    // -----------------------------------------------------------------
    // What older versions left in clear

    private void writeLegacyState(long now) throws Exception {
        JSONObject item = new JSONObject().put("key", "https://dav.example.org/anna/work/a.ics|15").put("at", now + 60000).put("title", "Dentist appointment").put("body", "Mon, 09:00");
        JSONObject set = new JSONObject().put("source", "app").put("updatedAt", now).put("items", new JSONArray().put(item));
        prefs.map.put("sets", new JSONObject().put("https://dav.example.org/anna/work/", set).toString());
        JSONObject calendar = new JSONObject().put("key", "c1").put("name", "Work").put("url", "https://dav.example.org/anna/work/").put("username", "anna.k").put("password", "correct horse battery");
        prefs.map.put("config", new JSONObject().put("enabled", true).put("horizonDays", 45).put("calendars", new JSONArray().put(calendar)).toString());
        prefs.map.put("fired", new JSONObject().put("https://dav.example.org/anna/work/b.ics|0", now - 1000).put("https://dav.example.org/anna/work/old.ics|0", now - 4L * 86400000).toString());
        prefs.map.put("workerLastError", "Work: HTTP 401 for https://dav.example.org/anna/work/");
        prefs.map.put("scheduled", "[12,34]");
        prefs.map.put("enabled", true);
        prefs.map.put("workerLastSuccess", 123L);
    }

    @Test
    public void movesWhatWasStoredInClearIntoTheVault() throws Exception {
        long now = System.currentTimeMillis();
        writeLegacyState(now);
        assertTrue(anyFileReveals("correct horse battery"));

        Reminder found = store.find("https://dav.example.org/anna/work/a.ics|15");
        assertNotNull(found);
        assertEquals("Dentist appointment", found.title);
        assertEquals("Mon, 09:00", found.body);
        assertEquals("app", store.getSets().get("https://dav.example.org/anna/work/").source);
        JSONObject calendar = store.getConfig().getJSONArray("calendars").getJSONObject(0);
        assertEquals("correct horse battery", calendar.getString("password"));
        assertEquals("anna.k", calendar.getString("username"));
        assertTrue(store.wasFired("https://dav.example.org/anna/work/b.ics|0"));
        assertFalse(store.wasFired("https://dav.example.org/anna/work/a.ics|15"));
        assertEquals("Work: HTTP 401 for https://dav.example.org/anna/work/", store.getWorkerLastError());

        // The clear copies are gone, and nothing on disk names an event, a password or a server.
        for (String legacy : new String[] {"sets", "config", "fired", "workerLastError"}) assertFalse(legacy, prefs.map.containsKey(legacy));
        for (String secret : new String[] {"Dentist", "correct horse", "anna.k", "dav.example.org", "HTTP 401"}) assertFalse(secret, anyFileReveals(secret));
        // Bookkeeping that names nothing stays where it was.
        assertEquals(Arrays.asList(12, 34), store.getScheduledIds());
        assertTrue(store.isEnabled());
        assertEquals(123L, store.getWorkerLastSuccess());

        // Still there after a restart, and the move does not run twice.
        int writes = vaultFile.stringWrites;
        restart();
        assertEquals("Dentist appointment", store.find("https://dav.example.org/anna/work/a.ics|15").title);
        assertEquals("correct horse battery", store.getConfig().getJSONArray("calendars").getJSONObject(0).getString("password"));
        assertTrue(store.wasFired("https://dav.example.org/anna/work/b.ics|0"));
        assertEquals(writes, vaultFile.stringWrites);
    }

    @Test
    public void leavesTheClearCopyAloneWhileTheKeyStoreIsDown() throws Exception {
        writeLegacyState(System.currentTimeMillis());
        keys.unavailable = true;
        try {
            store.getSets();
            fail("Read without a key");
        } catch (VaultException expected) {
        }
        try {
            store.getConfig();
            fail("Read without a key");
        } catch (VaultException expected) {
        }
        // Not moved, but not lost either.
        assertTrue(prefs.map.containsKey("sets"));
        assertTrue(prefs.map.containsKey("config"));
        keys.unavailable = false;
        assertNotNull(store.find("https://dav.example.org/anna/work/a.ics|15"));
        assertFalse(prefs.map.containsKey("sets"));
    }

    @Test
    public void aNewerVaultCopyWinsOverALeftoverClearOne() throws Exception {
        long now = System.currentTimeMillis();
        store.replaceAllSets(sets("cal", new Reminder("new|0", now + 1000, "New", "")), "app");
        // The earlier run was cut off after writing the vault and before removing the old value.
        writeLegacyState(now);
        restart();
        assertNotNull(store.find("new|0"));
        assertNull(store.find("https://dav.example.org/anna/work/a.ics|15"));
        assertFalse(prefs.map.containsKey("sets"));
    }

    // -----------------------------------------------------------------
    // Sets

    @Test
    public void keepsReminderTextsOutOfTheFiles() throws Exception {
        long now = System.currentTimeMillis();
        store.replaceAllSets(sets("https://dav.example.org/cal/", new Reminder("https://dav.example.org/cal/x.ics|10", now + 5000, "Board meeting", "Room 4\nHQ")), "app");
        store.markFired("https://dav.example.org/cal/y.ics|0");
        store.addExtra(new Reminder("https://dav.example.org/cal/x.ics|10|snooze1", now + 9000, "Board meeting", "Room 4"));
        store.recordWorkerRun("Team calendar: HTTP 500");
        for (String secret : new String[] {"Board", "Room 4", "dav.example.org", "Team calendar"}) assertFalse(secret, anyFileReveals(secret));

        restart();
        assertEquals("Board meeting", store.find("https://dav.example.org/cal/x.ics|10").title);
        assertEquals("Room 4\nHQ", store.find("https://dav.example.org/cal/x.ics|10").body);
        assertEquals("Board meeting", store.find("https://dav.example.org/cal/x.ics|10|snooze1").title);
        assertTrue(store.wasFired("https://dav.example.org/cal/y.ics|0"));
        assertEquals("Team calendar: HTTP 500", store.getWorkerLastError());
        assertNull(store.find("unknown"));
    }

    @Test
    public void listsUpcomingRemindersInOrderWithoutDuplicates() throws Exception {
        long now = 1_000_000_000_000L;
        store.replaceAllSets(sets(
            "a", new Reminder[] {new Reminder("k3", now + 3000, "Three", ""), new Reminder("k1", now + 1000, "One", ""), new Reminder("past", now - 1, "Past", "")},
            "b", new Reminder[] {new Reminder("k2", now + 2000, "Two", ""), new Reminder("k1", now + 1000, "One", "")}
        ), "app");
        List<Reminder> upcoming = store.allUpcoming(now);
        assertEquals(3, upcoming.size());
        assertEquals("k1", upcoming.get(0).key);
        assertEquals("k2", upcoming.get(1).key);
        assertEquals("k3", upcoming.get(2).key);

        store.markFired("k1");
        List<Reminder> next = store.nextUnfired(now, 1);
        assertEquals(1, next.size());
        assertEquals("k2", next.get(0).key);
        assertEquals(2, store.nextUnfired(now, 64).size());
    }

    @Test
    public void findsMissedRemindersOnce() throws Exception {
        long now = 1_000_000_000_000L;
        store.replaceAllSets(sets("a", new Reminder[] {
            new Reminder("early", now - 13 * 3600000L, "Too old", ""),
            new Reminder("night", now - 5 * 3600000L, "Missed at night", ""),
            new Reminder("recent", now - 60000, "Just missed", ""),
            new Reminder("shown", now - 120000, "Already shown", ""),
            new Reminder("future", now + 60000, "Later", ""),
        }), "app");
        store.markFired("shown");
        List<Reminder> halfHour = store.missedBetween(now - ReminderScheduler.MISSED_GRACE_MS, now);
        assertEquals(1, halfHour.size());
        assertEquals("recent", halfHour.get(0).key);
        List<Reminder> afterBoot = store.missedBetween(now - ReminderScheduler.MISSED_AFTER_BOOT_MS, now);
        assertEquals(2, afterBoot.size());
        assertEquals("night", afterBoot.get(0).key);
        assertEquals("recent", afterBoot.get(1).key);
        for (Reminder r : afterBoot) store.markFired(r.key);
        assertTrue(store.missedBetween(now - ReminderScheduler.MISSED_AFTER_BOOT_MS, now).isEmpty());
    }

    @Test
    public void doesNotEncryptAnUnchangedPushAgain() throws Exception {
        long now = System.currentTimeMillis();
        Map<String, List<Reminder>> push = sets("a", new Reminder("k", now + 1000, "T", "B"), "b", new Reminder[0]);
        store.replaceAllSets(push, "app");
        long updatedAt = store.getSets().get("a").updatedAt;
        int writes = vaultFile.stringWrites;
        store.replaceAllSets(sets("a", new Reminder("k", now + 1000, "T", "B"), "b", new Reminder[0]), "app");
        store.replaceSet("a", Collections.singletonList(new Reminder("k", now + 1000, "T", "B")), "app");
        assertEquals(writes, vaultFile.stringWrites);
        assertEquals(updatedAt, store.getSets().get("a").updatedAt);

        // Any difference is written: text, time, source, or a set that is gone.
        store.replaceAllSets(sets("a", new Reminder("k", now + 1000, "T", "B2"), "b", new Reminder[0]), "app");
        assertEquals(writes + 1, vaultFile.stringWrites);
        store.replaceAllSets(sets("a", new Reminder("k", now + 2000, "T", "B2"), "b", new Reminder[0]), "app");
        assertEquals(writes + 2, vaultFile.stringWrites);
        store.replaceSet("a", Collections.singletonList(new Reminder("k", now + 2000, "T", "B2")), "worker");
        assertEquals(writes + 3, vaultFile.stringWrites);
        store.replaceAllSets(sets("a", new Reminder("k", now + 2000, "T", "B2")), "worker");
        assertEquals(writes + 4, vaultFile.stringWrites);
        assertEquals(1, store.getSets().size());
    }

    @Test
    public void snoozedRemindersSurviveAPushAndARestart() throws Exception {
        long now = System.currentTimeMillis();
        store.replaceAllSets(sets("a", new Reminder("k", now + 1000, "T", "")), "app");
        store.addExtra(new Reminder("k|snooze1", now + 600000, "T", "snoozed"));
        store.addExtra(new Reminder("test|1", now + 5000, "Calendar", "Test"));
        // The same key again replaces the earlier entry.
        store.addExtra(new Reminder("test|1", now + 6000, "Calendar", "Test"));
        store.addExtra(new Reminder("stale", now - 2 * 86400000L, "Long gone", ""));

        store.replaceAllSets(sets("a", new Reminder[0]), "app");
        restart();
        List<Reminder> upcoming = store.allUpcoming(now);
        assertEquals(2, upcoming.size());
        assertEquals("test|1", upcoming.get(0).key);
        assertEquals(now + 6000, upcoming.get(0).at);
        assertEquals("snoozed", store.find("k|snooze1").body);

        // Old entries are dropped with the next one that is added.
        store.addExtra(new Reminder("another", now + 1, "", ""));
        assertNull(store.find("stale"));
    }

    @Test
    public void forgetsFiredRemindersAfterThreeDays() throws Exception {
        long now = System.currentTimeMillis();
        prefs.map.put("firedIds", new JSONObject().put(ReminderStore.firedId("old"), now - 4L * 86400000).put(ReminderStore.firedId("recent"), now - 86400000L).toString());
        assertTrue(store.wasFired("old"));
        store.markFired("new");
        assertFalse(store.wasFired("old"));
        assertTrue(store.wasFired("recent"));
        assertTrue(store.wasFired("new"));
        restart();
        assertTrue(store.wasFired("new"));
        assertEquals(32, ReminderStore.firedId("anything").length());
    }

    @Test
    public void keepsTheSyncConfigurationEncryptedAndWritesItOncePerChange() throws Exception {
        JSONObject config = new JSONObject("{\"enabled\":true,\"calendars\":[{\"url\":\"https://dav.example.org/c/\",\"username\":\"anna\",\"password\":\"hunter2!\"}]}");
        assertEquals(0, store.getConfig().length());
        store.setConfig(config);
        int writes = vaultFile.stringWrites;
        store.setConfig(new JSONObject(config.toString()));
        assertEquals(writes, vaultFile.stringWrites);
        assertFalse(anyFileReveals("hunter2"));
        assertFalse(anyFileReveals("dav.example.org"));
        restart();
        assertEquals("hunter2!", store.getConfig().getJSONArray("calendars").getJSONObject(0).getString("password"));
        store.setConfig(new JSONObject("{\"enabled\":false,\"calendars\":[]}"));
        restart();
        assertEquals(0, store.getConfig().getJSONArray("calendars").length());
    }

    @Test
    public void tellsUnreadableFromEmpty() throws Exception {
        long now = System.currentTimeMillis();
        store.replaceAllSets(sets("a", new Reminder("k", now + 1000, "T", "")), "app");
        restart();
        keys.unavailable = true;
        try {
            store.allUpcoming(now);
            fail("Listed reminders without a key");
        } catch (VaultException expected) {
        }
        try {
            store.find("k");
            fail("Found a reminder without a key");
        } catch (VaultException expected) {
        }
        try {
            store.replaceAllSets(sets("a", new Reminder("k", now + 1000, "T", "changed")), "app");
            fail("Stored reminders without a key");
        } catch (VaultException expected) {
        }
        // What does not need the vault keeps working.
        store.markFired("k");
        assertTrue(store.wasFired("k"));
        store.recordWorkerRun("Work: HTTP 500");
        assertEquals("", store.getWorkerLastError());
        assertFalse(prefs.reveals("Work"));

        keys.unavailable = false;
        assertEquals("T", store.find("k").title);
        assertEquals("", store.find("k").body);
        store.recordWorkerRun(null);
        assertNull(store.getWorkerLastError());
    }

    // -----------------------------------------------------------------
    // Time zone

    @Test
    public void movesFloatingRemindersWithTheTimeZone() throws Exception {
        // An all-day event on 12 October with a reminder at 9:00 that day, and a meeting at a fixed instant.
        long allDay = at(WARSAW, 2026, 10, 12, 9, 0);
        long meeting = at(WARSAW, 2026, 10, 12, 15, 0);
        store.replaceAllSets(sets("a", new Reminder[] {
            new Reminder("allday|540", allDay, "Birthday", "12 Oct 2026", true),
            new Reminder("meeting|0", meeting, "Call", "12 Oct 2026, 15:00"),
        }), "app");
        store.addExtra(new Reminder("meeting|0|snooze1", meeting + 600000, "Call", ""));
        assertFalse(store.rezone(WARSAW));

        assertTrue(store.rezone(NEW_YORK));
        assertEquals(at(NEW_YORK, 2026, 10, 12, 9, 0), store.find("allday|540").at);
        assertTrue(store.find("allday|540").floating);
        assertEquals("Birthday", store.find("allday|540").title);
        // A fixed instant and a snooze do not move.
        assertEquals(meeting, store.find("meeting|0").at);
        assertEquals(meeting + 600000, store.find("meeting|0|snooze1").at);
        assertFalse(store.rezone(NEW_YORK));

        // The change is on disk, and going back restores the original time.
        restart();
        assertEquals(at(NEW_YORK, 2026, 10, 12, 9, 0), store.find("allday|540").at);
        assertTrue(store.rezone(WARSAW));
        assertEquals(allDay, store.find("allday|540").at);
    }

    @Test
    public void movesATimedReminderWithoutAZoneLikeAnAllDayOne() throws Exception {
        // As the app sends them: "Wake up" at 7:00 wherever the phone is, and a call at a fixed instant,
        // each reminded 15 minutes before. Only the first is marked.
        JSONObject wake = new JSONObject().put("key", "wake|15").put("at", at(WARSAW, 2026, 10, 12, 6, 45))
            .put("title", "Wake up").put("body", "Mon 12 Oct, 07:00").put("floating", true);
        JSONObject call = new JSONObject().put("key", "call|15").put("at", at(WARSAW, 2026, 10, 12, 14, 45))
            .put("title", "Call").put("body", "Mon 12 Oct, 15:00");
        store.replaceAllSets(sets("a", new Reminder[] {Reminder.fromJson(wake), Reminder.fromJson(call)}), "app");

        assertTrue(store.rezone(NEW_YORK));
        // Still 6:45 on the phone's clock, so the text that says 07:00 stays true.
        assertEquals(at(NEW_YORK, 2026, 10, 12, 6, 45), store.find("wake|15").at);
        assertEquals("Mon 12 Oct, 07:00", store.find("wake|15").body);
        assertTrue(store.find("wake|15").floating);
        assertEquals(at(WARSAW, 2026, 10, 12, 14, 45), store.find("call|15").at);
        assertFalse(store.find("call|15").floating);
    }

    @Test
    public void aPushFromTheAppSetsTheZoneItsTimesAreIn() throws Exception {
        long allDay = at(WARSAW, 2026, 10, 12, 9, 0);
        store.replaceAllSets(sets("a", new Reminder("allday|540", allDay, "Birthday", "", true)), "app");
        // The device moves, and the app pushes times it already computed for the new zone.
        TimeZone.setDefault(NEW_YORK);
        long moved = at(NEW_YORK, 2026, 10, 12, 9, 0);
        store.replaceAllSets(sets("a", new Reminder("allday|540", moved, "Birthday", "", true)), "app");
        // Nothing is shifted a second time.
        assertFalse(store.rezone(NEW_YORK));
        assertEquals(moved, store.find("allday|540").at);
    }

    @Test
    public void theWorkerShiftsOlderSetsBeforeAddingItsOwn() throws Exception {
        long allDay = at(WARSAW, 2026, 10, 12, 9, 0);
        store.replaceAllSets(sets("a", new Reminder("allday|540", allDay, "Birthday", "", true)), "app");
        TimeZone.setDefault(NEW_YORK);
        store.replaceSet("b", Collections.singletonList(new Reminder("other|0", at(NEW_YORK, 2026, 10, 13, 8, 0), "Other", "", true)), "worker");
        assertEquals(at(NEW_YORK, 2026, 10, 12, 9, 0), store.find("allday|540").at);
        assertEquals(at(NEW_YORK, 2026, 10, 13, 8, 0), store.find("other|0").at);
    }

    @Test
    public void keepsTheWallClockAcrossZonesAndDaylightSaving() {
        // 9:00 stays 9:00.
        assertEquals(at(NEW_YORK, 2026, 7, 1, 9, 0), ReminderStore.sameWallClock(at(WARSAW, 2026, 7, 1, 9, 0), WARSAW, NEW_YORK));
        assertEquals(at(WARSAW, 2026, 1, 15, 0, 0), ReminderStore.sameWallClock(at(NEW_YORK, 2026, 1, 15, 0, 0), NEW_YORK, WARSAW));
        // Across the date line the calendar day is kept, not the instant.
        TimeZone auckland = TimeZone.getTimeZone("Pacific/Auckland");
        assertEquals(at(NEW_YORK, 2026, 12, 24, 0, 0), ReminderStore.sameWallClock(at(auckland, 2026, 12, 24, 0, 0), auckland, NEW_YORK));
        // 02:30 does not exist in Warsaw on the night the clocks go forward; the result is a valid instant close to it.
        long gap = ReminderStore.sameWallClock(at(NEW_YORK, 2026, 3, 29, 2, 30), NEW_YORK, WARSAW);
        assertTrue(Math.abs(gap - at(WARSAW, 2026, 3, 29, 3, 30)) <= 3600000L);
        long same = at(WARSAW, 2026, 5, 5, 12, 0);
        assertEquals(same, ReminderStore.sameWallClock(same, WARSAW, WARSAW));
    }

    // -----------------------------------------------------------------
    // Reminder

    @Test
    public void clipsLongTexts() {
        StringBuilder longTitle = new StringBuilder();
        for (int i = 0; i < 5000; i++) longTitle.append('x');
        Reminder r = new Reminder("k", 1, longTitle.toString(), longTitle.toString());
        assertEquals(Reminder.MAX_TITLE, r.title.length());
        assertEquals(Reminder.MAX_BODY, r.body.length());
        assertTrue(r.title.endsWith("…"));

        // A cut never leaves half of a character that takes two code units.
        StringBuilder emoji = new StringBuilder();
        for (int i = 0; i < 200; i++) emoji.append("📅");
        String clipped = Reminder.clip(emoji.toString(), Reminder.MAX_TITLE);
        assertTrue(clipped.length() <= Reminder.MAX_TITLE);
        assertFalse(Character.isHighSurrogate(clipped.charAt(clipped.length() - 2)));
        assertEquals("short", Reminder.clip("short", 200));
        assertEquals("", Reminder.clip(null, 200));
    }

    @Test
    public void readsAndWritesJson() throws Exception {
        Reminder r = Reminder.fromJson(new JSONObject("{\"key\":\"k|5\",\"at\":1768203900000,\"title\":\"T\",\"body\":\"B\"}"));
        assertEquals("k|5", r.key);
        assertEquals(1768203900000L, r.at);
        assertFalse(r.floating);
        assertFalse(r.toJson().has("floating"));
        Reminder floating = Reminder.fromJson(new Reminder("k", 5, "T", "B", true).toJson());
        assertTrue(floating.floating);
        // Text may be missing; identity and time may not.
        assertEquals("", Reminder.fromJson(new JSONObject("{\"key\":\"k\",\"at\":1,\"title\":null}")).title);
        assertNull(Reminder.fromJson(new JSONObject("{\"at\":1,\"title\":\"T\"}")));
        assertNull(Reminder.fromJson(new JSONObject("{\"key\":\"\",\"at\":1}")));
        assertNull(Reminder.fromJson(new JSONObject("{\"key\":\"k\",\"title\":\"T\"}")));
        assertNull(Reminder.fromJson(new JSONObject("{\"key\":\"k\",\"at\":\"soon\"}")));
        StringBuilder hugeKey = new StringBuilder();
        for (int i = 0; i <= Reminder.MAX_KEY; i++) hugeKey.append('k');
        assertNull(Reminder.fromJson(new JSONObject().put("key", hugeKey.toString()).put("at", 1)));
    }

    // -----------------------------------------------------------------
    // The item's time, worded when the notification is shown

    private static final WhenFormat WHEN = (now, start, allDay) -> (allDay ? "day " : "time ") + start + " seen " + now;

    @Test
    public void keepsTheItemsTimeAcrossJson() throws Exception {
        long start = at(WARSAW, 2026, 10, 15, 18, 0);
        Reminder timed = Reminder.fromJson(new Reminder("k|15", start - 900000, "Gas meter", "Hall", false, start, false).toJson());
        assertTrue(timed.hasStart());
        assertEquals(start, timed.start);
        assertFalse(timed.allDay);
        assertEquals("Hall", timed.body);
        assertFalse(timed.toJson().has("allDay"));

        Reminder day = Reminder.fromJson(new JSONObject("{\"key\":\"d|0\",\"at\":5,\"title\":\"T\",\"body\":\"\",\"start\":0,\"allDay\":true}"));
        assertTrue(day.hasStart());
        assertTrue(day.allDay);

        // What an earlier version stored, or a test notification: the text is whole and stays as it is.
        Reminder legacy = Reminder.fromJson(new JSONObject("{\"key\":\"k\",\"at\":1,\"title\":\"T\",\"body\":\"Mon, 09:00\",\"allDay\":true}"));
        assertFalse(legacy.hasStart());
        assertFalse(legacy.allDay);
        assertFalse(legacy.toJson().has("start"));
        assertEquals("Mon, 09:00", legacy.text(WHEN, 42));
        assertNull(Reminder.fromJson(new JSONObject("{\"key\":\"k\",\"at\":1,\"start\":\"soon\"}")).toJson().opt("start"));
    }

    @Test
    public void wordsTheTimeWhenTheNotificationIsShown() {
        long start = at(WARSAW, 2026, 10, 15, 18, 0);
        Reminder r = new Reminder("k|15", start - 900000, "Gas meter", "Hall", false, start, false);
        // The same reminder, shown at two moments, is worded from each of them.
        assertEquals("time " + start + " seen 1\nHall", r.text(WHEN, 1));
        assertEquals("time " + start + " seen 2\nHall", r.text(WHEN, 2));
        // Without a place there is no second line.
        assertEquals("day " + start + " seen 1", new Reminder("k|0", start, "Day off", "", false, start, true).text(WHEN, 1));
    }

    @Test
    public void aChangedTimeOfTheItemIsAChange() throws Exception {
        long start = at(WARSAW, 2026, 10, 15, 18, 0);
        store.replaceAllSets(sets("a", new Reminder("k|15", start - 900000, "Call", "", false, start, false)), "app");
        long written = store.getSets().get("a").updatedAt;
        Thread.sleep(5);
        // The event moved and its reminder did not (a trigger at a set instant): the store takes the new time.
        store.replaceAllSets(sets("a", new Reminder("k|15", start - 900000, "Call", "", false, start + 86400000L, false)), "app");
        assertEquals(start + 86400000L, store.find("k|15").start);
        assertTrue(store.getSets().get("a").updatedAt > written);
        written = store.getSets().get("a").updatedAt;
        Thread.sleep(5);
        store.replaceAllSets(sets("a", new Reminder("k|15", start - 900000, "Call", "", false, start + 86400000L, true)), "app");
        assertTrue(store.find("k|15").allDay);
        assertTrue(store.getSets().get("a").updatedAt > written);
    }

    @Test
    public void movesTheItemsTimeWithAFloatingReminder() throws Exception {
        // "Wake up" at 7:00 on the device's clock, reminded at 6:45; a call at a fixed instant.
        long wake = at(WARSAW, 2026, 10, 12, 7, 0);
        long call = at(WARSAW, 2026, 10, 12, 15, 0);
        store.replaceAllSets(sets("a", new Reminder[] {
            new Reminder("wake|15", wake - 900000, "Wake up", "", true, wake, false),
            new Reminder("call|15", call - 900000, "Call", "", false, call, false),
        }), "app");
        assertTrue(store.rezone(NEW_YORK));
        Reminder moved = store.find("wake|15");
        assertEquals(at(NEW_YORK, 2026, 10, 12, 6, 45), moved.at);
        // So the notification still says 7:00 on this clock.
        assertEquals(at(NEW_YORK, 2026, 10, 12, 7, 0), moved.start);
        assertEquals(call, store.find("call|15").start);
        restart();
        assertEquals(at(NEW_YORK, 2026, 10, 12, 7, 0), store.find("wake|15").start);
    }

    @Test
    public void aSnoozedCopyKeepsTheItemsTime() {
        long start = at(WARSAW, 2026, 10, 15, 18, 0);
        Reminder r = new Reminder("k|15", start - 900000, "Gas meter", "Hall", true, start, false);
        Reminder copy = r.snoozed("k|15|snooze1", start - 300000);
        assertEquals("k|15|snooze1", copy.key);
        assertEquals(start - 300000, copy.at);
        assertEquals(start, copy.start);
        assertEquals("Hall", copy.body);
        // A snooze is a moment, not a time on the clock.
        assertFalse(copy.floating);
        assertFalse(new Reminder("t", 1, "T", "whole text").snoozed("t|snooze2", 2).hasStart());
    }

    // -----------------------------------------------------------------
    // Keys with the item's time, late reminders

    @Test
    public void knowsTheKeyEarlierVersionsGaveAReminder() {
        assertEquals("https://dav.example.org/cal/a.ics#2026-10-12T09:00:00|15",
            ReminderStore.earlierKey("https://dav.example.org/cal/a.ics#2026-10-12T09:00:00|1791789600000|15"));
        assertEquals("local|a|b|-30", ReminderStore.earlierKey("local|a|b|-1000|-30"));
        assertNull(ReminderStore.earlierKey("https://dav.example.org/cal/a.ics|15"));
        assertNull(ReminderStore.earlierKey("item|1791789600000|15|snooze1791789700000"));
    }

    @Test
    public void aReminderShownUnderItsEarlierKeyDoesNotFireAgainLate() throws Exception {
        long now = System.currentTimeMillis();
        long start = now + 5 * 60000;
        // Shown ten minutes ago by a version whose keys had no time in them.
        store.markFired("event.ics|15");
        Reminder shown = new Reminder("event.ics|" + start + "|15", start - 15 * 60000, "Shown", "");
        // A moved event: its reminder is still to come, and is a new one.
        Reminder moved = new Reminder("moved.ics|" + (now + 3600000) + "|15", now + 45 * 60000, "Moved", "");
        store.markFired("moved.ics|15");
        store.replaceAllSets(sets("a", new Reminder[] {shown, moved}), "app");

        assertTrue(store.wasFired(shown, now));
        assertFalse(store.wasFired(moved, now));
        List<Reminder> next = store.nextUnfired(now - ReminderScheduler.MISSED_GRACE_MS, 64);
        assertEquals(1, next.size());
        assertEquals(moved.key, next.get(0).key);
        assertTrue(store.missedBetween(now - ReminderScheduler.MISSED_GRACE_MS, now).isEmpty());
    }

    @Test
    public void keepsALateReminderThatHasNotFiredWhenTheSetIsReplaced() throws Exception {
        long now = System.currentTimeMillis();
        Reminder late = new Reminder("late", now - 5 * 60000, "Late", "");
        Reminder shown = new Reminder("shown", now - 4 * 60000, "Shown", "");
        Reminder old = new Reminder("old", now - ReminderScheduler.MISSED_GRACE_MS - 60000, "Too old", "");
        Reminder coming = new Reminder("coming", now + 60000, "Coming", "");
        store.replaceAllSets(sets("a", new Reminder[] {old, late, shown, coming}), "app");
        store.markFired("shown");

        // The app lists reminders from now on: the late one would be gone before its alarm is delivered.
        store.replaceAllSets(sets("a", coming), "app");
        assertEquals(Arrays.asList("late", "coming"), keysOf(store.getSets().get("a").items));
        assertEquals("late", store.nextUnfired(now - ReminderScheduler.MISSED_GRACE_MS, 64).get(0).key);
        // So does the worker.
        store.replaceSet("a", Collections.singletonList(new Reminder("coming2", now + 60000, "Coming", "")), "worker");
        assertEquals(Arrays.asList("late", "coming2"), keysOf(store.getSets().get("a").items));
        // Once shown it goes with the next push.
        store.markFired("late");
        store.replaceAllSets(sets("a", coming), "app");
        assertEquals(Collections.singletonList("coming"), keysOf(store.getSets().get("a").items));
    }

    private static List<String> keysOf(List<Reminder> items) {
        List<String> keys = new ArrayList<>();
        for (Reminder r : items) keys.add(r.key);
        return keys;
    }
}
