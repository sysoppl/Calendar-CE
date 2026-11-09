package pl.patrykpro.calendar.widgets;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

/**
 * What the home screen widgets show, as the web app last handed it over.
 *
 * The calendars live in the WebView's own storage, which native code cannot
 * read, so the web app works out a window of days (a few weeks back, several
 * months ahead) and pushes it through the Widgets plugin
 * ({@link WidgetsPlugin#setSnapshot}). The widgets draw only from this: what
 * lies outside {@link #from} .. {@link #until} is unknown to them, and they say
 * so instead of showing an empty day.
 *
 * The web app is trusted to send what it means, but not to be bug-free or of
 * the same version: the parser takes what it can use, leaves out an entry it
 * cannot read (one event with a broken date costs that event, never the
 * widget), ignores fields it does not know, caps the counts and lengths, and
 * never throws. Texts are what the app shows already, translated (a hidden
 * event arrives as "Hidden event"), and colours are already resolved to the
 * event's own or its calendar's.
 *
 * The form (version 1):
 * <pre>
 * { "v": 1, "made": ms, "from": "YYYY-MM-DD", "until": "YYYY-MM-DD" (exclusive),
 *   "lang": "pl", "hour12": false, "weekStart": 1,
 *   "calendars": [ { "id", "name", "color", "events", "tasks", "visible" } ],
 *   "events": [ { "cal", "key", "title", "place"?, "color", "allDay": false, "start": ms, "end": ms }
 *             | { "cal", "key", "title", "place"?, "color", "allDay": true, "day": "YYYY-MM-DD", "endDay": "YYYY-MM-DD" (exclusive) } ],
 *   "tasks": [ { "cal", "key", "title", "color", "due": ms, "allDay": false }
 *            | { "cal", "key", "title", "color", "allDay": true, "day": "YYYY-MM-DD" }
 *            | { "cal", "key", "title", "color" } ] }
 * </pre>
 */
final class Snapshot {
    static final int VERSION = 1;

    /** Far more than the web app sends (about 2500 events and 500 tasks); the rest is left out. */
    static final int MAX_EVENTS = 6000;
    static final int MAX_TASKS = 2000;
    static final int MAX_CALENDARS = 500;
    /** The app allows titles of 150 characters; a widget line shows far fewer. */
    static final int MAX_TITLE = 200;
    static final int MAX_PLACE = 200;
    static final int MAX_NAME = 100;
    /** Calendar ids and item keys are opaque to the widgets and only travel back to the app. */
    static final int MAX_ID = 1024;
    /** An item longer than this many days is taken for a mistake. */
    static final int MAX_SPAN_DAYS = 3660;

    /** The interface languages of the app (src/i18n/languages.ts). */
    static final String[] LANGS = {"en", "pl", "de", "es", "fr", "it", "pt", "uk", "cs", "nl"};

    /** The colour of an item whose own one cannot be read: the weaker ink of the light theme. */
    static final int FALLBACK_COLOR = 0xFF5D646C;

    /** No instant: an absent time. */
    static final long NO_TIME = Long.MIN_VALUE;

    /** Instants outside 1900 .. 2400 are taken for mistakes. */
    private static final long MIN_TIME = -2_208_988_800_000L;
    private static final long MAX_TIME = 13_569_465_600_000L;

    static final class Calendar {
        final String id;
        final String name;
        final int color;
        final boolean events;
        final boolean tasks;
        final boolean visible;

        Calendar(String id, String name, int color, boolean events, boolean tasks, boolean visible) {
            this.id = id;
            this.name = name;
            this.color = color;
            this.events = events;
            this.tasks = tasks;
            this.visible = visible;
        }
    }

    static final class Event {
        final String cal;
        final String key;
        final String title;
        /** The place, or null. */
        final String place;
        final int color;
        final boolean allDay;
        /** A timed event's instants; {@link #NO_TIME} for an all-day one. {@code end >= start}. */
        final long start;
        final long end;
        /** An all-day event's first day and the day after its last; {@link Days#NONE} for a timed one. */
        final int day;
        final int endDay;
        /** Where it came in the snapshot: the order among equals. */
        final int index;

        Event(String cal, String key, String title, String place, int color, boolean allDay, long start, long end, int day, int endDay, int index) {
            this.cal = cal;
            this.key = key;
            this.title = title;
            this.place = place;
            this.color = color;
            this.allDay = allDay;
            this.start = start;
            this.end = end;
            this.day = day;
            this.endDay = endDay;
            this.index = index;
        }

        /** The first local day the event touches. */
        int firstDay(TimeZone zone) {
            return allDay ? day : Days.dayOf(start, zone);
        }

        /**
         * The last local day the event touches. A timed event that ends at a
         * midnight does not touch the day that begins there; one of no length
         * touches the day it is on.
         */
        int lastDay(TimeZone zone) {
            if (allDay) return endDay - 1;
            return end > start ? Days.dayOf(end - 1, zone) : Days.dayOf(start, zone);
        }
    }

