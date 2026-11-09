package pl.patrykpro.calendar.widgets;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * What one placed widget was set to show, in its settings screen
 * ({@link WidgetConfigActivity}). A widget nobody configured, or one added
 * with the defaults (Android 12 and later add it straight away), has the
 * defaults below, which make sense for every kind: the calendars the app
 * shows, a week ahead, tasks included, the system's light or dark look.
 *
 * Stored as a small JSON text per widget ({@link OptionsStore}); a stored
 * value that cannot be read, or a field out of range, falls back to its
 * default rather than to an error.
 */
final class WidgetOptions {
    /** The calendars the app shows: those not hidden there. */
    static final int CALENDARS_APP = 0;
    /** Every calendar of the snapshot, hidden ones too. */
    static final int CALENDARS_ALL = 1;
    /** The ones in {@link #chosen}. */
    static final int CALENDARS_CHOSEN = 2;

    static final int THEME_SYSTEM = 0;
    static final int THEME_LIGHT = 1;
    static final int THEME_DARK = 2;

    /** How far the agenda reaches, in days from today on. */
    static final int[] DAY_CHOICES = {1, 3, 7, 14, 31};
    static final int DEFAULT_DAYS = 7;

    /** At most this many chosen calendars are kept; a snapshot carries at most {@link Snapshot#MAX_CALENDARS}. */
    private static final int MAX_CHOSEN = Snapshot.MAX_CALENDARS;

    int calendars = CALENDARS_APP;
    final Set<String> chosen = new LinkedHashSet<>();
    /** Agenda: days ahead, today included. */
    int days = DEFAULT_DAYS;
    /** Agenda and Today: tasks with a due date among the events. */
    boolean tasks = true;
    /** Agenda: the place under the title. */
    boolean place = true;
    /** Tasks: those without a due date too. */
    boolean undated = true;
    int theme = THEME_SYSTEM;
    /** The background's opacity, 0-100 %. */
    int opacity = 100;

    /**
     * Whether items of calendar {@code id} are shown. With the app's choice, a
     * calendar the snapshot does not name is shown (the web app put its items
     * in, so it shows them); a chosen set left empty means the app's choice,
     * since a widget that can never show anything is no one's intent.
     */
    boolean shows(String id, Snapshot snapshot) {
        if (calendars == CALENDARS_ALL) return true;
        if (calendars == CALENDARS_CHOSEN && !chosen.isEmpty()) return chosen.contains(id);
        Snapshot.Calendar calendar = snapshot.calendar(id);
        return calendar == null || calendar.visible;
    }

    /** The background's opacity as an alpha, 0-255. */
    int alpha() {
        return Math.round(Math.max(0, Math.min(100, opacity)) * 255f / 100f);
    }

    String toJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("calendars", calendars);
            if (!chosen.isEmpty()) {
                JSONArray ids = new JSONArray();
                for (String id : chosen) ids.put(id);
                o.put("chosen", ids);
            }
            o.put("days", days);
            o.put("tasks", tasks);
            o.put("place", place);
            o.put("undated", undated);
            o.put("theme", theme);
            o.put("opacity", opacity);
            return o.toString();
        } catch (JSONException e) {
            // Only for numbers that are not finite, which none of these are.
            return "{}";
        }
    }

    /** The options in {@code json}; the defaults for anything missing or wrong, all of them for null. */
    static WidgetOptions fromJson(String json) {
        WidgetOptions options = new WidgetOptions();
        if (json == null) return options;
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (JSONException e) {
            return options;
        }
        int calendars = o.optInt("calendars", CALENDARS_APP);
        options.calendars = calendars >= CALENDARS_APP && calendars <= CALENDARS_CHOSEN ? calendars : CALENDARS_APP;
        JSONArray ids = o.optJSONArray("chosen");
        for (int i = 0; ids != null && i < ids.length() && options.chosen.size() < MAX_CHOSEN; i++) {
            Object id = ids.opt(i);
            if (id instanceof String && !((String) id).isEmpty() && ((String) id).length() <= Snapshot.MAX_ID) options.chosen.add((String) id);
        }
        options.days = validDays(o.optInt("days", DEFAULT_DAYS));
        options.tasks = o.optBoolean("tasks", true);
        options.place = o.optBoolean("place", true);
        options.undated = o.optBoolean("undated", true);
        int theme = o.optInt("theme", THEME_SYSTEM);
        options.theme = theme >= THEME_SYSTEM && theme <= THEME_DARK ? theme : THEME_SYSTEM;
        options.opacity = Math.max(0, Math.min(100, o.optInt("opacity", 100)));
        return options;
    }

    /** One of {@link #DAY_CHOICES}, else the default. */
    static int validDays(int days) {
        for (int choice : DAY_CHOICES) {
            if (choice == days) return days;
        }
        return DEFAULT_DAYS;
    }
}
