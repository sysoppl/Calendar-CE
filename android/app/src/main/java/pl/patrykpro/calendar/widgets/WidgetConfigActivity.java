package pl.patrykpro.calendar.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import pl.patrykpro.calendar.R;

/**
 * The settings of one widget, for all four kinds: which calendars (or task
 * lists) it shows, and what else its kind offers (days ahead, tasks, the
 * place, tasks without a due date), its look and its background's opacity.
 *
 * The launcher opens it when a widget is placed (before Android 12; from 12
 * on the widget is placed with the defaults and this is reached through the
 * widget's settings), and again whenever the widget is to be changed: it
 * starts from the widget's current options. Save keeps them, draws the
 * widget again and answers RESULT_OK; leaving any other way answers
 * RESULT_CANCELED, which before Android 12 means the widget is not placed.
 *
 * The screen speaks the app's language (the snapshot's, kept in plain
 * preferences so it is known before the snapshot is decrypted) and follows
 * the system's light or dark mode, in the colours of the widgets. The
 * calendars come from the snapshot, read off the main thread; without one it
 * says that the app has to be opened once, and offers the choices that need
 * no names.
 *
 * It is exported, as the launcher has to start it, so any app could start it
 * with any widget id: an id that is not one of this app's widgets closes it
 * at once.
 */
