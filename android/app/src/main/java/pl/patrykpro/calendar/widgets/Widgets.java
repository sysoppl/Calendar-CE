package pl.patrykpro.calendar.widgets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.widget.RemoteViews;

import java.io.File;
import java.util.Arrays;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import pl.patrykpro.calendar.MainActivity;
import pl.patrykpro.calendar.R;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.SharedPrefsValues;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * Where the widgets meet Android: the stores, drawing every placed widget
 * again, the one alarm that keeps them current, and the intents of their
 * taps.
 *
 * Drawing reads the encrypted snapshot, which may take a moment the first
 * time in a process, so it never runs on the main thread: the receivers hand
 * it to {@link #WORK} and keep their broadcast open until it is done
 * ({@link #async}). One refresh at a time, each with the snapshot as it is when it starts, so the last
 * one drawn is always of the newest snapshot.
 */
final class Widgets {
    /** The widgets' own thread: refreshes from receivers and the settings screen, in order. */
    static final ExecutorService WORK = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "widgets");
        thread.setDaemon(true);
        return thread;
    });

    /** The plain preferences file of the widgets (options, month offsets, the language). */
    private static final String PREFS = "calendar_widgets";
    /** The folder of the encrypted snapshot. */
    private static final String SNAPSHOT_DIR = "widgets";

    /** Extra of the list service's intent: which kind of list. */
    static final String EXTRA_KIND = "pl.patrykpro.calendar.widget.kind";

    /** Broadcasts to {@link WidgetsReceiver}, which is not exported: only this app's own pending intents reach it. */
    static final String ACTION_TICK = "pl.patrykpro.calendar.widget.TICK";
    static final String ACTION_MONTH_PREV = "pl.patrykpro.calendar.widget.MONTH_PREV";
    static final String ACTION_MONTH_NEXT = "pl.patrykpro.calendar.widget.MONTH_NEXT";
    static final String ACTION_MONTH_TODAY = "pl.patrykpro.calendar.widget.MONTH_TODAY";

    /**
     * Each widget's pending intents get request codes of their own, widget id
     * times this plus a slot, so that two of them never replace each other
     * (pending intents that differ only in their extras are one and the same).
     */
    static final int SLOTS = 64;
    static final int SLOT_OPEN = 0;
    static final int SLOT_ADD = 1;
    static final int SLOT_PREV = 2;
    static final int SLOT_NEXT = 3;
    static final int SLOT_TITLE = 4;
    static final int SLOT_LIST = 5;
    static final int SLOT_MESSAGE = 6;
    /** The month's 42 day cells: this slot and the 41 after it. */
    static final int SLOT_CELLS = 16;

    /** One refresh at a time; not the class's own lock, which the main thread takes for the stores. */
    private static final Object DRAWING = new Object();
    private static final Object PLACED = new Object();

    private static OptionsStore options;
    private static SnapshotStore snapshots;

    private Widgets() {}

    static synchronized OptionsStore options(Context context) {
        if (options == null) options = new OptionsStore(new SharedPrefsValues(context, PREFS));
        return options;
    }

    static synchronized SnapshotStore snapshots(Context context) {
        if (snapshots == null) {
            File dir = new File(context.getApplicationContext().getNoBackupFilesDir(), SNAPSHOT_DIR);
            snapshots = new SnapshotStore(SecretVault.on(context, new FileValues(dir)));
        }
        return snapshots;
    }

    /** The snapshot, or null when there is none or the Keystore does not answer now. */
    static Snapshot snapshot(Context context) {
        try {
            return snapshots(context).get();
        } catch (VaultException e) {
            return null;
        }
    }

    static int[] ids(Context context, WidgetKind kind) {
        try {
            int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, kind.provider));
            return ids == null ? new int[0] : ids;
        } catch (RuntimeException e) {
            // The widget service is not there (some stripped-down devices): no widgets.
            return new int[0];
        }
    }

    /** How many widgets of this app are placed, of all kinds. */
    static int count(Context context) {
        int count = 0;
        for (WidgetKind kind : WidgetKind.values()) count += ids(context, kind).length;
        return count;
    }

    /** The placed widgets in a form that changes when one is added or removed: "AGENDA:3,7;MONTH:5". */
    static String placedSignature(Context context) {
        StringBuilder out = new StringBuilder();
        for (WidgetKind kind : WidgetKind.values()) {
            int[] ids = ids(context, kind).clone();
            if (ids.length == 0) continue;
            Arrays.sort(ids);
            if (out.length() > 0) out.append(';');
            out.append(kind.name()).append(':');
            for (int i = 0; i < ids.length; i++) out.append(i == 0 ? "" : ",").append(ids[i]);
        }
        return out.toString();
    }

    /**
     * Tells a running app that widgets were added or removed, so that it pushes
     * a snapshot at once (the first widget) or may stop pushing (the last one
     * gone). Called on every change the providers hear of; only a real change
     * of the placed widgets goes on.
     */
    static void noteChange(Context context) {
        OptionsStore store = options(context);
        String now = placedSignature(context);
        synchronized (PLACED) {
            if (now.equals(store.placed())) return;
            store.setPlaced(now);
        }
        WidgetsPlugin.widgetsChanged(count(context));
    }

    /** Runs {@code work} on the widgets' thread and ends the broadcast when it is done. */
    static void async(BroadcastReceiver.PendingResult pending, Runnable work) {
        WORK.execute(() -> {
            try {
                work.run();
            } catch (RuntimeException e) {
                // A widget that could not be drawn keeps its last picture; the next refresh tries again.
            } finally {
                if (pending != null) pending.finish();
            }
        });
    }

    /** Draws every placed widget again and sets the next alarm. Not on the main thread. */
    static void refreshAll(Context context) {
        Context app = context.getApplicationContext();
        synchronized (DRAWING) {
            Snapshot snapshot = snapshot(app);
            long now = System.currentTimeMillis();
            for (WidgetKind kind : WidgetKind.values()) draw(app, kind, ids(app, kind), snapshot, now);
            schedule(app, snapshot, now);
        }
    }

    /** Draws some widgets of one kind again. Not on the main thread. */
    static void refresh(Context context, WidgetKind kind, int[] ids) {
        Context app = context.getApplicationContext();
        synchronized (DRAWING) {
            Snapshot snapshot = snapshot(app);
            long now = System.currentTimeMillis();
            draw(app, kind, ids, snapshot, now);
            schedule(app, snapshot, now);
        }
    }

    private static void draw(Context app, WidgetKind kind, int[] ids, Snapshot snapshot, long now) {
        if (ids.length == 0) return;
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        TimeZone zone = TimeZone.getDefault();
        OptionsStore store = options(app);
        for (int id : ids) {
            RemoteViews views = WidgetViews.build(app, kind, id, snapshot, store, now, zone);
            try {
                manager.updateAppWidget(id, views);
            } catch (RuntimeException e) {
                // The widget went away meanwhile, or its picture was refused; the others are drawn all the same.
            }
        }
        // The lists fetch their rows anew (WidgetListService).
        if (kind.isList() && snapshot != null) {
            try {
                notifyLists(manager, ids);
            } catch (RuntimeException e) {
                // As above.
            }
        }
    }

    @SuppressWarnings("deprecation")
    private static void notifyLists(AppWidgetManager manager, int[] ids) {
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    /** Sets the one alarm for the next refresh ({@link NextRefresh}), or cancels it while no widget is placed. */
    static void schedule(Context context, Snapshot snapshot, long now) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent tick = PendingIntent.getBroadcast(context, 0,
            new Intent(context, WidgetsReceiver.class).setAction(ACTION_TICK),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (count(context) == 0) {
            alarms.cancel(tick);
            return;
        }
        // Inexact and not waking the device: a widget is only seen with the screen on, and the
        // system draws pending changes then. No exact-alarm permission is involved.
        alarms.set(AlarmManager.RTC, NextRefresh.at(snapshot, now, TimeZone.getDefault()), tick);
    }

    static int requestCode(int widgetId, int slot) {
        return widgetId * SLOTS + slot;
    }

    /** The intent that opens the app with a widget's action; one per action, never a link (no data). */
    static Intent appIntent(Context context, String action) {
        return new Intent(context, MainActivity.class)
            .setAction(action)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /** A tap that opens the app: {@code action} with {@code extras}, unique to the widget and slot. */
    static PendingIntent open(Context context, int widgetId, int slot, String action, Bundle extras) {
        Intent intent = appIntent(context, action);
        if (extras != null) intent.putExtras(extras);
        return PendingIntent.getActivity(context, requestCode(widgetId, slot), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A tap that stays on the home screen (the month's arrows): a broadcast to {@link WidgetsReceiver}. */
    static PendingIntent broadcast(Context context, int widgetId, int slot, String action) {
        Intent intent = new Intent(context, WidgetsReceiver.class)
            .setAction(action)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        return PendingIntent.getBroadcast(context, requestCode(widgetId, slot), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * The template for the taps on a list's rows. Each row fills in its own
     * action and extras ({@link WidgetAction}), which the system allows only
     * into a mutable pending intent; the documented exception to immutable
     * ones. It names the activity explicitly, so a fill-in can change what
     * the app is told, never which app is started.
     */
    static PendingIntent listTemplate(Context context, int widgetId) {
        Intent intent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int mutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        return PendingIntent.getActivity(context, requestCode(widgetId, SLOT_LIST), intent, mutable | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
