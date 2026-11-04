package pl.patrykpro.calendar.reminders;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

import pl.patrykpro.calendar.vault.VaultException;

/**
 * Turns the stored reminders into AlarmManager alarms.
 *
 * Exact alarms (setExactAndAllowWhileIdle) fire on time even in Doze. The
 * app declares USE_EXACT_ALARM, which Android grants automatically to
 * calendar apps on API 33+, and SCHEDULE_EXACT_ALARM for API 31-32. If exact
 * alarms are unavailable anyway (user revoked them) we fall back to
 * setAndAllowWhileIdle and the settings screen shows a warning.
 */
public final class ReminderScheduler {
    private static final String TAG = "CalendarReminders";
    public static final String ACTION_FIRE = "pl.patrykpro.calendar.REMINDER_FIRE";
    /**
     * Only the nearest reminders are registered; the queue is topped up after
     * every alarm, every refresh and every push from the app. Android allows
     * 500 alarms per app and each one costs a call into the system.
     */
    static final int MAX_ALARMS = 64;
    /** A reminder that was missed by less than this (clock change, app update) still fires. */
    public static final long MISSED_GRACE_MS = 30 * 60 * 1000L;
    /**
     * After a reboot the window is wider: nothing can fire while the device is
     * off or before its first unlock, which easily takes longer than half an hour.
     */
    public static final long MISSED_AFTER_BOOT_MS = 12 * 3600 * 1000L;
    /** At most this many missed reminders are shown at once, the latest ones. */
    private static final int MAX_MISSED_SHOWN = 8;

    private ReminderScheduler() {}

    public static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /**
     * The intent carries the key and the time only. Title and text are looked
     * up in the encrypted store when the alarm fires, so they never sit in the
     * system's alarm list.
     */
    private static PendingIntent pendingIntent(Context context, Reminder r) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(ACTION_FIRE)
            // A unique data URI makes each PendingIntent distinct.
            .setData(Uri.parse("calendar://reminder/" + r.id()))
            .putExtra("key", r.key)
            .putExtra("at", r.at);
        return PendingIntent.getBroadcast(context, r.id(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent cancelIntent(Context context, int id) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(ACTION_FIRE)
            .setData(Uri.parse("calendar://reminder/" + id));
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
    }

    /** Registers one alarm. False when the system refused it. */
    private static boolean arm(AlarmManager am, long at, PendingIntent pi, boolean exact) {
        try {
            if (exact) {
                try {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    return true;
                } catch (SecurityException e) {
                    // Exact alarm permission revoked between the check and the call.
                }
            }
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            return true;
        } catch (SecurityException | IllegalStateException e) {
            // IllegalStateException: the per-app limit of concurrent alarms is reached.
            Log.w(TAG, "The system refused an alarm: " + e.getClass().getSimpleName());
            return false;
        }
    }

    /** Cancels alarms that are no longer wanted and registers the next MAX_ALARMS reminders. */
    public static synchronized int rescheduleAll(Context context) {
        Context app = context.getApplicationContext();
        ReminderStore store = ReminderStore.get(app);
        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return 0;

        List<Reminder> upcoming;
        try {
            store.rezone(TimeZone.getDefault());
            // Late ones too: an alarm the system has not delivered yet would be
            // cancelled below, and set again it fires at once.
            upcoming = store.isEnabled() ? store.nextUnfired(System.currentTimeMillis() - MISSED_GRACE_MS, MAX_ALARMS) : new ArrayList<>();
        } catch (VaultException e) {
            // The reminders cannot be read right now. The alarms already set are
            // still right as far as we know; cancelling them would silence them.
            Log.w(TAG, "Reminder store unavailable, keeping the current alarms");
            return store.getScheduledIds().size();
        }

        Set<Integer> next = new LinkedHashSet<>();
        for (Reminder r : upcoming) next.add(r.id());

        // Cancel alarms that are no longer wanted.
        for (Integer id : store.getScheduledIds()) {
            if (next.contains(id)) continue;
            PendingIntent pi = cancelIntent(app, id);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }

        boolean exact = canScheduleExact(app);
        Set<Integer> scheduled = new LinkedHashSet<>();
        for (Reminder r : upcoming) {
            // After one refusal the rest would be refused too.
            if (!arm(am, r.at, pendingIntent(app, r), exact)) break;
            scheduled.add(r.id());
        }
        store.setScheduledIds(new ArrayList<>(scheduled));
        Log.i(TAG, "Scheduled " + scheduled.size() + " reminders (exact=" + exact + ")");
        return scheduled.size();
    }

    /**
     * Shows reminders that came due within the last {@code windowMs} while
     * nothing could fire: the device was off, the clock jumped, or the app was
     * being updated.
     */
    public static void fireMissed(Context context, long windowMs) {
        Context app = context.getApplicationContext();
        ReminderStore store = ReminderStore.get(app);
        if (!store.isEnabled()) return;
        long now = System.currentTimeMillis();
        List<Reminder> missed;
        try {
            store.rezone(TimeZone.getDefault());
            missed = store.missedBetween(now - windowMs, now);
        } catch (VaultException e) {
            Log.w(TAG, "Reminder store unavailable, missed reminders not checked");
            return;
        }
        int skip = Math.max(0, missed.size() - MAX_MISSED_SHOWN);
        for (int i = 0; i < missed.size(); i++) {
            Reminder r = missed.get(i);
            // The older ones are only marked, or they would come up at the next check.
            if (i >= skip) ReminderNotifier.show(app, r, now - r.at > MISSED_GRACE_MS);
            store.markFired(r.key);
        }
    }

    /**
     * Everything to do when alarms may have been lost or have gone stale:
     * after a boot, an app update, or a change of clock or time zone.
     */
    public static void restore(Context context, boolean afterBoot) {
        fireMissed(context, afterBoot ? MISSED_AFTER_BOOT_MS : MISSED_GRACE_MS);
        rescheduleAll(context);
    }

    /** Schedules a single extra reminder (snooze, test). */
    public static void scheduleOne(Context context, Reminder r) {
        Context app = context.getApplicationContext();
        try {
            // Stored like any other reminder: the alarm only carries the key, and
            // this way a snooze also survives a reboot.
            ReminderStore.get(app).addExtra(r);
        } catch (VaultException e) {
            // Without the store the alarm can still fire; it will show a reminder without its text.
            Log.w(TAG, "Reminder store unavailable, scheduling without text");
            AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
            if (am != null) arm(am, r.at, pendingIntent(app, r), canScheduleExact(app));
            return;
        }
        rescheduleAll(app);
    }
}
