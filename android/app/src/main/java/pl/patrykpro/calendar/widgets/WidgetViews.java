package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Locale;
import java.util.TimeZone;

import pl.patrykpro.calendar.R;

/**
 * The pictures of the widgets ({@link RemoteViews}), drawn from the snapshot,
 * the widget's options and the time.
 *
 * Every text comes from here, in the snapshot's language; the layouts carry
 * none of their own, as the launcher would inflate those in the phone's
 * language. Lists (Agenda, Tasks) get only their frame here; their rows come
 * from {@link WidgetListService}.
 */
final class WidgetViews {
    private static final int[] TODAY_ROWS = {R.id.widget_row0, R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4};
    private static final int[] TODAY_DOTS = {R.id.widget_dot0, R.id.widget_dot1, R.id.widget_dot2, R.id.widget_dot3, R.id.widget_dot4};
    private static final int[] TODAY_TIMES = {R.id.widget_time0, R.id.widget_time1, R.id.widget_time2, R.id.widget_time3, R.id.widget_time4};
    private static final int[] TODAY_TITLES = {R.id.widget_title0, R.id.widget_title1, R.id.widget_title2, R.id.widget_title3, R.id.widget_title4};
    private static final int[] WEEKDAYS = {R.id.widget_wd0, R.id.widget_wd1, R.id.widget_wd2, R.id.widget_wd3, R.id.widget_wd4, R.id.widget_wd5, R.id.widget_wd6};
    private static final int[] WEEKS = {R.id.widget_week0, R.id.widget_week1, R.id.widget_week2, R.id.widget_week3, R.id.widget_week4, R.id.widget_week5};

    private WidgetViews() {}

    static RemoteViews build(Context context, WidgetKind kind, int id, Snapshot snapshot, OptionsStore store, long now, TimeZone zone) {
        WidgetOptions options = store.options(id);
        if (snapshot == null) return message(context, id, options);
        Context localized = Texts.localized(context, snapshot.lang);
        Labels labels = Texts.labels(localized, snapshot.lang, snapshot.hour12);
        switch (kind) {
            case AGENDA:
                return agenda(context, localized, labels, id, snapshot, options, now, zone);
            case TODAY:
                return today(context, localized, labels, id, snapshot, options, now, zone);
            case MONTH:
                return month(context, localized, labels, id, snapshot, options, store, now, zone);
            default:
                return tasks(context, localized, id, snapshot, options, now, zone);
        }
    }

