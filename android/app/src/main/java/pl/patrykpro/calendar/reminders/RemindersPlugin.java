package pl.patrykpro.calendar.reminders;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import pl.patrykpro.calendar.R;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * Bridge between the web app and the native reminder engine.
 *
 * The web app pushes the reminders it computed (it knows every calendar,
 * including device-only ones) and the CalDAV account configuration the background
 * worker needs to refresh server calendars on its own. It also tells which
 * persistent notifications have been dealt with in the calendar
 * ({@code listStanding}, {@code clearStanding}), and hears of Done on one
 * ({@code reminderDone}).
 */
// The notification permission is asked for by NotificationPrompt, not through Capacitor's permission
// requests, so the annotation declares none.
@CapacitorPlugin(name = "Reminders")
public class RemindersPlugin extends Plugin {
    /**
     * Done taps this process has passed on. The activity's intent is handed
     * to the page again when the activity is made anew (a turn of the
     * screen); a task reopened since must not be marked done once more.
     */
    private static final Set<String> doneHandled = Collections.synchronizedSet(new HashSet<>());

    @Override
    public void load() {
        Context context = getContext();
        // Before the activity starts, as registering a launcher must be.
        NotificationPrompt.register(getActivity());
        ReminderNotifier.ensureChannel(context);
        ReminderSyncWorker.ensurePeriodic(context);
        new Thread(() -> {
            ReminderScheduler.rescheduleAll(context);
            // Force-stopping the app takes its notifications away too.
            ReminderNotifier.restoreStanding(context);
        }).start();
        if (getActivity() != null) passOnDone(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        passOnDone(intent);
    }

    /**
     * Done on a task's persistent notification opened the app: the page marks
     * the task done (src/lib/standingReminders.ts) and then clears the
     * notification. Kept until the page listens, which a page that is still
     * starting does a moment later. Not from the list of recent apps, which
     * starts the app again with the intent it was opened with.
     */
    static boolean isDone(String action, int flags) {
        return ReminderNotifier.ACTION_DONE.equals(action) && (flags & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
    }

    private void passOnDone(Intent intent) {
        if (intent == null || !isDone(intent.getAction(), intent.getFlags())) return;
        String key = intent.getStringExtra("key");
        if (key == null || !doneHandled.add(key + "|" + intent.getLongExtra(ReminderNotifier.EXTRA_POSTED, 0))) return;
        JSObject data = new JSObject();
        data.put("key", key);
        notifyListeners("reminderDone", data, true);
    }

    @PluginMethod
    public void setReminders(PluginCall call) {
        JSObject sets = call.getObject("sets", new JSObject());
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        Context context = getContext();
        getBridge().execute(() -> {
            try {
                Map<String, List<Reminder>> parsed = new HashMap<>();
                Iterator<String> keys = sets.keys();
                while (keys.hasNext()) {
                    String calendarKey = keys.next();
                    JSONArray arr = sets.getJSONArray(calendarKey);
                    List<Reminder> items = new ArrayList<>();
                    for (int i = 0; i < arr.length(); i++) {
                        Reminder r = Reminder.fromJson(arr.getJSONObject(i));
                        if (r != null) items.add(r);
                    }
                    parsed.put(calendarKey, items);
                }
                ReminderStore store = ReminderStore.get(context);
                store.setEnabled(enabled);
                store.replaceAllSets(parsed, "app");
                int scheduled = ReminderScheduler.rescheduleAll(context);
                // Reminders turned off take the persistent notifications down with them.
                if (!enabled) ReminderNotifier.restoreStanding(context);
                JSObject res = new JSObject();
                res.put("scheduled", scheduled);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void setSyncConfig(PluginCall call) {
        JSObject config = call.getObject("config", new JSObject());
        try {
            ReminderStore.get(getContext()).setConfig(config);
        } catch (VaultException e) {
            call.reject(e.getMessage());
            return;
        }
        ReminderSyncWorker.ensurePeriodic(getContext());
        call.resolve();
    }

    @PluginMethod
    public void runBackgroundSync(PluginCall call) {
        ReminderSyncWorker.runOnce(getContext());
        call.resolve();
    }

    /**
     * "granted"; "prompt" while the system would still show its dialog: never asked from here, or
     * turned down once with the system ready to explain why it is asked; else "denied", which only
     * the system's settings change (a dialog dismissed without an answer reads the same, and the
     * settings put that right too).
     */
    private String notificationPermission() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return "granted";
            if (!NotificationPrompt.asked(context)) {
                // Turned down for good through Capacitor's requests, before 1.4.0 (its own record).
                String legacy = context.getSharedPreferences("PluginPermStates", Context.MODE_PRIVATE).getString(Manifest.permission.POST_NOTIFICATIONS, null);
                return "denied".equals(legacy) ? "denied" : "prompt";
            }
            AppCompatActivity activity = getActivity();
            return activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS) ? "prompt" : "denied";
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled() ? "granted" : "denied";
    }

    private boolean channelEnabled() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm == null) return true;
        NotificationChannel ch = nm.getNotificationChannel(ReminderNotifier.CHANNEL_ID);
        return ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private boolean ignoringBatteryOptimizations() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /** The upcoming reminders, or none when the encrypted store cannot be read right now. */
    private static List<Reminder> upcoming(ReminderStore store) {
        try {
            return store.allUpcoming(System.currentTimeMillis());
        } catch (VaultException e) {
            return new ArrayList<>();
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        ReminderStore store = ReminderStore.get(context);
        List<Reminder> upcoming = upcoming(store);
        JSObject res = new JSObject();
        res.put("permission", notificationPermission());
        res.put("asked", NotificationPrompt.asked(context));
        res.put("systemEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled());
        res.put("channelEnabled", channelEnabled());
        res.put("exactAlarms", ReminderScheduler.canScheduleExact(context));
        res.put("ignoringBatteryOptimizations", ignoringBatteryOptimizations());
        res.put("scheduled", store.getScheduledIds().size());
        res.put("upcoming", upcoming.size());
        if (!upcoming.isEmpty()) {
            res.put("nextAt", upcoming.get(0).at);
            res.put("nextTitle", upcoming.get(0).title);
        }
        res.put("workerLastRun", store.getWorkerLastRun());
        res.put("workerLastSuccess", store.getWorkerLastSuccess());
        String err = store.getWorkerLastError();
        if (err != null) res.put("workerLastError", err.isEmpty() ? context.getString(R.string.reminder_sync_failed) : err);
        res.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(res);
    }

    /**
     * Asks for the notification permission with the system's dialog. The answer says whether a
     * dialog was on screen (`shown`): the system answers at once, without one, when the person
     * turned the permission down for good, and a request made while the app is not in front is not
     * made at all (Android starts no dialog from the background). Without a dialog the web app opens
     * the system's settings instead or asks again when the app is back in front
     * (src/lib/notificationAccess.ts).
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || activity == null || "granted".equals(notificationPermission())) {
            answerPermission(call, false);
            return;
        }
        activity.runOnUiThread(() -> {
            if (!NotificationPrompt.request(activity, shown -> answerPermission(call, shown))) answerPermission(call, false);
        });
    }

    private void answerPermission(PluginCall call, boolean shown) {
        JSObject res = new JSObject();
        res.put("permission", notificationPermission());
        res.put("shown", shown);
        call.resolve(res);
    }

    /**
     * Opens the first of the given settings screens that the device has. Not
     * every device ships every screen, and an exception thrown in a plugin
     * method takes the app down.
     */
    private void openSettings(Intent... candidates) {
        Context context = getContext();
        for (Intent intent : candidates) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            } catch (ActivityNotFoundException | SecurityException e) {
                // Try the next, more general screen.
            }
        }
    }

    private Intent appDetails() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            openSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()), appDetails());
        } else {
            // The per-app notification screen has no public action before Android 8.
            openSettings(appDetails());
        }
        call.resolve();
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())), appDetails());
        }
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        // The list of apps and their battery optimisation, where the person picks this one. The direct
        // request needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which the store allows only for a few
        // kinds of app; reminders do not depend on it (exact alarms wake the app).
        openSettings(
            new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            appDetails()
        );
        call.resolve();
    }

    /** Sends a reminder through the full AlarmManager path after a delay. */
    @PluginMethod
    public void testNotification(PluginCall call) {
        int delay = call.getInt("delaySeconds", 5);
        String title = call.getString("title", "Calendar");
        String body = call.getString("body", "Test reminder");
        long at = System.currentTimeMillis() + delay * 1000L;
        ReminderScheduler.scheduleOne(getContext(), new Reminder("test|" + at, at, title, body));
        call.resolve();
    }

    /** The reminder keys of the persistent notifications kept up, oldest first (src/lib/standingReminders.ts). */
    @PluginMethod
    public void listStanding(PluginCall call) {
        Context context = getContext();
        getBridge().execute(() -> {
            JSArray keys = new JSArray();
            try {
                for (Reminder r : ReminderStore.get(context).standing()) keys.put(r.key);
            } catch (VaultException e) {
                // None that can be named: nothing is cleared.
            }
            JSObject res = new JSObject();
            res.put("keys", keys);
            call.resolve(res);
        });
    }

    /** Takes down, for good, the persistent notifications of the items of these keys: the app found them dealt with. */
    @PluginMethod
    public void clearStanding(PluginCall call) {
        JSArray keys = call.getArray("keys", new JSArray());
        Context context = getContext();
        getBridge().execute(() -> {
            try {
                List<String> list = new ArrayList<>();
                for (int i = 0; i < keys.length(); i++) {
                    Object key = keys.opt(i);
                    if (key instanceof String) list.add((String) key);
                }
                ReminderNotifier.clearStanding(context, list);
                call.resolve();
            } catch (VaultException e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void listUpcoming(PluginCall call) {
        List<Reminder> upcoming = upcoming(ReminderStore.get(getContext()));
        JSArray arr = new JSArray();
        for (int i = 0; i < Math.min(50, upcoming.size()); i++) {
            try {
                JSONObject o = upcoming.get(i).toJson();
                arr.put(o);
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("reminders", arr);
        call.resolve(res);
    }
}
