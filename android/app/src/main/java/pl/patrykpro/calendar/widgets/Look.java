package pl.patrykpro.calendar.widgets;

import android.widget.RemoteViews;

import pl.patrykpro.calendar.R;

/**
 * The colours of a widget: the app's two default themes, Daylight and
 * Graphite, as far as a widget needs them.
 *
 * "Follow the system" is the default and is not drawn here at all: the
 * layouts take their colours from resources with a night variant
 * (values/widget_colors.xml, values-night/widget_colors.xml), and the
 * launcher, which inflates the widget in its own process, picks the variant
 * that matches the system at that moment, also after a switch between light
 * and dark without the app running. A colour set from code would stay as it
 * was set.
 *
 * Light and Dark are fixed, so they are set from code on every view that
 * shows a theme colour; the constants are the same as the resources' (a unit
 * test holds them to it). Where a view's colour depends on its state (today,
 * overdue, a day of another month) the layouts carry one view per state, each
 * with its own resource colour, and the widget shows one of them: the same
 * trick works for both ways of drawing.
 */
final class Look {
    static final int LIGHT_GROUND = 0xFFFFFFFF;
    static final int LIGHT_TEXT = 0xFF1E2227;
    static final int LIGHT_WEAK = 0xFF5D646C;
    static final int LIGHT_DIM = 0x995D646C;
    static final int LIGHT_DIVIDER = 0xFFE3E3DF;
    static final int LIGHT_ACCENT = 0xFFD93033;
    static final int LIGHT_ON_ACCENT = 0xFFFFFFFF;

    static final int DARK_GROUND = 0xFF1A1C1F;
    static final int DARK_TEXT = 0xFFECE7DE;
    static final int DARK_WEAK = 0xFFA3A9B0;
    static final int DARK_DIM = 0x99A3A9B0;
    static final int DARK_DIVIDER = 0xFF2C2F33;
    static final int DARK_ACCENT = 0xFFF2B134;
    static final int DARK_ON_ACCENT = 0xFF1A1C1F;

    /** Whether colours are set from code (Light, Dark) rather than taken from the resources (the system's). */
    final boolean fixed;
    final boolean dark;
    final int ground;
    final int text;
    final int weak;
    final int dim;
    final int divider;
    final int accent;
    final int onAccent;

    private Look(boolean fixed, boolean dark) {
        this.fixed = fixed;
        this.dark = dark;
        ground = dark ? DARK_GROUND : LIGHT_GROUND;
        text = dark ? DARK_TEXT : LIGHT_TEXT;
        weak = dark ? DARK_WEAK : LIGHT_WEAK;
        dim = dark ? DARK_DIM : LIGHT_DIM;
        divider = dark ? DARK_DIVIDER : LIGHT_DIVIDER;
        accent = dark ? DARK_ACCENT : LIGHT_ACCENT;
        onAccent = dark ? DARK_ON_ACCENT : LIGHT_ON_ACCENT;
    }

    static Look of(int theme) {
        if (theme == WidgetOptions.THEME_LIGHT) return new Look(true, false);
        if (theme == WidgetOptions.THEME_DARK) return new Look(true, true);
        return new Look(false, false);
    }

    /** The rounded background: its colour (fixed looks) and the chosen opacity (always). */
    void background(RemoteViews views, int id, int alpha) {
        if (fixed) views.setInt(id, "setColorFilter", ground);
        views.setInt(id, "setImageAlpha", alpha);
    }

    void text(RemoteViews views, int id) {
        if (fixed) views.setTextColor(id, text);
    }

    void weak(RemoteViews views, int id) {
        if (fixed) views.setTextColor(id, weak);
    }

    void dim(RemoteViews views, int id) {
        if (fixed) views.setTextColor(id, dim);
    }

    void accent(RemoteViews views, int id) {
        if (fixed) views.setTextColor(id, accent);
    }

    void onAccent(RemoteViews views, int id) {
        if (fixed) views.setTextColor(id, onAccent);
    }

    /** An icon drawn in the ink of the theme ("+", the arrows). */
    void icon(RemoteViews views, int id) {
        if (fixed) views.setInt(id, "setColorFilter", text);
    }

    /** A divider line (an image of a thin bar). */
    void divider(RemoteViews views, int id) {
        if (fixed) views.setInt(id, "setColorFilter", divider);
    }

    /** The filled circle that marks today in the month: the resource one follows the system. */
    int todayCircle() {
        if (!fixed) return R.drawable.widget_today_circle;
        return dark ? R.drawable.widget_today_circle_dark : R.drawable.widget_today_circle_light;
    }
}
