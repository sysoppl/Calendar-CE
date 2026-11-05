package pl.patrykpro.calendar.reminders;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import pl.patrykpro.calendar.MainActivity;
import pl.patrykpro.calendar.R;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * Builds and posts reminder notifications.
 *
 * A persistent reminder's notification (src/lib/persistent.ts) stays: it is
 * pinned (ongoing), and since Android 14 lets a swipe take even such a one
 * away, the swipe puts it up again at once without a sound. The store keeps
 * it ({@link ReminderStore#standing}) until Done, Snooze or Dismiss, or until
 * the app says the item was dealt with, so a restart and an update of the app,
 * which take every notification away, put it up again too.
 */
public final class ReminderNotifier {
    public static final String CHANNEL_ID = "calendar_reminders";
    public static final String ACTION_SNOOZE = "pl.patrykpro.calendar.REMINDER_SNOOZE";
    public static final String ACTION_DISMISS = "pl.patrykpro.calendar.REMINDER_DISMISS";
    /** A persistent notification was swiped away (its delete intent): it is put up again. */
    public static final String ACTION_SWIPED = "pl.patrykpro.calendar.REMINDER_SWIPED";
    /**
     * Done on a task's persistent notification. It opens the app (an activity
     * intent: since Android 12 a notification's broadcast may not start one),
     * which marks the task done and then clears the notification
     * (RemindersPlugin, src/lib/standingReminders.ts).
     */
    public static final String ACTION_DONE = "pl.patrykpro.calendar.REMINDER_DONE";
    private static final String TAG = "CalendarReminders";
    public static final long SNOOZE_MS = 10 * 60 * 1000L;
    /** The brand ink of the icon: the notification's accent (the system lightens it on a dark shade). */
    private static final int ACCENT = 0xFF1E2227;
    /** The colour of the light: the icon's paper, as an ink light would not show. */
    private static final int LIGHT = 0xFFF5F5F3;
    private static final String EXTRA_TEXT_MISSING = "pl.patrykpro.calendar.textMissing";
    /** The item's time and the line below it, so that a snooze can word the time again when it fires. */
    private static final String EXTRA_START = "pl.patrykpro.calendar.start";
    private static final String EXTRA_ALL_DAY = "pl.patrykpro.calendar.allDay";
    private static final String EXTRA_DETAIL = "pl.patrykpro.calendar.detail";
    /** What a snooze keeps of a persistent one when the store cannot say. */
    private static final String EXTRA_PERSISTENT = "pl.patrykpro.calendar.persistent";
    private static final String EXTRA_TASK = "pl.patrykpro.calendar.task";
    /** When the notification whose Done was tapped was put up. */
    static final String EXTRA_POSTED = "pl.patrykpro.calendar.posted";

    private ReminderNotifier() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        // Creating a channel that exists only updates its name and description,
        // which is what keeps them in the device language after it changes.
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.reminder_channel_name), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.reminder_channel_description));
        channel.enableVibration(true);
        channel.enableLights(true);
        channel.setLightColor(LIGHT);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        channel.setSound(sound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        nm.createNotificationChannel(channel);
    }

    /**
     * Removes the notification a reminder is shown in. Also under the
     * reminder's own id, which versions up to 1.1.1 posted it under.
     */
    static void cancel(Context context, String key) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        nm.cancel(Reminder.noticeIdFor(key));
        nm.cancel(Reminder.idFor(key));
    }

    private static PendingIntent action(Context context, String action, String path, Reminder r) {
        // Like the alarms, the actions carry the key only.
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(action)
            .setData(Uri.parse("calendar://" + path + "/" + r.id()))
            .putExtra("key", r.key);
        return PendingIntent.getBroadcast(context, r.id(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Done: opens the app with the reminder's key. One per item (the request code); no data, which the app would take for a link. */
    private static PendingIntent done(Context context, Reminder r) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_DONE)
            .putExtra("key", r.key)
            // Tells one tap from the next: the same intent comes again when the activity is made anew.
            .putExtra(EXTRA_POSTED, System.currentTimeMillis())
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, r.noticeId(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * Posts the notification for a reminder. {@code late} marks one that is
     * shown well after its time (the device was off).
     *
     * A reminder without a title is one whose text could not be read from the
     * encrypted store. It is still shown, in general words, because a silent
     * miss is worse than a vague reminder.
     *
     * A persistent one is kept up from now on ({@link ReminderStore#addStanding});
     * any other takes the place of its item's earlier one, and so ends it.
     */
    public static boolean show(Context context, Reminder r, boolean late) {
        boolean shown = post(context, r, late, false);
        if (!shown) return false;
        try {
            ReminderStore store = ReminderStore.get(context);
            if (r.persistent) store.addStanding(r);
            else store.removeStanding(r.key);
        } catch (VaultException e) {
            // Shown all the same; without the store it is not put up again after a restart.
            Log.w(TAG, "Reminder store unavailable, a persistent notification is not kept");
        }
        return true;
    }

    /** Whether the notification of the item of {@code key} is on screen. */
    static boolean isShown(Context context, String key) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return true;
        try {
            int id = Reminder.noticeIdFor(key);
            for (StatusBarNotification active : nm.getActiveNotifications()) {
                if (active.getId() == id && active.getTag() == null) return true;
            }
            return false;
        } catch (RuntimeException e) {
            // Unknown: not put up twice.
            return true;
        }
    }

    /** Puts a kept notification up again, without a sound: swiped away, or gone with a restart or an update. */
    static boolean repost(Context context, Reminder r) {
        return post(context, r, false, true);
    }

    /**
     * Puts up again every kept notification that is not on screen; takes them
     * all down instead while reminders are off.
     */
    public static void restoreStanding(Context context) {
        Context app = context.getApplicationContext();
        ReminderStore store = ReminderStore.get(app);
        try {
            if (!store.isEnabled()) {
                for (Reminder r : store.clearStanding()) cancel(app, r.key);
                return;
            }
            for (Reminder r : store.standing()) {
                if (!isShown(app, r.key)) repost(app, r);
            }
        } catch (VaultException e) {
            Log.w(TAG, "Reminder store unavailable, persistent notifications not restored");
        }
    }

    /** Takes down the kept notifications of these keys' items for good (the app found them dealt with). */
    public static void clearStanding(Context context, List<String> keys) throws VaultException {
        Context app = context.getApplicationContext();
        ReminderStore store = ReminderStore.get(app);
        Set<String> done = new HashSet<>();
        for (String key : keys) {
            Reminder kept = store.removeStanding(key);
            if (kept != null) done.add(kept.key);
            done.add(key);
        }
        for (String key : done) cancel(app, key);
    }

    private static boolean post(Context context, Reminder r, boolean late, boolean quiet) {
        ensureChannel(context);
        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        if (!nm.areNotificationsEnabled()) return false;

        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, r.id(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        boolean textMissing = r.title.isEmpty();
        String title = textMissing ? context.getString(R.string.reminder_generic_title) : r.title;
        // The time is worded now, when it is shown: "Today at 18:00" is only true today.
        String text = r.text(RelativeWhen.forDevice(context), System.currentTimeMillis());
        String body = textMissing && text.isEmpty() ? context.getString(R.string.reminder_generic_text) : text;

        // What a locked screen shows when the user hides sensitive content:
        // that there is a reminder and when, but not what it is about.
        Notification redacted = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_calendar)
            .setColor(ACCENT)
            .setContentTitle(context.getString(R.string.reminder_generic_title))
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setWhen(r.at)
            .setShowWhen(true)
            .build();

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_calendar)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(redacted)
            .setWhen(r.at)
            .setShowWhen(true)
            // A persistent one stays when it is tapped: opening the app is not dealing with it.
            .setAutoCancel(!r.persistent)
            .setContentIntent(contentIntent);
        if (r.persistent) {
            // Not "alert once": the item's next reminder, which takes this one's place, sounds as it should.
            b.setOngoing(true)
                .setDeleteIntent(action(context, ACTION_SWIPED, "swiped", r));
            if (r.task) b.addAction(0, context.getString(R.string.reminder_done), done(context, r));
        }
        b.addAction(0, context.getString(R.string.reminder_snooze), action(context, ACTION_SNOOZE, "snooze", r))
            .addAction(0, context.getString(R.string.reminder_dismiss), action(context, ACTION_DISMISS, "dismiss", r));
        // Put up again: it made its sound when it came due.
        if (quiet) b.setSilent(true);
        if (late) b.setSubText(context.getString(R.string.reminder_missed));
        Bundle extras = new Bundle();
        if (textMissing) extras.putBoolean(EXTRA_TEXT_MISSING, true);
        if (r.persistent) extras.putBoolean(EXTRA_PERSISTENT, true);
        if (r.task) extras.putBoolean(EXTRA_TASK, true);
        if (r.hasStart()) {
            extras.putLong(EXTRA_START, r.start);
            extras.putBoolean(EXTRA_ALL_DAY, r.allDay);
            extras.putString(EXTRA_DETAIL, r.body);
        }
        if (!extras.isEmpty()) b.addExtras(extras);
        try {
            // Shared by the item's reminders: this one replaces the one shown before it.
            nm.notify(r.noticeId(), b.build());
            return true;
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS revoked.
            return false;
        }
    }

    /**
     * The reminder as its notification currently shows it, or null when the
     * notification is gone. Lets a snooze keep its text even if the reminder
     * has left the store in the meantime (the app only stores future ones).
     */
    static Reminder shown(Context context, String key) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return null;
        try {
            int id = Reminder.noticeIdFor(key);
            int legacyId = Reminder.idFor(key);
            for (StatusBarNotification active : nm.getActiveNotifications()) {
                if ((active.getId() != id && active.getId() != legacyId) || active.getTag() != null) continue;
                Bundle extras = active.getNotification().extras;
                // The general wording is not the reminder's text and must not be kept as such.
                if (extras.getBoolean(EXTRA_TEXT_MISSING)) return null;
                CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
                String shownTitle = title == null ? "" : title.toString();
                if (extras.containsKey(EXTRA_START)) {
                    // The time is worded again when the copy is shown, from what it was worded from.
                    String detail = extras.getString(EXTRA_DETAIL, "");
                    return new Reminder(key, active.getNotification().when, shownTitle, detail, false, extras.getLong(EXTRA_START), extras.getBoolean(EXTRA_ALL_DAY),
                        extras.getBoolean(EXTRA_PERSISTENT), extras.getBoolean(EXTRA_TASK));
                }
                CharSequence text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                if (text == null) text = extras.getCharSequence(Notification.EXTRA_TEXT);
                return new Reminder(key, active.getNotification().when, shownTitle, text == null ? "" : text.toString());
            }
        } catch (RuntimeException e) {
            // Some devices fail this call; the caller falls back to a reminder without text.
        }
        return null;
    }
}
