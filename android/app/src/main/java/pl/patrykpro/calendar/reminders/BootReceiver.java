package pl.patrykpro.calendar.reminders;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;

/**
 * Alarms are wiped on reboot, and become wrong after the clock or the time
 * zone changes; an app update may change what an alarm carries. Restore them
 * in all of those cases and kick off a background refresh.
 *
 * After a time zone change the stored reminders are first moved to the new
 * zone where they follow the wall clock (see ReminderStore.rezone); the
 * refresh then recomputes what comes from a server.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final Set<String> ACTIONS = new HashSet<>(Arrays.asList(
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_MY_PACKAGE_REPLACED,
        Intent.ACTION_TIME_CHANGED,
        Intent.ACTION_TIMEZONE_CHANGED
    ));
    private static final String EXACT_ALARMS = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";

    /**
     * The receiver is exported for system broadcasts, and only those that no
     * app can send are taken. The exact-alarm one exists from Android 12 on;
     * before that the system does not protect the name, so any app could
     * send it to start a full refresh as often as it liked.
     */
    static boolean accepts(String action, int sdk) {
        if (EXACT_ALARMS.equals(action)) return sdk >= Build.VERSION_CODES.S;
        return ACTIONS.contains(action);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !accepts(intent.getAction(), Build.VERSION.SDK_INT)) return;
        final boolean afterBoot = Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction());
        final Context app = context.getApplicationContext();
        if (Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())) {
            // The system tells each running process about the new zone separately,
            // and this broadcast may get here first. Dropping the cached default
            // makes the next read take the zone from the system setting.
            TimeZone.setDefault(null);
        }
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ReminderScheduler.restore(app, afterBoot);
                // A restart and an update take every notification away; the persistent ones go up again.
                ReminderNotifier.restoreStanding(app);
                ReminderSyncWorker.ensurePeriodic(app);
                // A refresh that is waiting or running already will do; a newer one would only stop it.
                ReminderSyncWorker.runOnceUnlessPending(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
