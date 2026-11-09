package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

import pl.patrykpro.calendar.R;

/**
 * The rows of the Agenda and Tasks widgets. The launcher binds this service
 * (only the system may: BIND_REMOTEVIEWS) and asks the factory for the rows
 * one by one as the list scrolls.
 *
 * The factory works out its rows when the list is (re)loaded
 * ({@link Factory#onDataSetChanged}, on a binder thread, where reading the
 * snapshot may take its moment) and draws each when asked. A tap on a row is
 * the list's template ({@link Widgets#listTemplate}) filled in with the row's
 * action and item.
 */
public class WidgetListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        WidgetKind kind = WidgetKind.TASKS.name().equals(intent.getStringExtra(Widgets.EXTRA_KIND)) ? WidgetKind.TASKS : WidgetKind.AGENDA;
        return new Factory(getApplicationContext(), id, kind);
    }

    static final class Factory implements RemoteViewsFactory {
        /** The row layouts, which the list keeps apart when it reuses views. */
        private static final int TYPES = 4;

        private final Context context;
        private final int id;
        private final WidgetKind kind;

        private List<Agenda.Row> agenda = Collections.emptyList();
        private List<TaskRows.Row> tasks = Collections.emptyList();
        private boolean tasksCut;
        private Labels labels;
        private Context localized;
        private Look look = Look.of(WidgetOptions.THEME_SYSTEM);
        private WidgetOptions options = new WidgetOptions();
        private int today;

        Factory(Context context, int id, WidgetKind kind) {
            this.context = context;
            this.id = id;
            this.kind = kind;
        }

        @Override
        public void onCreate() {
            // The rows are worked out in onDataSetChanged, which the list calls right after.
        }

        @Override
        public void onDataSetChanged() {
            Snapshot snapshot = Widgets.snapshot(context);
            if (snapshot == null || id == AppWidgetManager.INVALID_APPWIDGET_ID) {
                agenda = Collections.emptyList();
                tasks = Collections.emptyList();
                tasksCut = false;
                return;
            }
            long now = System.currentTimeMillis();
            TimeZone zone = TimeZone.getDefault();
            options = Widgets.options(context).options(id);
            look = Look.of(options.theme);
            localized = Texts.localized(context, snapshot.lang);
            labels = Texts.labels(localized, snapshot.lang, snapshot.hour12);
            today = Days.dayOf(now, zone);
            if (kind == WidgetKind.AGENDA) {
                agenda = new ArrayList<>(Agenda.build(snapshot, options, now, zone).rows);
            } else {
                TaskRows.Result result = TaskRows.build(snapshot, options, now, zone);
                tasks = new ArrayList<>(result.rows);
                tasksCut = result.cut;
            }
        }

        @Override
        public void onDestroy() {
            agenda = Collections.emptyList();
            tasks = Collections.emptyList();
        }

        @Override
        public int getCount() {
            if (kind == WidgetKind.AGENDA) return agenda.size();
            // Past the snapshot's window even an empty list is not known to be empty: the quiet line alone.
            return tasks.size() + (tasksCut ? 1 : 0);
        }

        @Override
        public RemoteViews getViewAt(int position) {
            try {
                if (kind == WidgetKind.AGENDA) {
                    if (position >= agenda.size()) return getLoadingView();
                    return agendaRow(agenda.get(position));
                }
                if (position >= tasks.size()) return position == tasks.size() && tasksCut ? note() : getLoadingView();
                return taskRow(tasks.get(position));
            } catch (RuntimeException e) {
                // Rows changed under the list between its count and this call; it asks again.
                return getLoadingView();
            }
        }

        @Override
        public RemoteViews getLoadingView() {
            return new RemoteViews(context.getPackageName(), R.layout.widget_row_loading);
        }

        @Override
        public int getViewTypeCount() {
            return TYPES;
        }

        @Override
        public long getItemId(int position) {
            if (kind == WidgetKind.AGENDA) return position < agenda.size() ? agenda.get(position).stableId() : -1 - position;
            return position < tasks.size() ? tasks.get(position).stableId() : -1 - position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        private RemoteViews agendaRow(Agenda.Row row) {
            switch (row.type) {
                case Agenda.HEADER:
                    return dayRow(row.day);
                case Agenda.EVENT:
                    return eventRow(row.item);
                case Agenda.TASK:
                    return agendaTaskRow(row.item);
                default:
                    return note();
            }
        }

        private RemoteViews dayRow(int day) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_row_day);
            boolean isToday = day == today;
            int shown = isToday ? R.id.row_day_today : R.id.row_day;
            views.setViewVisibility(R.id.row_day_today, isToday ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.row_day, isToday ? View.GONE : View.VISIBLE);
            views.setTextViewText(shown, labels.dayHeader(day, today));
            if (isToday) look.accent(views, shown);
            else look.weak(views, shown);
            Intent fill = new Intent()
                .setAction(WidgetAction.OPEN)
                .putExtra(WidgetAction.EXTRA_DAY, Days.format(day))
                .putExtra(WidgetAction.EXTRA_VIEW, WidgetAction.VIEW_DAY);
            views.setOnClickFillInIntent(R.id.row_root, fill);
            return views;
        }

        private RemoteViews eventRow(Agenda.Item item) {
            Snapshot.Event e = item.event;
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_row_event);
            views.setInt(R.id.row_bar, "setColorFilter", e.color);
            views.setTextViewText(R.id.row_title, e.title);
            look.text(views, R.id.row_title);
            String meta = labels.eventTime(item);
            if (options.place && e.place != null) meta = meta + " · " + e.place;
            views.setTextViewText(R.id.row_meta, meta);
            look.weak(views, R.id.row_meta);
            Intent fill = new Intent()
                .setAction(WidgetAction.EVENT)
                .putExtra(WidgetAction.EXTRA_CAL, e.cal)
                .putExtra(WidgetAction.EXTRA_KEY, e.key);
            if (e.allDay) fill.putExtra(WidgetAction.EXTRA_DAY, Days.format(e.day));
            else fill.putExtra(WidgetAction.EXTRA_START, e.start);
            views.setOnClickFillInIntent(R.id.row_root, fill);
            return views;
        }

        private RemoteViews agendaTaskRow(Agenda.Item item) {
            return taskViews(item.task, labels.agendaTask(item, today), item.overdue);
        }

        private RemoteViews taskRow(TaskRows.Row row) {
            return taskViews(row.task, labels.due(row, today), row.overdue);
        }

        private RemoteViews taskViews(Snapshot.Task task, String due, boolean overdue) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_row_task);
            views.setInt(R.id.row_check, "setColorFilter", task.color);
            views.setContentDescription(R.id.row_check, localized.getString(R.string.widget_mark_done));
            views.setTextViewText(R.id.row_title, task.title);
            look.text(views, R.id.row_title);
            int shown = overdue ? R.id.row_due_overdue : R.id.row_due;
            int hidden = overdue ? R.id.row_due : R.id.row_due_overdue;
            views.setViewVisibility(hidden, View.GONE);
            views.setViewVisibility(shown, due.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(shown, due);
            if (overdue) look.accent(views, shown);
            else look.weak(views, shown);
            views.setOnClickFillInIntent(R.id.row_root, new Intent()
                .setAction(WidgetAction.TASK)
                .putExtra(WidgetAction.EXTRA_CAL, task.cal)
                .putExtra(WidgetAction.EXTRA_KEY, task.key));
            views.setOnClickFillInIntent(R.id.row_check, new Intent()
                .setAction(WidgetAction.TASK_DONE)
                .putExtra(WidgetAction.EXTRA_CAL, task.cal)
                .putExtra(WidgetAction.EXTRA_KEY, task.key));
            return views;
        }

        private RemoteViews note() {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_row_note);
            views.setTextViewText(R.id.row_note, localized != null ? localized.getString(R.string.widget_refresh) : "");
            look.weak(views, R.id.row_note);
            Intent fill = new Intent().setAction(WidgetAction.OPEN);
            views.setOnClickFillInIntent(R.id.row_note, fill);
            return views;
        }
    }
}