    /** No snapshot yet: one line asking for the app, which pushes one when it runs. */
    static RemoteViews message(Context context, int id, WidgetOptions options) {
        Context localized = Texts.localized(context, Widgets.options(context).lang());
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_message);
        Look look = Look.of(options.theme);
        look.background(views, R.id.widget_bg, options.alpha());
        views.setTextViewText(R.id.widget_message, localized.getString(R.string.widget_no_data));
        look.weak(views, R.id.widget_message);
        views.setOnClickPendingIntent(R.id.widget_message, Widgets.open(context, id, Widgets.SLOT_MESSAGE, WidgetAction.OPEN, null));
        return views;
    }

    private static Bundle day(int day) {
        Bundle extras = new Bundle();
        extras.putString(WidgetAction.EXTRA_DAY, Days.format(day));
        return extras;
    }

    private static Bundle dayView(int day, String view) {
        Bundle extras = day(day);
        extras.putString(WidgetAction.EXTRA_VIEW, view);
        return extras;
    }

    /** The service intent of a list, one per widget: its data makes it unique, so lists do not share a factory. */
    private static Intent listService(Context context, int id, WidgetKind kind) {
        Intent intent = new Intent(context, WidgetListService.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(Widgets.EXTRA_KIND, kind.name());
        intent.setData(Uri.parse(intent.toUri(Intent.URI_INTENT_SCHEME)));
        return intent;
    }

    @SuppressWarnings("deprecation")
    private static void attachList(Context context, RemoteViews views, int id, WidgetKind kind) {
        views.setRemoteAdapter(R.id.widget_list, listService(context, id, kind));
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);
        views.setPendingIntentTemplate(R.id.widget_list, Widgets.listTemplate(context, id));
    }

    private static RemoteViews agenda(Context context, Context localized, Labels labels, int id, Snapshot snapshot, WidgetOptions options, long now, TimeZone zone) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_agenda);
        Look look = Look.of(options.theme);
        look.background(views, R.id.widget_bg, options.alpha());
        int today = Days.dayOf(now, zone);
        views.setTextViewText(R.id.widget_title, labels.weekday(today));
        look.text(views, R.id.widget_title);
        views.setTextViewText(R.id.widget_subtitle, labels.longDate(today));
        look.weak(views, R.id.widget_subtitle);
        look.icon(views, R.id.widget_add);
        look.divider(views, R.id.widget_divider);
        views.setContentDescription(R.id.widget_add, localized.getString(R.string.widget_new_event));
        views.setOnClickPendingIntent(R.id.widget_header, Widgets.open(context, id, Widgets.SLOT_OPEN, WidgetAction.OPEN, day(today)));
        views.setOnClickPendingIntent(R.id.widget_add, Widgets.open(context, id, Widgets.SLOT_ADD, WidgetAction.NEW_EVENT, null));
        String empty = options.days == 1
            ? localized.getString(R.string.widget_nothing_else_today)
            : localized.getResources().getQuantityString(R.plurals.widget_nothing_planned, options.days, options.days);
        views.setTextViewText(R.id.widget_empty, empty);
        look.weak(views, R.id.widget_empty);
        attachList(context, views, id, WidgetKind.AGENDA);
        return views;
    }

    private static RemoteViews today(Context context, Context localized, Labels labels, int id, Snapshot snapshot, WidgetOptions options, long now, TimeZone zone) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        Look look = Look.of(options.theme);
        look.background(views, R.id.widget_bg, options.alpha());
        int today = Days.dayOf(now, zone);
        views.setTextViewText(R.id.widget_day_number, String.format(labels.locale, "%d", Days.dayOfMonth(today)));
        look.accent(views, R.id.widget_day_number);
        views.setTextViewText(R.id.widget_weekday, labels.weekday(today));
        look.text(views, R.id.widget_weekday);
        views.setTextViewText(R.id.widget_month_name, labels.monthName(today));
        look.weak(views, R.id.widget_month_name);

        TodayPick pick = TodayPick.pick(snapshot, options, now, zone, TodayPick.rowsFor(heightDp(context, id)));
        for (int i = 0; i < TODAY_ROWS.length; i++) {
            if (i >= pick.today.size()) {
                views.setViewVisibility(TODAY_ROWS[i], View.GONE);
                continue;
            }
            Agenda.Item item = pick.today.get(i);
            views.setViewVisibility(TODAY_ROWS[i], View.VISIBLE);
            views.setImageViewResource(TODAY_DOTS[i], item.task != null ? R.drawable.widget_ring : R.drawable.widget_dot);
            views.setInt(TODAY_DOTS[i], "setColorFilter", item.color());
            String time = labels.shortTime(item);
            views.setTextViewText(TODAY_TIMES[i], time);
            views.setViewVisibility(TODAY_TIMES[i], time.isEmpty() ? View.GONE : View.VISIBLE);
            look.weak(views, TODAY_TIMES[i]);
            views.setTextViewText(TODAY_TITLES[i], item.title());
            look.text(views, TODAY_TITLES[i]);
        }
        views.setTextViewText(R.id.widget_more, pick.more > 0 ? String.format(labels.locale, "+%d", pick.more) : "");
        views.setViewVisibility(R.id.widget_more, pick.more > 0 ? View.VISIBLE : View.GONE);
        look.weak(views, R.id.widget_more);

        boolean nothing = pick.covered && pick.today.isEmpty();
        views.setViewVisibility(R.id.widget_nothing, nothing ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_nothing, localized.getString(R.string.widget_nothing_else_today));
        look.weak(views, R.id.widget_nothing);
        if (pick.tomorrow != null) {
            String time = labels.shortTime(pick.tomorrow);
            String what = time.isEmpty() ? pick.tomorrow.title() : time + " " + pick.tomorrow.title();
            views.setTextViewText(R.id.widget_tomorrow, localized.getString(R.string.widget_tomorrow_item, what));
            views.setViewVisibility(R.id.widget_tomorrow, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.widget_tomorrow, View.GONE);
        }
        look.text(views, R.id.widget_tomorrow);
        note(views, localized, look, pick.cut);
        views.setOnClickPendingIntent(R.id.widget_frame, Widgets.open(context, id, Widgets.SLOT_OPEN, WidgetAction.OPEN, day(today)));
        return views;
    }

    /**
     * The widget's height as the launcher reports it: the portrait one on a
     * phone held upright, the landscape one otherwise; 0 when not known.
     */
    private static int heightDp(Context context, int id) {
        try {
            Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id);
            if (options == null) return 0;
            boolean landscape = context.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            return options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static RemoteViews month(Context context, Context localized, Labels labels, int id, Snapshot snapshot, WidgetOptions options, OptionsStore store, long now, TimeZone zone) {
        String pkg = context.getPackageName();
        RemoteViews views = new RemoteViews(pkg, R.layout.widget_month);
        Look look = Look.of(options.theme);
        look.background(views, R.id.widget_bg, options.alpha());
        int today = Days.dayOf(now, zone);
        MonthGrid grid = MonthGrid.build(snapshot, options, today, store.monthOffset(id, today), zone);

        views.setTextViewText(R.id.widget_title, labels.monthTitle(grid.month));
        look.text(views, R.id.widget_title);
        // The title goes back to this month from another one, and opens the app on today from this one.
        views.setOnClickPendingIntent(R.id.widget_title, grid.offset != 0
            ? Widgets.broadcast(context, id, Widgets.SLOT_TITLE, Widgets.ACTION_MONTH_TODAY)
            : Widgets.open(context, id, Widgets.SLOT_TITLE, WidgetAction.OPEN, day(today)));
        arrow(context, views, look, id, R.id.widget_prev, grid.canPrev, Widgets.SLOT_PREV, Widgets.ACTION_MONTH_PREV, localized.getString(R.string.widget_previous_month));
        arrow(context, views, look, id, R.id.widget_next, grid.canNext, Widgets.SLOT_NEXT, Widgets.ACTION_MONTH_NEXT, localized.getString(R.string.widget_next_month));
        look.icon(views, R.id.widget_add);
        views.setContentDescription(R.id.widget_add, localized.getString(R.string.widget_new_event));
        views.setOnClickPendingIntent(R.id.widget_add, Widgets.open(context, id, Widgets.SLOT_ADD, WidgetAction.NEW_EVENT, null));

        String[] initials = Texts.weekInitials(labels.locale);
        for (int i = 0; i < 7; i++) {
            views.setTextViewText(WEEKDAYS[i], initials[(snapshot.weekStart + i) % 7]);
            look.weak(views, WEEKDAYS[i]);
        }
        for (int week = 0; week < MonthGrid.WEEKS; week++) {
            views.removeAllViews(WEEKS[week]);
            for (int d = 0; d < 7; d++) {
                int index = week * 7 + d;
                views.addView(WEEKS[week], cell(context, labels.locale, look, id, index, grid.cells[index]));
            }
        }
        note(views, localized, look, grid.cut);
        return views;
    }

    private static void arrow(Context context, RemoteViews views, Look look, int id, int view, boolean enabled, int slot, String action, String description) {
        look.icon(views, view);
        views.setContentDescription(view, description);
        // Hidden but in place, so the title does not move when an arrow comes and goes.
        views.setViewVisibility(view, enabled ? View.VISIBLE : View.INVISIBLE);
        if (enabled) views.setOnClickPendingIntent(view, Widgets.broadcast(context, id, slot, action));
    }

    private static RemoteViews cell(Context context, Locale locale, Look look, int id, int index, MonthGrid.Cell cell) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_month_cell);
        String number = String.format(locale, "%d", cell.dayOfMonth);
        int shown = cell.today ? R.id.cell_num_today : cell.inMonth ? R.id.cell_num : R.id.cell_num_dim;
        for (int view : new int[] {R.id.cell_num, R.id.cell_num_dim, R.id.cell_num_today}) {
            views.setViewVisibility(view, view == shown ? View.VISIBLE : View.GONE);
        }
        views.setTextViewText(shown, number);
        if (cell.today) {
            look.onAccent(views, shown);
            if (look.fixed) views.setInt(shown, "setBackgroundResource", look.todayCircle());
        } else if (cell.inMonth) {
            look.text(views, shown);
        } else {
            look.dim(views, shown);
        }
        views.setTextViewText(R.id.cell_dots, dots(cell.dots));
        views.setOnClickPendingIntent(R.id.cell_root, Widgets.open(context, id, Widgets.SLOT_CELLS + index, WidgetAction.OPEN, dayView(cell.day, WidgetAction.VIEW_DAY)));
        return views;
    }

    /** "•••" with each dot in its event's colour. */
    static CharSequence dots(int[] colors) {
        SpannableStringBuilder out = new SpannableStringBuilder();
        for (int color : colors) {
            int at = out.length();
            out.append('•');
            out.setSpan(new ForegroundColorSpan(color), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return out;
    }

    private static RemoteViews tasks(Context context, Context localized, int id, Snapshot snapshot, WidgetOptions options, long now, TimeZone zone) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        Look look = Look.of(options.theme);
        look.background(views, R.id.widget_bg, options.alpha());
        views.setTextViewText(R.id.widget_title, localized.getString(R.string.widget_tasks_title));
        look.text(views, R.id.widget_title);
        look.icon(views, R.id.widget_add);
        look.divider(views, R.id.widget_divider);
        views.setContentDescription(R.id.widget_add, localized.getString(R.string.widget_new_task));
        Bundle tasksView = new Bundle();
        tasksView.putString(WidgetAction.EXTRA_VIEW, WidgetAction.VIEW_TASKS);
        views.setOnClickPendingIntent(R.id.widget_header, Widgets.open(context, id, Widgets.SLOT_OPEN, WidgetAction.OPEN, tasksView));
        views.setOnClickPendingIntent(R.id.widget_add, Widgets.open(context, id, Widgets.SLOT_ADD, WidgetAction.NEW_TASK, null));
        views.setTextViewText(R.id.widget_empty, localized.getString(R.string.widget_no_tasks));
        look.weak(views, R.id.widget_empty);
        attachList(context, views, id, WidgetKind.TASKS);
        return views;
    }

    /** The quiet "Open the app to refresh" line, when part of what the widget would show is not in the snapshot. */
    private static void note(RemoteViews views, Context localized, Look look, boolean shown) {
        views.setViewVisibility(R.id.widget_note, shown ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_note, localized.getString(R.string.widget_refresh));
        look.weak(views, R.id.widget_note);
    }
}
