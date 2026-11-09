package pl.patrykpro.calendar.widgets;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The taps on a widget that open the app, and what the app is told about
 * them.
 *
 * A widget opens {@code MainActivity} with an explicit intent carrying one of
 * the actions below and a few extras. The activity is exported (it is the
 * launcher's entry), so any app on the device can start it with the same
 * action and extras: the plugin passes nothing on that it has not checked
 * here. An extra of the wrong type, length or form is dropped; an action that
 * needs an item (an event, a task) and does not get a usable one is not
 * passed on at all. The app then does only what a tap in its own interface
 * could do: open a day or an item, start a new one, or mark a task done (the
 * web side checks that the task exists).
 *
 * The web app hears of a tap as the plugin's {@code widgetAction} event with
 * {@code { action, day?, view?, cal?, key?, start? }}, action being one of
 * "open", "event", "newEvent", "newTask", "task", "taskDone".
 */
final class WidgetAction {
    static final String PREFIX = "pl.patrykpro.calendar.widget.";

    /** Opens the app; optionally on a day ({@link #EXTRA_DAY}) and a view ({@link #EXTRA_VIEW}). */
    static final String OPEN = PREFIX + "OPEN";
    /** Opens an event: {@link #EXTRA_CAL}, {@link #EXTRA_KEY}, and {@link #EXTRA_START} (timed) or {@link #EXTRA_DAY} (all-day). */
    static final String EVENT = PREFIX + "EVENT";
    /** Starts a new event, optionally on {@link #EXTRA_DAY}. */
    static final String NEW_EVENT = PREFIX + "NEW_EVENT";
    static final String NEW_TASK = PREFIX + "NEW_TASK";
    /** Opens a task: {@link #EXTRA_CAL}, {@link #EXTRA_KEY}. */
    static final String TASK = PREFIX + "TASK";
    /** Marks a task done: {@link #EXTRA_CAL}, {@link #EXTRA_KEY}. */
    static final String TASK_DONE = PREFIX + "TASK_DONE";

    static final String EXTRA_DAY = PREFIX + "day";
    static final String EXTRA_VIEW = PREFIX + "view";
    static final String EXTRA_CAL = PREFIX + "cal";
    static final String EXTRA_KEY = PREFIX + "key";
    static final String EXTRA_START = PREFIX + "start";

    static final String VIEW_DAY = "day";
    static final String VIEW_AGENDA = "agenda";
    static final String VIEW_TASKS = "tasks";

    /** Instants outside 1900 .. 2400 are not times of an event. */
    private static final long MIN_START = -2_208_988_800_000L;
    private static final long MAX_START = 13_569_465_600_000L;

    private WidgetAction() {}

    /** Whether {@code action} is one of the widgets' own. */
    static boolean isOurs(String action) {
        return name(action) != null;
    }

    /** The name the web app knows the action by, or null for any other action. */
    static String name(String action) {
        if (OPEN.equals(action)) return "open";
        if (EVENT.equals(action)) return "event";
        if (NEW_EVENT.equals(action)) return "newEvent";
        if (NEW_TASK.equals(action)) return "newTask";
        if (TASK.equals(action)) return "task";
        if (TASK_DONE.equals(action)) return "taskDone";
        return null;
    }

    /**
     * The {@code widgetAction} event for a tap, from the intent's action and
     * extras as they came (each one may be missing or of any type), or null
     * when there is nothing to pass on.
     */
    static JSONObject event(String action, Object day, Object view, Object cal, Object key, Object start) {
        String name = name(action);
        if (name == null) return null;
        try {
            JSONObject out = new JSONObject();
            out.put("action", name);
            String validDay = day(day);
            if (OPEN.equals(action)) {
                if (validDay != null) out.put("day", validDay);
                String validView = view(view);
                if (validView != null) out.put("view", validView);
            } else if (NEW_EVENT.equals(action)) {
                if (validDay != null) out.put("day", validDay);
            } else if (EVENT.equals(action) || TASK.equals(action) || TASK_DONE.equals(action)) {
                String validCal = id(cal);
                String validKey = id(key);
                if (validCal == null || validKey == null) return null;
                out.put("cal", validCal);
                out.put("key", validKey);
                if (EVENT.equals(action)) {
                    Long validStart = start(start);
                    if (validStart != null) out.put("start", validStart.longValue());
                    else if (validDay != null) out.put("day", validDay);
                    else return null;
                }
            }
            return out;
        } catch (JSONException e) {
            return null;
        }
    }

    /** A "YYYY-MM-DD" day that exists, else null. */
    static String day(Object value) {
        return value instanceof String && Days.parse((String) value) != Days.NONE ? (String) value : null;
    }

    static String view(Object value) {
        if (VIEW_DAY.equals(value) || VIEW_AGENDA.equals(value) || VIEW_TASKS.equals(value)) return (String) value;
        return null;
    }

    /** A calendar id or item key as the snapshot allows them, else null. */
    static String id(Object value) {
        if (!(value instanceof String)) return null;
        String s = (String) value;
        if (s.isEmpty() || s.length() > Snapshot.MAX_ID) return null;
        for (int i = 0; i < s.length(); i++) {
            if (Character.isISOControl(s.charAt(i))) return null;
        }
        return s;
    }

    static Long start(Object value) {
        if (!(value instanceof Long)) return null;
        long ms = (Long) value;
        return ms >= MIN_START && ms <= MAX_START ? ms : null;
    }
}