public class WidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private WidgetKind kind;
    private WidgetOptions options;
    /** The calendars offered, by id, with their check boxes. */
    private final Map<String, CheckBox> boxes = new LinkedHashMap<>();
    private boolean saved;

    private RadioGroup modes;
    private LinearLayout calendarList;
    private TextView noCalendars;
    private RadioGroup days;
    private SwitchCompat tasks;
    private SwitchCompat place;
    private SwitchCompat undated;
    private RadioGroup themes;
    private SeekBar opacity;
    private TextView opacityValue;

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(Texts.localized(base, Widgets.options(base).lang()));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        widgetId = intent == null ? AppWidgetManager.INVALID_APPWIDGET_ID
            : intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        setResult(RESULT_CANCELED, answer());
        kind = kindOf(widgetId);
        if (kind == null) {
            finish();
            return;
        }
        options = Widgets.options(this).options(widgetId);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.widget_config);
        View root = findViewById(R.id.config_root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);

        bind();
        load();
    }

    /** The kind of a widget of this app, or null for any other id. */
    private WidgetKind kindOf(int id) {
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return null;
        try {
            AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id);
            return info == null ? null : WidgetKind.of(info.provider, getPackageName());
        } catch (RuntimeException e) {
            return null;
        }
    }

    private Intent answer() {
        return new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    }

    private int labelOf(WidgetKind kind) {
        switch (kind) {
            case AGENDA:
                return R.string.widget_agenda_label;
            case TODAY:
                return R.string.widget_today_label;
            case MONTH:
                return R.string.widget_month_label;
            default:
                return R.string.widget_tasks_label;
        }
    }

    private void bind() {
        boolean taskLists = kind == WidgetKind.TASKS;
        ((TextView) findViewById(R.id.config_kind)).setText(labelOf(kind));
        ((TextView) findViewById(R.id.config_calendars_label)).setText(taskLists ? R.string.widget_config_task_lists : R.string.widget_config_calendars);
        ((RadioButton) findViewById(R.id.config_mode_app)).setText(taskLists ? R.string.widget_config_same_as_app_lists : R.string.widget_config_same_as_app);
        ((RadioButton) findViewById(R.id.config_mode_all)).setText(taskLists ? R.string.widget_config_all_lists : R.string.widget_config_all_calendars);
        ((RadioButton) findViewById(R.id.config_mode_chosen)).setText(taskLists ? R.string.widget_config_choose_lists : R.string.widget_config_choose);

        modes = findViewById(R.id.config_calendar_mode);
        calendarList = findViewById(R.id.config_calendar_list);
        noCalendars = findViewById(R.id.config_no_calendars);
        modes.check(options.calendars == WidgetOptions.CALENDARS_ALL ? R.id.config_mode_all
            : options.calendars == WidgetOptions.CALENDARS_CHOSEN ? R.id.config_mode_chosen : R.id.config_mode_app);
        // "Choose" waits for the snapshot's calendars.
        findViewById(R.id.config_mode_chosen).setVisibility(View.GONE);
        modes.setOnCheckedChangeListener((group, checked) -> showList());

        days = findViewById(R.id.config_days);
        for (int choice : WidgetOptions.DAY_CHOICES) {
            RadioButton button = new RadioButton(this);
            button.setId(View.generateViewId());
            button.setTag(choice);
            button.setText(String.format(Locale.getDefault(), "%d", choice));
            button.setMinWidth(dp(56));
            days.addView(button);
            if (choice == options.days) days.check(button.getId());
        }

        tasks = findViewById(R.id.config_tasks);
        tasks.setChecked(options.tasks);
        place = findViewById(R.id.config_place);
        place.setChecked(options.place);
        undated = findViewById(R.id.config_undated);
        undated.setChecked(options.undated);

        boolean agenda = kind == WidgetKind.AGENDA;
        findViewById(R.id.config_days_label).setVisibility(agenda ? View.VISIBLE : View.GONE);
        days.setVisibility(agenda ? View.VISIBLE : View.GONE);
        tasks.setVisibility(agenda || kind == WidgetKind.TODAY ? View.VISIBLE : View.GONE);
        place.setVisibility(agenda ? View.VISIBLE : View.GONE);
        undated.setVisibility(taskLists ? View.VISIBLE : View.GONE);

        themes = findViewById(R.id.config_theme);
        themes.check(options.theme == WidgetOptions.THEME_LIGHT ? R.id.config_theme_light
            : options.theme == WidgetOptions.THEME_DARK ? R.id.config_theme_dark : R.id.config_theme_system);

        opacity = findViewById(R.id.config_opacity);
        opacityValue = findViewById(R.id.config_opacity_value);
        opacity.setMax(20);
        opacity.setProgress(Math.round(options.opacity / 5f));
        showOpacity();
        opacity.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                showOpacity();
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
            }
        });

        findViewById(R.id.config_cancel).setOnClickListener(v -> finish());
        findViewById(R.id.config_save).setOnClickListener(v -> save());
    }

    private void showOpacity() {
        opacityValue.setText(getString(R.string.widget_config_percent, opacity.getProgress() * 5));
    }

    /** Reads the snapshot's calendars off the main thread, then offers them. */
    private void load() {
        Context app = getApplicationContext();
        Widgets.WORK.execute(() -> {
            Snapshot snapshot = Widgets.snapshot(app);
            runOnUiThread(() -> {
                if (!isFinishing() && !isDestroyed()) showCalendars(snapshot);
            });
        });
    }

    private boolean offered(Snapshot.Calendar calendar) {
        if (kind == WidgetKind.TASKS) return calendar.tasks;
        if (kind == WidgetKind.MONTH) return calendar.events;
        return calendar.events || calendar.tasks;
    }

    private void showCalendars(Snapshot snapshot) {
        List<Snapshot.Calendar> calendars = new ArrayList<>();
        if (snapshot != null) {
            for (Snapshot.Calendar c : snapshot.calendars) {
                if (offered(c)) calendars.add(c);
            }
        }
        if (calendars.isEmpty()) {
            noCalendars.setVisibility(View.VISIBLE);
            if (modes.getCheckedRadioButtonId() == R.id.config_mode_chosen) modes.check(R.id.config_mode_app);
            return;
        }
        noCalendars.setVisibility(View.GONE);
        findViewById(R.id.config_mode_chosen).setVisibility(View.VISIBLE);
        // With nothing chosen yet, the choice starts from what the app shows.
        boolean fresh = options.chosen.isEmpty();
        for (Snapshot.Calendar c : calendars) {
            CheckBox box = new CheckBox(this);
            box.setText(c.name.isEmpty() ? c.id : c.name);
            box.setChecked(fresh ? c.visible : options.chosen.contains(c.id));
            box.setCompoundDrawablesRelativeWithIntrinsicBounds(dot(c.color), null, null, null);
            box.setCompoundDrawablePadding(dp(10));
            box.setMinHeight(dp(44));
            calendarList.addView(box);
            boxes.put(c.id, box);
        }
        showList();
    }

    private void showList() {
        calendarList.setVisibility(modes.getCheckedRadioButtonId() == R.id.config_mode_chosen && !boxes.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private GradientDrawable dot(int color) {
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(color);
        dot.setSize(dp(12), dp(12));
        return dot;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private void save() {
        if (saved) return;
        saved = true;
        WidgetOptions out = new WidgetOptions();
        int mode = modes.getCheckedRadioButtonId();
        if (mode == R.id.config_mode_all) out.calendars = WidgetOptions.CALENDARS_ALL;
        else if (mode == R.id.config_mode_chosen) out.calendars = WidgetOptions.CALENDARS_CHOSEN;
        for (Map.Entry<String, CheckBox> e : boxes.entrySet()) {
            if (e.getValue().isChecked()) out.chosen.add(e.getKey());
        }
        // Nothing ticked: the app's choice, as a widget that shows nothing is no one's intent.
        if (out.calendars == WidgetOptions.CALENDARS_CHOSEN && out.chosen.isEmpty()) out.calendars = WidgetOptions.CALENDARS_APP;
        // Kept for a later switch back to "choose" only while it is the choice.
        if (out.calendars != WidgetOptions.CALENDARS_CHOSEN) out.chosen.clear();
        View day = days.findViewById(days.getCheckedRadioButtonId());
        out.days = WidgetOptions.validDays(day != null && day.getTag() instanceof Integer ? (Integer) day.getTag() : options.days);
        out.tasks = tasks.isChecked();
        out.place = place.isChecked();
        out.undated = undated.isChecked();
        int theme = themes.getCheckedRadioButtonId();
        out.theme = theme == R.id.config_theme_light ? WidgetOptions.THEME_LIGHT
            : theme == R.id.config_theme_dark ? WidgetOptions.THEME_DARK : WidgetOptions.THEME_SYSTEM;
        out.opacity = opacity.getProgress() * 5;

        Context app = getApplicationContext();
        int id = widgetId;
        WidgetKind which = kind;
        Widgets.options(app).save(id, out);
        // Before Android 12 the widget is placed only now, and nothing else draws it.
        Widgets.WORK.execute(() -> {
            try {
                Widgets.refresh(app, which, new int[] {id});
                Widgets.noteChange(app);
            } catch (RuntimeException e) {
                // The widget keeps its last picture; the next refresh draws it.
            }
        });
        setResult(RESULT_OK, answer());
        finish();
    }
}
