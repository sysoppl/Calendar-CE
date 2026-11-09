package pl.patrykpro.calendar.widgets;

import pl.patrykpro.calendar.vault.KeyValues;

/**
 * The widgets' own small records, in a private preferences file of their own
 * (not the encrypted vault: nothing here is about the calendar's content):
 * - each widget's options, as set in its settings screen;
 * - which month a Month widget was moved to with its arrows, and on what day,
 *   so that the next day starts on the current month again;
 * - the widgets placed when the app last looked, so that a widget added or
 *   removed can be told to the app ({@link WidgetsPlugin}'s widgetsChanged);
 * - the snapshot's language, which the settings screen takes before it can
 *   read the encrypted snapshot.
 *
 * Everything per widget goes with {@link #forget} when the widget is removed.
 */
final class OptionsStore {
    private static final String OPTIONS = "options.";
    private static final String MONTH_OFFSET = "month.offset.";
    private static final String MONTH_DAY = "month.day.";
    private static final String PLACED = "placed";
    private static final String LANG = "lang";

    private final KeyValues values;

    OptionsStore(KeyValues values) {
        this.values = values;
    }

    /** The options of widget {@code id}; the defaults when it has none (yet). */
    WidgetOptions options(int id) {
        return WidgetOptions.fromJson(values.getString(OPTIONS + id));
    }

    boolean hasOptions(int id) {
        return values.getString(OPTIONS + id) != null;
    }

    void save(int id, WidgetOptions options) {
        values.putString(OPTIONS + id, options.toJson());
    }

    /** Removes everything kept for widget {@code id}. */
    void forget(int id) {
        values.remove(OPTIONS + id);
        values.remove(MONTH_OFFSET + id);
        values.remove(MONTH_DAY + id);
    }

    /**
     * How many months widget {@code id} was moved from the current one. It
     * holds only on the day it was set: from the next day on (or after the
     * clock went back) the widget is on the current month again.
     */
    int monthOffset(int id, int today) {
        if (values.getLong(MONTH_DAY + id, Long.MIN_VALUE) != today) return 0;
        long offset = values.getLong(MONTH_OFFSET + id, 0L);
        return offset >= -1200 && offset <= 1200 ? (int) offset : 0;
    }

    void setMonthOffset(int id, int offset, int today) {
        if (offset == 0) {
            values.remove(MONTH_OFFSET + id);
            values.remove(MONTH_DAY + id);
            return;
        }
        values.putLong(MONTH_OFFSET + id, offset);
        values.putLong(MONTH_DAY + id, today);
    }

    /** The placed widgets as last seen, in {@link Widgets#placedSignature}'s form; "" when none were seen. */
    String placed() {
        String placed = values.getString(PLACED);
        return placed == null ? "" : placed;
    }

    void setPlaced(String signature) {
        values.putString(PLACED, signature);
    }

    /** The snapshot's language, or null for the system's. */
    String lang() {
        return values.getString(LANG);
    }

    void setLang(String lang) {
        if (lang == null) values.remove(LANG);
        else values.putString(LANG, lang);
    }
}
