package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.TimeZone;

/**
 * The widgets' own broadcasts: the refresh alarm ({@link Widgets#schedule})
 * and the Month widget's arrows and title. Not exported, so only this app's
 * pending intents get here.
 */
public class WidgetsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        Context app = context.getApplicationContext();
        String action = intent.getAction();
        if (Widgets.ACTION_TICK.equals(action)) {
            Widgets.async(goAsync(), () -> Widgets.refreshAll(app));
            return;
        }
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        int step = Widgets.ACTION_MONTH_PREV.equals(action) ? -1 : Widgets.ACTION_MONTH_NEXT.equals(action) ? 1 : 0;
        boolean back = Widgets.ACTION_MONTH_TODAY.equals(action);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID || (step == 0 && !back)) return;
        Widgets.async(goAsync(), () -> {
            Snapshot snapshot = Widgets.snapshot(app);
            if (snapshot == null) return;
            OptionsStore store = Widgets.options(app);
            int today = Days.dayOf(System.currentTimeMillis(), TimeZone.getDefault());
            int wanted = back ? 0 : store.monthOffset(id, today) + step;
            store.setMonthOffset(id, MonthGrid.clamp(today, wanted, snapshot.weekStart, snapshot.from, snapshot.until), today);
            Widgets.refresh(app, WidgetKind.MONTH, new int[] {id});
        });
    }
}