    static final class Task {
        final String cal;
        final String key;
        final String title;
        final int color;
        /** A due time, or {@link #NO_TIME}. */
        final long due;
        /** A due day without a time, or {@link Days#NONE}. */
        final int day;
        final int index;

        Task(String cal, String key, String title, int color, long due, int day, int index) {
            this.cal = cal;
            this.key = key;
            this.title = title;
            this.color = color;
            this.due = due;
            this.day = day;
            this.index = index;
        }

        boolean timed() {
            return due != NO_TIME;
        }

        boolean hasDue() {
            return due != NO_TIME || day != Days.NONE;
        }

        /** The local day it is due on, or {@link Days#NONE}. */
        int dueDay(TimeZone zone) {
            if (timed()) return Days.dayOf(due, zone);
            return day;
        }
    }

    final long made;
    /** The first day covered, and the first one not covered any more. */
    final int from;
    final int until;
    /** One of {@link #LANGS}, or null for the system's language. */
    final String lang;
    final boolean hour12;
    /** 0 Sunday, 1 Monday, … 6 Saturday. */
    final int weekStart;
    final List<Calendar> calendars;
    final List<Event> events;
    final List<Task> tasks;
    private final Map<String, Calendar> byId;

    private Snapshot(long made, int from, int until, String lang, boolean hour12, int weekStart, List<Calendar> calendars, List<Event> events, List<Task> tasks) {
        this.made = made;
        this.from = from;
        this.until = until;
        this.lang = lang;
        this.hour12 = hour12;
        this.weekStart = weekStart;
        this.calendars = Collections.unmodifiableList(calendars);
        this.events = Collections.unmodifiableList(events);
        this.tasks = Collections.unmodifiableList(tasks);
        Map<String, Calendar> map = new HashMap<>();
        for (Calendar c : calendars) map.put(c.id, c);
        this.byId = map;
    }

    /** The calendar of this id, or null when the snapshot does not name it. */
    Calendar calendar(String id) {
        return byId.get(id);
    }

    /** Whether the day is inside the window the snapshot covers. */
    boolean covers(int day) {
        return day >= from && day < until;
    }

    /**
     * The snapshot in {@code json}, or null when it cannot be used at all: not
     * an object, another version, or no window of days. Never throws.
     */
    static Snapshot parse(Object json) {
        if (!(json instanceof JSONObject)) return null;
        JSONObject o = (JSONObject) json;
        try {
            if (number(o.opt("v"), -1) != VERSION) return null;
            int from = Days.parse(string(o.opt("from"), 10));
            int until = Days.parse(string(o.opt("until"), 10));
            if (from == Days.NONE || until == Days.NONE || until <= from || until - from > MAX_SPAN_DAYS) return null;
            long made = Math.max(0L, (long) number(o.opt("made"), 0));
            String lang = language(o.opt("lang"));
            boolean hour12 = Boolean.TRUE.equals(o.opt("hour12"));
            long weekStart = (long) number(o.opt("weekStart"), 1);
            int start = weekStart >= 0 && weekStart <= 6 ? (int) weekStart : 1;

            List<Calendar> calendars = new ArrayList<>();
            JSONArray cals = o.optJSONArray("calendars");
            for (int i = 0; cals != null && i < cals.length() && calendars.size() < MAX_CALENDARS; i++) {
                Calendar c = calendarOf(cals.opt(i));
                if (c != null) calendars.add(c);
            }
            List<Event> events = new ArrayList<>();
            JSONArray evs = o.optJSONArray("events");
            for (int i = 0; evs != null && i < evs.length() && events.size() < MAX_EVENTS; i++) {
                Event e = eventOf(evs.opt(i), events.size());
                if (e != null) events.add(e);
            }
            List<Task> tasks = new ArrayList<>();
            JSONArray ts = o.optJSONArray("tasks");
            for (int i = 0; ts != null && i < ts.length() && tasks.size() < MAX_TASKS; i++) {
                Task t = taskOf(ts.opt(i), tasks.size());
                if (t != null) tasks.add(t);
            }
            return new Snapshot(made, from, until, lang, hour12, start, calendars, events, tasks);
        } catch (RuntimeException e) {
            // Nothing above should throw; a snapshot that makes it is not used.
            return null;
        }
    }

    private static Calendar calendarOf(Object value) {
        if (!(value instanceof JSONObject)) return null;
        JSONObject o = (JSONObject) value;
        String id = id(o.opt("id"));
        if (id == null) return null;
        String name = text(o.opt("name"), MAX_NAME);
        return new Calendar(id, name == null ? "" : name, color(o.opt("color"), FALLBACK_COLOR),
            flag(o.opt("events"), true), flag(o.opt("tasks"), true), flag(o.opt("visible"), true));
    }

