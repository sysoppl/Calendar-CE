package pl.patrykpro.calendar.reminders;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import pl.patrykpro.calendar.vault.VaultException;

/**
 * Fires a reminder alarm, or snoozes or dismisses a shown reminder, or puts
 * a persistent one that was swiped away up again.
 */
public class ReminderReceiver extends BroadcastReceiver {
    private static final String TAG = "CalendarReminders";
    /** An alarm this far ahead of the stored time belongs to a reminder that was moved after the alarm was set. */
    private static final long EARLY_MS = 60 * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        final String key = intent.getStringExtra("key");
        if (key == null) return;
        final Context app = context.getApplicationContext();
        final String action = intent.getAction();

        if (ReminderNotifier.ACTION_DISMISS.equals(action)) ReminderNotifier.cancel(app, key);

        final long at = intent.getLongExtra("at", System.currentTimeMillis());
        // The texts are in the encrypted store, and reading it calls into the
        // Keystore: not something to do on the main thread.
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (ReminderNotifier.ACTION_DISMISS.equals(action)) unkeep(app, key);
                else if (ReminderNotifier.ACTION_SWIPED.equals(action)) swiped(app, key);
                else if (ReminderNotifier.ACTION_SNOOZE.equals(action)) snooze(app, key);
                else fire(app, key, at);
            } catch (RuntimeException e) {
                Log.w(TAG, "Handling a reminder failed: " + e.getClass().getSimpleName());
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void fire(Context app, String key, long at) {
        ReminderStore store = ReminderStore.get(app);
        if (store.isEnabled() && !store.wasFired(key)) {
            Reminder r = null;
            boolean readable = true;
            try {
                r = store.find(key);
            } catch (VaultException e) {
                readable = false;
            }
            long now = System.currentTimeMillis();
            if (r != null && r.at > now + EARLY_MS) {
                // Moved to a later time; the call below sets its alarm again.
                r = null;
            } else if (r != null && store.wasFired(r, now)) {
                // A late one shown before under the key an earlier version gave it.
                r = null;
            } else if (r == null && !readable) {
                // The store cannot be read, so the text is unknown, but the alarm
                // was set for a real reminder: show it without its text.
                r = new Reminder(key, at, "", "");
            }
            // Otherwise a missing reminder was withdrawn after its alarm was
            // set (event deleted or changed), and there is nothing to show.
            if (r != null) {
                ReminderNotifier.show(app, r, false);
                store.markFired(key);
            }
        }
        // Top up the alarm queue (only the nearest reminders are scheduled).
        ReminderScheduler.rescheduleAll(app);
    }

    /** Dismissed: a persistent one is no longer kept up. */
    private static Reminder unkeep(Context app, String key) {
        try {
            return ReminderStore.get(app).removeStanding(key);
        } catch (VaultException e) {
            return null;
        }
    }

    /** A persistent notification was swiped away: it is put up again while it is kept. */
    private static void swiped(Context app, String key) {
        ReminderStore store = ReminderStore.get(app);
        try {
            Reminder kept = store.isEnabled() ? store.findStanding(key) : null;
            if (kept != null) ReminderNotifier.repost(app, kept);
        } catch (VaultException e) {
            Log.w(TAG, "Reminder store unavailable, a swiped persistent notification stays away");
        }
    }

    private static void snooze(Context app, String key) {
        // What is on screen, persistent or not: a persistent one comes back persistent.
        Reminder r = unkeep(app, key);
        if (r == null) {
            try {
                r = ReminderStore.get(app).find(key);
            } catch (VaultException ignored) {
            }
        }
        if (r == null) r = ReminderNotifier.shown(app, key);
        ReminderNotifier.cancel(app, key);
        long at = System.currentTimeMillis() + ReminderNotifier.SNOOZE_MS;
        // A new key so the snoozed copy is not treated as already fired. An
        // earlier snooze suffix is replaced, or the key would grow with every snooze.
        String snoozedKey = key.replaceFirst("\\|snooze\\d+$", "") + "|snooze" + at;
        // The copy keeps the item's time, which it words again when it is shown.
        ReminderScheduler.scheduleOne(app, r == null ? new Reminder(snoozedKey, at, "", "") : r.snoozed(snoozedKey, at));
    }
}
