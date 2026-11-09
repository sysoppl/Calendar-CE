package pl.patrykpro.calendar.widgets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;

/**
 * Draws the widgets again when what they show changed without the app: the
 * clock or the time zone was changed (today may be another day, every time
 * reads differently), the phone's language changed (the "open the app" line
 * of a widget without a snapshot follows it), and after a restart or an
 * update of the app, which take the refresh alarm away.
 *
 * Exported because the system sends these; only broadcasts that no other
 * app may send are taken. The reminders have a receiver of their own for some
 * of the same broadcasts (reminders.BootReceiver); the two do not depend on
 * each other.
 */
public class WidgetsSystemReceiver extends BroadcastReceiver {
    private static final Set<String> ACTIONS = new HashSet<>(Arrays.asList(
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_MY_PACKAGE_REPLACED,
        Intent.ACTION_TIME_CHANGED,
        Intent.ACTION_TIMEZONE_CHANGED,
        Intent.ACTION_LOCALE_CHANGED
    ));

    static boolean accepts(String action) {
        return action != null && ACTIONS.contains(action);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !accepts(intent.getAction())) return;
        if (Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())) {
            // As in BootReceiver: the cached default zone may still be the old one in this process.
            TimeZone.setDefault(null);
        }
        Context app = context.getApplicationContext();
        Widgets.async(goAsync(), () -> {
            if (Widgets.count(app) > 0) Widgets.refreshAll(app);
        });
    }
}
