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

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import pl.patrykpro.calendar.MainActivity;
import pl.patrykpro.calendar.R;

/** Builds and posts reminder notifications. */
public final class ReminderNotifier {
    public static final String CHANNEL_ID = "calendar_reminders";
    public static final String ACTION_SNOOZE = "pl.patrykpro.calendar.REMINDER_SNOOZE";
    public static final String ACTION_DISMISS = "pl.patrykpro.calendar.REMINDER_DISMISS";
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

    /**
     * Posts the notification for a reminder. {@code late} marks one that is
     * shown well after its time (the device was off).
     *
     * A reminder without a title is one whose text could not be read from the
     * encrypted store. It is still shown, in general words, because a silent
     * miss is worse than a vague reminder.
     */
    public static boolean show(Context context, Reminder r, boolean late) {
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
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .addAction(0, context.getString(R.string.reminder_snooze), action(context, ACTION_SNOOZE, "snooze", r))
            .addAction(0, context.getString(R.string.reminder_dismiss), action(context, ACTION_DISMISS, "dismiss", r));
        if (late) b.setSubText(context.getString(R.string.reminder_missed));
        Bundle extras = new Bundle();
        if (textMissing) extras.putBoolean(EXTRA_TEXT_MISSING, true);
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
                    return new Reminder(key, active.getNotification().when, shownTitle, detail, false, extras.getLong(EXTRA_START), extras.getBoolean(EXTRA_ALL_DAY));
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