    private static Event eventOf(Object value, int index) {
        if (!(value instanceof JSONObject)) return null;
        JSONObject o = (JSONObject) value;
        String cal = id(o.opt("cal"));
        String key = id(o.opt("key"));
        if (cal == null || key == null) return null;
        String title = text(o.opt("title"), MAX_TITLE);
        String place = text(o.opt("place"), MAX_PLACE);
        if (place != null && place.trim().isEmpty()) place = null;
        int color = color(o.opt("color"), FALLBACK_COLOR);
        if (Boolean.TRUE.equals(o.opt("allDay"))) {
            int day = Days.parse(string(o.opt("day"), 10));
            if (day == Days.NONE) return null;
            int endDay = Days.parse(string(o.opt("endDay"), 10));
            if (endDay == Days.NONE || endDay <= day) endDay = day + 1;
            if (endDay - day > MAX_SPAN_DAYS) return null;
            return new Event(cal, key, title == null ? "" : title, place, color, true, NO_TIME, NO_TIME, day, endDay, index);
        }
        long start = time(o.opt("start"));
        if (start == NO_TIME) return null;
        long end = time(o.opt("end"));
        if (end == NO_TIME || end < start) end = start;
        if (end - start > MAX_SPAN_DAYS * Days.DAY_MS) return null;
        return new Event(cal, key, title == null ? "" : title, place, color, false, start, end, Days.NONE, Days.NONE, index);
    }

    private static Task taskOf(Object value, int index) {
        if (!(value instanceof JSONObject)) return null;
        JSONObject o = (JSONObject) value;
        String cal = id(o.opt("cal"));
        String key = id(o.opt("key"));
        if (cal == null || key == null) return null;
        String title = text(o.opt("title"), MAX_TITLE);
        int color = color(o.opt("color"), FALLBACK_COLOR);
        Object dayValue = present(o.opt("day"));
        Object dueValue = present(o.opt("due"));
        boolean allDay = Boolean.TRUE.equals(o.opt("allDay"));
        long due = NO_TIME;
        int day = Days.NONE;
        if (allDay || (dayValue != null && dueValue == null)) {
            if (dayValue != null) {
                day = Days.parse(string(dayValue, 10));
                // A due day that cannot be read would put the task among those without one.
                if (day == Days.NONE) return null;
            }
        } else if (dueValue != null) {
            due = time(dueValue);
            if (due == NO_TIME) return null;
        }
        return new Task(cal, key, title == null ? "" : title, color, due, day, index);
    }

    /** The value, or null for an absent one and for JSON's null. */
    private static Object present(Object value) {
        return value == JSONObject.NULL ? null : value;
    }

    /** A known interface language, else null (the system's). */
    private static String language(Object value) {
        if (!(value instanceof String)) return null;
        for (String lang : LANGS) {
            if (lang.equals(value)) return lang;
        }
        return null;
    }

    private static boolean flag(Object value, boolean fallback) {
        return value instanceof Boolean ? (Boolean) value : fallback;
    }

    private static double number(Object value, double fallback) {
        if (!(value instanceof Number)) return fallback;
        double d = ((Number) value).doubleValue();
        return Double.isNaN(d) || Double.isInfinite(d) ? fallback : d;
    }

    /** An instant in ms, whole and in a sensible range, else {@link #NO_TIME}. */
    private static long time(Object value) {
        if (!(value instanceof Number)) return NO_TIME;
        double d = ((Number) value).doubleValue();
        if (Double.isNaN(d) || d < MIN_TIME || d > MAX_TIME) return NO_TIME;
        return (long) Math.floor(d);
    }

    /** A string of at most {@code max} characters, else null. */
    private static String string(Object value, int max) {
        return value instanceof String && ((String) value).length() <= max ? (String) value : null;
    }

    /** An id or key: a non-empty string without control characters, not too long. */
    private static String id(Object value) {
        if (!(value instanceof String)) return null;
        String s = (String) value;
        if (s.isEmpty() || s.length() > MAX_ID) return null;
        for (int i = 0; i < s.length(); i++) {
            if (Character.isISOControl(s.charAt(i))) return null;
        }
        return s;
    }

    /**
     * A text for one line of a widget: line breaks and other control
     * characters become spaces, and it is cut to {@code max} characters
     * (between the halves of a surrogate pair never).
     */
    static String text(Object value, int max) {
        if (!(value instanceof String)) return null;
        String s = (String) value;
        StringBuilder out = new StringBuilder(Math.min(s.length(), max));
        for (int i = 0; i < s.length() && out.length() < max; i++) {
            char c = s.charAt(i);
            out.append(Character.isISOControl(c) ? ' ' : c);
        }
        if (out.length() > 0 && Character.isHighSurrogate(out.charAt(out.length() - 1))) out.setLength(out.length() - 1);
        return out.toString();
    }

    /** "#rrggbb" as an opaque colour, else {@code fallback}. */
    static int color(Object value, int fallback) {
        if (!(value instanceof String)) return fallback;
        String s = (String) value;
        if (s.length() != 7 || s.charAt(0) != '#') return fallback;
        int rgb = 0;
        for (int i = 1; i < 7; i++) {
            int digit = Character.digit(s.charAt(i), 16);
            if (digit < 0) return fallback;
            rgb = rgb << 4 | digit;
        }
        return 0xFF000000 | rgb;
    }
}
