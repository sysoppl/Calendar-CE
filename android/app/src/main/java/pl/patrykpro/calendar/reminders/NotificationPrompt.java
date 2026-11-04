package pl.patrykpro.calendar.reminders;

import android.Manifest;
import android.content.Context;
import android.os.SystemClock;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.lifecycle.Lifecycle;

import java.util.ArrayList;
import java.util.List;

/**
 * The system's notification permission dialog, asked for by the app itself rather than through
 * Capacitor's permission requests: one launcher registered while the activity is being created,
 * each request started on the main thread, one request on screen at a time (Android answers a
 * second one at once, without a dialog, and the first one's answer would then reach nobody), and
 * every caller that asked meanwhile answered with the one result.
 *
 * Whether the app asked before is kept here as well: only after a request of its own does "the
 * system would show no explanation" mean the permission was turned down.
 */
final class NotificationPrompt {
    /** Called on the main thread once the request is over; `shown` as in {@link PermissionAnswer}. */
    interface Answer {
        void answered(boolean shown);
    }

    private static final String PREFS = "notification_prompt";
    private static final String ASKED = "asked";

    private static ActivityResultLauncher<String> launcher;
    private static final List<Answer> waiting = new ArrayList<>();
    /** When the request on screen went to the system, in `SystemClock.elapsedRealtime()` ms; 0 when none is. */
    private static long askedAt;

    private NotificationPrompt() {}

    /**
     * Registers the launcher with `activity`, which must not have started yet (a plugin's
     * `load()`, run from the activity's `onCreate`). A new activity registers its own; an answer
     * that arrives after the activity was recreated reaches the new one's launcher.
     */
    static void register(ComponentActivity activity) {
        launcher = activity.registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> finish());
    }

    /** Whether this install ever put the dialog on screen through here. */
    static boolean asked(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ASKED, false);
    }

    /**
     * Asks for the permission; main thread only. Returns false when no request can be made now
     * (the activity is not in front, where Android starts no dialog, or there is no launcher): then
     * `answer` is not called and the caller answers for itself.
     */
    static boolean request(ComponentActivity activity, Answer answer) {
        if (launcher == null || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) return false;
        waiting.add(answer);
        // A dialog is on screen already: its answer is this caller's too.
        if (waiting.size() > 1) return true;
        askedAt = SystemClock.elapsedRealtime();
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ASKED, true).apply();
        try {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS);
        } catch (RuntimeException e) {
            // A launcher of an activity that is gone: no dialog.
            waiting.clear();
            askedAt = 0;
            return false;
        }
        return true;
    }

    private static void finish() {
        boolean shown = PermissionAnswer.wasShown(askedAt, SystemClock.elapsedRealtime());
        List<Answer> answers = new ArrayList<>(waiting);
        waiting.clear();
        askedAt = 0;
        for (Answer answer : answers) answer.answered(shown);
    }
}
