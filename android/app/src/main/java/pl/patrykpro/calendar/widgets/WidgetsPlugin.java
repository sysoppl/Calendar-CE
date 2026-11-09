package pl.patrykpro.calendar.widgets;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;

import pl.patrykpro.calendar.vault.VaultException;

/**
 * Bridge between the web app and the home screen widgets.
 *
 * - {@code setSnapshot({ snapshot })}: the web app hands over what the
 *   widgets show ({@link Snapshot}); it is stored encrypted, every placed
 *   widget is drawn again and the refresh alarm is set. Resolves
 *   {@code { widgets }}, the number of placed widgets.
 * - {@code getStatus()}: {@code { widgets }}.
 * - {@code clear()}: forgets the snapshot (signing out, removing the data);
 *   the widgets then ask for the app to be opened.
 * - event {@code widgetsChanged} {@code { widgets }}: a widget was added or
 *   removed while the app runs, so a first snapshot can be pushed at once.
 * - event {@code widgetAction} {@code { action, day?, view?, cal?, key?, start? }}:
 *   a tap on a widget opened the app ({@link WidgetAction}). Kept until the
 *   page listens, which a page still starting does a moment later.
 *
 * Which intents are taps to pass on: every widget intent that comes through
 * {@link #handleOnNewIntent} while the activity runs; the activity's own
 * launch intent only when the activity was started afresh by it, not when it
 * was made again from saved state (a turn of the screen, the process ended in
 * the background) and not when it was opened from the list of recent apps,
 * which hands it the intent it was first opened with. Capacitor gives the
 * launch intent to {@code handleOnNewIntent} too, and the same intent object
 * is never passed on twice.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {
    /** A snapshot bigger than this is refused: the web app sends far less (some hundred kilobytes). */
    static final int MAX_SNAPSHOT_CHARS = 8 * 1024 * 1024;

    /** The plugin of the running activity, for the providers' widgetsChanged. */
    private static volatile WeakReference<WidgetsPlugin> live = new WeakReference<>(null);

    /** Whether the current activity was started afresh, not made again from saved state ({@link #activityCreated}). */
    private static volatile boolean freshStart = true;

    /** The widget intents passed on in this process, by identity. */
    private static final Set<Intent> passed = Collections.newSetFromMap(new WeakHashMap<>());

    /**
     * Called by MainActivity before its bridge starts: {@code fresh} when it
     * has no saved state, so that its launch intent is a new tap.
     */
    public static void activityCreated(boolean fresh) {
        freshStart = fresh;
    }

    /** From the providers: the placed widgets changed. Only a running app hears it. */
    static void widgetsChanged(int count) {
        WidgetsPlugin plugin = live.get();
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("widgets", count);
        plugin.notifyListeners("widgetsChanged", data);
    }

    @Override
    public void load() {
        live = new WeakReference<>(this);
        Activity activity = getActivity();
        if (activity != null) passOn(activity.getIntent(), true);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Activity activity = getActivity();
        passOn(intent, activity != null && intent == activity.getIntent());
    }

    @Override
    protected void handleOnDestroy() {
        if (live.get() == this) live = new WeakReference<>(null);
        super.handleOnDestroy();
    }

    /** Whether an intent is a tap to pass on; see the class comment. */
    static boolean isTap(String action, int flags, boolean launchIntent, boolean freshStart) {
        if (!WidgetAction.isOurs(action)) return false;
        if ((flags & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        return !launchIntent || freshStart;
    }

    private void passOn(Intent intent, boolean launchIntent) {
        if (intent == null || !isTap(intent.getAction(), intent.getFlags(), launchIntent, freshStart)) return;
        synchronized (passed) {
            if (!passed.add(intent)) return;
        }
        JSONObject event;
        try {
            Long start = intent.hasExtra(WidgetAction.EXTRA_START) ? intent.getLongExtra(WidgetAction.EXTRA_START, Long.MIN_VALUE) : null;
            event = WidgetAction.event(intent.getAction(),
                intent.getStringExtra(WidgetAction.EXTRA_DAY),
                intent.getStringExtra(WidgetAction.EXTRA_VIEW),
                intent.getStringExtra(WidgetAction.EXTRA_CAL),
                intent.getStringExtra(WidgetAction.EXTRA_KEY),
                start != null && start != Long.MIN_VALUE ? start : null);
        } catch (RuntimeException e) {
            // Extras another app put in that cannot be read (an unknown parcelable): nothing to pass on.
            return;
        }
        if (event == null) return;
        try {
            notifyListeners("widgetAction", JSObject.fromJSONObject(event), true);
        } catch (JSONException e) {
            // Not for an object made of strings and numbers.
        }
    }

    @PluginMethod
    public void setSnapshot(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("No snapshot");
            return;
        }
        Context context = getContext().getApplicationContext();
        getBridge().execute(() -> {
            try {
                if (snapshot.toString().length() > MAX_SNAPSHOT_CHARS) {
                    call.reject("The snapshot is too big");
                    return;
                }
                Snapshot stored = Widgets.snapshots(context).put(snapshot);
                Widgets.options(context).setLang(stored.lang);
                Widgets.refreshAll(context);
                call.resolve(count(Widgets.count(context)));
            } catch (IllegalArgumentException e) {
                call.reject("Not a usable snapshot");
            } catch (VaultException e) {
                call.reject(e.getMessage());
            } catch (RuntimeException e) {
                call.reject("The widgets could not be updated");
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(count(Widgets.count(getContext())));
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext().getApplicationContext();
        getBridge().execute(() -> {
            Widgets.snapshots(context).clear();
            Widgets.options(context).setLang(null);
            Widgets.refreshAll(context);
            call.resolve();
        });
    }

    private static JSObject count(int widgets) {
        JSObject out = new JSObject();
        out.put("widgets", widgets);
        return out;
    }
}
