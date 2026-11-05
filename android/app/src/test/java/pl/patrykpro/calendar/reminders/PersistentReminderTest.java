package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import pl.patrykpro.calendar.vault.MemoryValues;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.TestKeys;

/** Reminders whose notification stays until it is dealt with (src/lib/persistent.ts). */
public class PersistentReminderTest {
    private final MemoryValues prefs = new MemoryValues();
    private final MemoryValues vaultFile = new MemoryValues();
    private final SecretVault vault = new SecretVault(vaultFile, new TestKeys());
    private ReminderStore store = new ReminderStore(prefs, vault);

    private static final String ALARM_15_MIN = "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n";

    private static Reminder persistent(String key, String title, boolean task) {
        return new Reminder(key, 1000, title, "", false, 2000, false, true, task);
    }

    private static List<String> keysOf(List<Reminder> items) {
        List<String> keys = new ArrayList<>();
        for (Reminder r : items) keys.add(r.key);
        return keys;
    }

    // -----------------------------------------------------------------
    // The reminder itself

    @Test
    public void theFlagsSurviveTheBridgeTheStoreAndASnooze() throws Exception {
        Reminder r = persistent("url|2000|15", "Pay rent", true);
        Reminder back = Reminder.fromJson(r.toJson());
        assertTrue(back.persistent);
        assertTrue(back.task);
        // As the app sends them (src/lib/reminders.ts toNativeReminder).
        Reminder sent = Reminder.fromJson(new JSONObject("{\"key\":\"k|1|0\",\"at\":1,\"title\":\"T\",\"body\":\"\",\"start\":1,\"persistent\":true,\"task\":true}"));
        assertTrue(sent.persistent && sent.task);
        // A snoozed copy comes back persistent, and so does one moved with the clock.
        Reminder snoozed = r.snoozed("url|2000|15|snooze5000", 5000);
        assertTrue(snoozed.persistent && snoozed.task);
        assertEquals(r.item(), snoozed.item());
        assertTrue(r.moved(1500, 2500).persistent);
        // An ordinary one writes neither, as earlier versions did.
        JSONObject plain = new Reminder("k|1|0", 1, "T", "").toJson();
        assertFalse(plain.has("persistent"));
        assertFalse(plain.has("task"));
        assertFalse(Reminder.fromJson(plain).persistent);
    }

    @Test
    public void aReminderThatTurnsPersistentIsStoredAgain() throws Exception {
        Map<String, List<Reminder>> sets = new HashMap<>();
        sets.put("a", Collections.singletonList(new Reminder("k|2000|15", 1000, "Call", "", false, 2000, false)));
        store.replaceAllSets(sets, "app");
        sets.put("a", Collections.singletonList(persistent("k|2000|15", "Call", false)));
        store.replaceAllSets(sets, "app");
        assertTrue(store.getSets().get("a").items.get(0).persistent);
    }

    // -----------------------------------------------------------------
    // Notifications kept up

    @Test
    public void keepsOneNotificationPerItemAcrossRestarts() throws Exception {
        store.addStanding(persistent("url#rid|2000|60", "Dentist", false));
        // The item's next reminder takes the place of the one before it, as its notification does.
        store.addStanding(persistent("url#rid|2000|15", "Dentist", false));
        store.addStanding(persistent("other|3000|0", "Pay rent", true));
        store = new ReminderStore(prefs, vault);
        assertEquals(java.util.Arrays.asList("url#rid|2000|15", "other|3000|0"), keysOf(store.standing()));
        assertTrue(store.standing().get(1).task);
        // Found by any key of the item, a snoozed copy's too.
        assertEquals("url#rid|2000|15", store.findStanding("url#rid|2000|60").key);
        assertEquals("url#rid|2000|15", store.findStanding("url#rid|2000|15|snooze9000").key);
        assertNull(store.findStanding("url#rid|9000|15"));

        assertEquals("url#rid|2000|15", store.removeStanding("url#rid|2000|60").key);
        assertNull(store.removeStanding("url#rid|2000|60"));
        assertEquals(Collections.singletonList("other|3000|0"), keysOf(store.standing()));
        assertEquals(1, store.clearStanding().size());
        assertTrue(store.standing().isEmpty());
        assertTrue(new ReminderStore(prefs, vault).standing().isEmpty());
    }

