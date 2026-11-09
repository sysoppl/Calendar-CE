package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;

/** The four widgets, each with its provider (the receiver the launcher knows it by). */
enum WidgetKind {
    AGENDA(AgendaWidget.class),
    TODAY(TodayWidget.class),
    MONTH(MonthWidget.class),
    TASKS(TasksWidget.class);

    final Class<? extends AppWidgetProvider> provider;

    WidgetKind(Class<? extends AppWidgetProvider> provider) {
        this.provider = provider;
    }

    /** Whether the widget lists its rows through {@link WidgetListService}. */
    boolean isList() {
        return this == AGENDA || this == TASKS;
    }

    /** The kind of a provider, or null for one that is not this app's. */
    static WidgetKind of(ComponentName provider, String packageName) {
        if (provider == null || !packageName.equals(provider.getPackageName())) return null;
        for (WidgetKind kind : values()) {
            if (kind.provider.getName().equals(provider.getClassName())) return kind;
        }
        return null;
    }
}
