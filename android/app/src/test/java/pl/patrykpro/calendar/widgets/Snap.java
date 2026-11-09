package pl.patrykpro.calendar.widgets;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

/** Snapshots for the tests, written as the web app writes them. */
final class Snap {
    static final TimeZone WARSAW = TimeZone.getTimeZone("Europe/Warsaw");
    static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    final JSONObject json = new JSONObject();
    final JSONArray calendars = new JSONArray();
    final JSONArray events = new JSONArray();
    final JSONArray tasks = new JSONArray();

    Snap(String from, String until) {
        try {
            json.put("v", 1);
            json.put("made", 1762682400000L);
            json.put("from", from);
            json.put("until", until);
            json.put("lang", "en");
            json.put("hour12", false);
            json.put("weekStart", 1);
            json.put("calendars", calendars);
            json.put("events", events);
            json.put("tasks", tasks);
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
    }

    /** A window around November 2026, as the web app would send on 9 November. */
    static Snap november() {
        return new Snap("2026-09-28", "2027-03-08");
    }

    /** Milliseconds of a local time in Warsaw. */
    static long at(int year, int month, int day, int hour, int minute) {
        return at(WARSAW, year, month, day, hour, minute);
    }

    static long at(TimeZone zone, int year, int month, int day, int hour, int minute) {
        GregorianCalendar c = new GregorianCalendar(zone, Locale.ROOT);
        c.clear();
        c.set(year, month - 1, day, hour, minute, 0);
        return c.getTimeInMillis();
    }

    static int day(String ymd) {
        return Days.parse(ymd);
    }

    Snap put(String key, Object value) {
        try {
            json.put(key, value);
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap calendar(String id, String name, String color, boolean events, boolean tasks, boolean visible) {
        try {
            calendars.put(new JSONObject().put("id", id).put("name", name).put("color", color)
                .put("events", events).put("tasks", tasks).put("visible", visible));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap timed(String cal, String key, String title, long start, long end) {
        try {
            events.put(new JSONObject().put("cal", cal).put("key", key).put("title", title).put("color", "#1d6cd6")
                .put("allDay", false).put("start", start).put("end", end));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap allDay(String cal, String key, String title, String day, String endDay) {
        try {
            events.put(new JSONObject().put("cal", cal).put("key", key).put("title", title).put("color", "#1b8037")
                .put("allDay", true).put("day", day).put("endDay", endDay));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap taskDue(String cal, String key, String title, long due) {
        try {
            tasks.put(new JSONObject().put("cal", cal).put("key", key).put("title", title).put("color", "#d12e2c")
                .put("allDay", false).put("due", due));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap taskOn(String cal, String key, String title, String day) {
        try {
            tasks.put(new JSONObject().put("cal", cal).put("key", key).put("title", title).put("color", "#d12e2c")
                .put("allDay", true).put("day", day));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snap taskUndated(String cal, String key, String title) {
        try {
            tasks.put(new JSONObject().put("cal", cal).put("key", key).put("title", title).put("color", "#d12e2c"));
        } catch (JSONException e) {
            throw new AssertionError(e);
        }
        return this;
    }

    Snapshot parse() {
        Snapshot s = Snapshot.parse(json);
        if (s == null) throw new AssertionError("not parsed: " + json);
        return s;
    }
}
