package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/**
 * What the four widget providers share. The system tells a provider when a
 * widget is placed or updated, resized, and removed; each of those draws the
 * widgets concerned again off the main thread ({@link Widgets#async}) and,
 * where widgets came or went, tells a running app ({@link Widgets#noteChange}).
 *
 * {@code updatePeriodMillis} in the providers' XML is a slow safety net
 * (every 6 hours) in case the refresh alarm got lost (a crash between
 * drawing and setting the next one); the alarm itself keeps the widgets
 * current ({@link NextRefresh}).
 */
abstract class BaseWidget extends AppWidgetProvider {
    abstract WidgetKind kind();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Context app = context.getApplicationContext();
        WidgetKind kind = kind();
        int[] which = ids == null ? new int[0] : ids.clone();
        Widgets.async(goAsync(), () -> {
            Widgets.refresh(app, kind, which);
            Widgets.noteChange(app);
        });
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle newOptions) {
        Context app = context.getApplicationContext();
        WidgetKind kind = kind();
        Widgets.async(goAsync(), () -> Widgets.refresh(app, kind, new int[] {id}));
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        Context app = context.getApplicationContext();
        int[] which = ids == null ? new int[0] : ids.clone();
        Widgets.async(goAsync(), () -> {
            OptionsStore store = Widgets.options(app);
            for (int id : which) store.forget(id);
            Widgets.noteChange(app);
            // The last one gone takes the alarm with it.
            Widgets.schedule(app, Widgets.snapshot(app), System.currentTimeMillis());
        });
    }

    @Override
    public void onEnabled(Context context) {
        Context app = context.getApplicationContext();
        Widgets.async(goAsync(), () -> Widgets.noteChange(app));
    }

    @Override
    public void onDisabled(Context context) {
        Context app = context.getApplicationContext();
        Widgets.async(goAsync(), () -> Widgets.noteChange(app));
    }
}