    @Test
    public void keepsTheNewestWhenThereAreTooMany() throws Exception {
        List<Reminder> dropped = new ArrayList<>();
        for (int i = 0; i < ReminderStore.MAX_STANDING + 2; i++) dropped.addAll(store.addStanding(persistent("item" + i + "|2000|0", "Task " + i, true)));
        assertEquals(java.util.Arrays.asList("item0|2000|0", "item1|2000|0"), keysOf(dropped));
        assertEquals(ReminderStore.MAX_STANDING, store.standing().size());
        assertEquals("item2|2000|0", store.standing().get(0).key);
    }

    @Test
    public void whatIsKeptUpIsEncrypted() throws Exception {
        store.addStanding(persistent("https://dav.example/cal/x.ics|2000|0", "Surprise for Ola", true));
        assertFalse(prefs.reveals("Surprise for Ola"));
        assertFalse(vaultFile.reveals("Surprise for Ola"));
        assertFalse(vaultFile.reveals("dav.example"));
    }

    // -----------------------------------------------------------------
    // Done

    @Test
    public void doneComesFromTheNotificationNotFromTheListOfRecentApps() {
        assertFalse(RemindersPlugin.isDone(null, 0));
        assertTrue(RemindersPlugin.isDone(ReminderNotifier.ACTION_DONE, Intent.FLAG_ACTIVITY_NEW_TASK));
        assertFalse(RemindersPlugin.isDone(Intent.ACTION_MAIN, 0));
        assertFalse(RemindersPlugin.isDone(ReminderNotifier.ACTION_DONE, Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY | Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    // -----------------------------------------------------------------
    // The background refresh of CalDAV calendars

    @Test
    public void readsPersistentEventsByTheirSeries() {
        List<Reminder> out = new ArrayList<>();
        // A server's expansion: an instance with the series' properties and a stored override without them.
        String ics = "BEGIN:VCALENDAR\r\n"
            + "BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID:20261012T070000Z\r\nSUMMARY:Stand-up\r\n"
            + "X-PATRYKPRO-PERSISTENT:true\r\nDTSTART:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VEVENT\r\n"
            + "BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID:20261013T070000Z\r\nSUMMARY:Stand-up\r\n"
            + "DTSTART:20261013T090000Z\r\n" + ALARM_15_MIN + "END:VEVENT\r\n"
            + "BEGIN:VEVENT\r\nUID:other\r\nSUMMARY:Dentist\r\nX-PATRYKPRO-PERSISTENT:FALSE\r\n"
            + "DTSTART:20261014T070000Z\r\n" + ALARM_15_MIN + "END:VEVENT\r\n"
            + "END:VCALENDAR\r\n";
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, Long.MAX_VALUE, "(untitled)", "Hidden event", out));
        assertEquals(3, out.size());
        for (Reminder r : out) {
            assertEquals(r.key, r.key.contains("|standup|"), r.persistent);
            assertFalse(r.task);
        }
    }

    @Test
    public void readsAPersistentTask() {
        List<Reminder> out = new ArrayList<>();
        String ics = "BEGIN:VCALENDAR\r\n"
            + "BEGIN:VTODO\r\nUID:t1\r\nSUMMARY:Pay rent\r\nX-PATRYKPRO-PERSISTENT:TRUE\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "BEGIN:VTODO\r\nUID:t2\r\nSUMMARY:Water plants\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "END:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", ics, 0, Long.MAX_VALUE, "(untitled)", out);
        assertEquals(2, out.size());
        assertTrue(out.get(0).persistent);
        assertFalse(out.get(1).persistent);
        // Both are tasks: a persistent one offers Done.
        assertTrue(out.get(0).task && out.get(1).task);
    }
}
