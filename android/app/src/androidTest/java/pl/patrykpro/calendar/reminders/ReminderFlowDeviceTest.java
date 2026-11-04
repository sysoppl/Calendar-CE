package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import pl.patrykpro.calendar.R;
import pl.patrykpro.calendar.vault.DeviceKeys;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.SharedPrefsValues;

/**
 * The reminder path on a real system: encrypted store, AlarmManager,
 * receiver, notification and its actions. Runs on a device or emulator:
 * gradlew connectedDebugAndroidTest.
 */
@RunWith(AndroidJUnit4.class)
public class ReminderFlowDeviceTest {
    private static final String CALENDAR = "devicetest-calendar";

    private Context context;
    private ReminderStore store;
    private NotificationManager notifications;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        }
        notifications = context.getSystemService(NotificationManager.class);
        notifications.cancelAll();
        store = ReminderStore.get(context);
        store.setEnabled(true);
        store.replaceAllSets(new HashMap<>(), "app");
        ReminderScheduler.rescheduleAll(context);
    }

    @After
    public void tearDown() throws Exception {
        notifications.cancelAll();
        store.replaceAllSets(new HashMap<>(), "app");
        ReminderScheduler.rescheduleAll(context);
    }

    private StatusBarNotification active(String key) {
        for (StatusBarNotification n : notifications.getActiveNotifications()) {
            if (n.getId() == Reminder.noticeIdFor(key)) return n;
        }
        return null;
    }

    private StatusBarNotification waitFor(String key, boolean present, long timeoutMs) {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        StatusBarNotification n = active(key);
        while ((n != null) != present && SystemClock.elapsedRealtime() < end) {
            SystemClock.sleep(250);
            n = active(key);
        }
        return n;
    }

    private static String title(Notification n) {
        CharSequence title = n.extras.getCharSequence(Notification.EXTRA_TITLE);
        return title == null ? null : title.toString();
    }

    private boolean filesReveal(String text) {
        for (String file : new String[] {"calendar_reminders", "calendar_vault"}) {
            for (Map.Entry<String, ?> e : context.getSharedPreferences(file, Context.MODE_PRIVATE).getAll().entrySet()) {
                if (e.getKey().contains(text) || String.valueOf(e.getValue()).contains(text)) return true;
            }
        }
        return false;
    }

    @Test
    public void anAlarmShowsTheReminderFromTheEncryptedStore() throws Exception {
        // The system delivers no alarm sooner than five seconds ahead.
        long at = System.currentTimeMillis() + 7000;
        String key = "https://dav.example.org/devicetest/a.ics|" + at;
        Map<String, List<Reminder>> sets = Collections.singletonMap(CALENDAR, Collections.singletonList(new Reminder(key, at, "Device test title", "Mon, 09:00\nDevice test room")));
        store.replaceAllSets(sets, "app");
        // A snoozed reminder of an earlier run may be waiting too, so "at least".
        assertTrue(ReminderScheduler.rescheduleAll(context) >= 1);
        assertTrue(store.getScheduledIds().contains(Reminder.idFor(key)));

        // Neither the title nor the server's address is readable in the files.
        assertFalse(filesReveal("Device test"));
        assertFalse(filesReveal("dav.example.org"));

        StatusBarNotification shown = waitFor(key, true, 40000);
        assertNotNull("The alarm did not show a notification", shown);
        Notification n = shown.getNotification();
        assertEquals("Device test title", title(n));
        assertEquals("Mon, 09:00\nDevice test room", n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString());
        assertEquals(at, n.when);
        assertTrue(store.wasFired(key));
        assertFalse(filesReveal("dav.example.org"));

        // On a locked screen that hides content: that there is a reminder, not which.
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility);
        assertNotNull(n.publicVersion);
        assertEquals(context.getString(R.string.reminder_generic_title), title(n.publicVersion));
        assertNull(n.publicVersion.extras.getCharSequence(Notification.EXTRA_TEXT));
        assertNull(n.publicVersion.extras.getCharSequence(Notification.EXTRA_BIG_TEXT));

        assertEquals(2, n.actions.length);
        assertEquals(context.getString(R.string.reminder_snooze), n.actions[0].title.toString());
        assertEquals(context.getString(R.string.reminder_dismiss), n.actions[1].title.toString());

        // Snooze: the notification goes, and a copy with the same text is stored for ten minutes later.
        long before = System.currentTimeMillis();
        n.actions[0].actionIntent.send();
        assertNull(waitFor(key, false, 15000));
        Reminder snoozed = null;
        long end = SystemClock.elapsedRealtime() + 15000;
        while (snoozed == null && SystemClock.elapsedRealtime() < end) {
            for (Reminder r : store.allUpcoming(before)) {
                if (r.key.startsWith(key + "|snooze")) snoozed = r;
            }
            if (snoozed == null) SystemClock.sleep(250);
        }
        assertNotNull("The snoozed reminder was not stored", snoozed);
        assertEquals("Device test title", snoozed.title);
        assertTrue(snoozed.at >= before + ReminderNotifier.SNOOZE_MS && snoozed.at <= System.currentTimeMillis() + ReminderNotifier.SNOOZE_MS);
        assertTrue(store.getScheduledIds().contains(snoozed.id()));
        assertFalse(filesReveal("Device test"));
    }

    @Test
    public void aWithdrawnReminderIsNotShown() throws Exception {
        long at = System.currentTimeMillis() + 7000;
        String key = "devicetest-withdrawn|" + at;
        store.replaceAllSets(Collections.singletonMap(CALENDAR, Collections.singletonList(new Reminder(key, at, "Deleted meanwhile", ""))), "app");
        assertTrue(ReminderScheduler.rescheduleAll(context) >= 1);
        assertTrue(store.getScheduledIds().contains(Reminder.idFor(key)));
        // The event is deleted, but the alarm is left in place, as if the delete raced the alarm.
        store.replaceAllSets(new HashMap<>(), "app");
        SystemClock.sleep(14000);
        assertNull(active(key));
        assertFalse(store.wasFired(key));
    }

    @Test
    public void dismissRemovesTheNotification() throws Exception {
        Reminder r = new Reminder("devicetest-dismiss", System.currentTimeMillis(), "To dismiss", "Body");
        assertTrue(ReminderNotifier.show(context, r, false));
        StatusBarNotification shown = waitFor(r.key, true, 10000);
        assertNotNull(shown);
        shown.getNotification().actions[1].actionIntent.send();
        assertNull(waitFor(r.key, false, 15000));
    }

    @Test
    public void aNewerReminderOfTheSameEventReplacesTheOlderOne() throws Exception {
        long now = System.currentTimeMillis();
        Reminder hour = new Reminder("devicetest-stack#occ|60", now - 1000, "An hour before", "");
        Reminder quarter = new Reminder("devicetest-stack#occ|15", now, "A quarter before", "");
        assertTrue(ReminderNotifier.show(context, hour, false));
        assertNotNull(waitFor(hour.key, true, 10000));
        assertTrue(ReminderNotifier.show(context, quarter, false));
        long end = SystemClock.elapsedRealtime() + 10000;
        StatusBarNotification shown = active(quarter.key);
        while ((shown == null || !"A quarter before".equals(title(shown.getNotification()))) && SystemClock.elapsedRealtime() < end) {
            SystemClock.sleep(250);
            shown = active(quarter.key);
        }
        assertNotNull(shown);
        assertEquals("A quarter before", title(shown.getNotification()));
        int count = 0;
        for (StatusBarNotification n : notifications.getActiveNotifications()) {
            if (n.getId() == quarter.noticeId()) count++;
        }
        assertEquals(1, count);
    }

    @Test
    public void aReminderWithoutTextIsShownInGeneralWords() throws Exception {
        Reminder r = new Reminder("devicetest-missing", System.currentTimeMillis() - 3600000L, "", "");
        assertTrue(ReminderNotifier.show(context, r, true));
        StatusBarNotification shown = waitFor(r.key, true, 10000);
        assertNotNull(shown);
        Notification n = shown.getNotification();
        assertEquals(context.getString(R.string.reminder_generic_title), title(n));
        assertEquals(context.getString(R.string.reminder_generic_text), n.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
        assertEquals(context.getString(R.string.reminder_missed), n.extras.getCharSequence(Notification.EXTRA_SUB_TEXT).toString());
        // The general wording is not taken for the reminder's own text when it is snoozed.
        assertNull(ReminderNotifier.shown(context, r.key));

        Reminder real = new Reminder("devicetest-real", System.currentTimeMillis(), "Real title", "Real body");
        ReminderNotifier.show(context, real, false);
        assertNotNull(waitFor(real.key, true, 10000));
        Reminder read = ReminderNotifier.shown(context, real.key);
        assertEquals("Real title", read.title);
        assertEquals("Real body", read.body);
    }

    @Test
    public void movesPlaintextOfAnOlderVersionIntoTheVault() throws Exception {
        // What a version without the vault left in its preferences file.
        String file = "calendar_reminders_devicetest";
        long at = System.currentTimeMillis() + 3600000L;
        JSONObject item = new JSONObject().put("key", "legacy|1").put("at", at).put("title", "Legacy title").put("body", "Legacy body");
        JSONObject set = new JSONObject().put("source", "app").put("updatedAt", at).put("items", new JSONArray().put(item));
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit().clear()
            .putString("sets", new JSONObject().put("legacy-calendar", set).toString())
            .putString("config", "{\"enabled\":true,\"calendars\":[{\"url\":\"https://dav.example.org/c/\",\"username\":\"u\",\"password\":\"legacy-password\"}]}")
            .putString("fired", "{\"legacy|0\":" + System.currentTimeMillis() + "}")
            .putBoolean("enabled", true)
            .commit();
        Context app = context.getApplicationContext();
        SecretVault vault = new SecretVault(
            new SharedPrefsValues(app, "calendar_vault_devicetest2"), DeviceKeys.keystore(app));
        try {
            ReminderStore legacy = new ReminderStore(new SharedPrefsValues(app, file), vault);
            assertEquals("Legacy title", legacy.find("legacy|1").title);
            assertEquals("legacy-password", legacy.getConfig().getJSONArray("calendars").getJSONObject(0).getString("password"));
            assertTrue(legacy.wasFired("legacy|0"));
            for (String name : new String[] {file, "calendar_vault_devicetest2"}) {
                Map<String, ?> all = context.getSharedPreferences(name, Context.MODE_PRIVATE).getAll();
                assertFalse(all.containsKey("sets"));
                assertFalse(all.containsKey("config"));
                assertFalse(all.containsKey("fired"));
                for (Object value : all.values()) {
                    assertFalse(String.valueOf(value).contains("Legacy"));
                    assertFalse(String.valueOf(value).contains("legacy-password"));
                    assertFalse(String.valueOf(value).contains("legacy|"));
                }
            }
        } finally {
            context.getSharedPreferences(file, Context.MODE_PRIVATE).edit().clear().commit();
            context.getSharedPreferences("calendar_vault_devicetest2", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
