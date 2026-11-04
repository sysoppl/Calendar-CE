package pl.patrykpro.calendar.reminders;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * A single notification to show at a point in time.
 *
 * A reminder of an event or a task carries the item's start (a task's due
 * time) instead of a ready-made line about it. The notification words that
 * time when it is shown, relative to that moment: "Today at 18:00",
 * "Tomorrow", "Thursday at 9:00" (see {@link WhenFormat}). Words picked when
 * the reminder was computed would be wrong by the time it fires: computed on
 * Monday, "Tomorrow" is shown on Tuesday.
 */
public class Reminder {
    /**
     * Longest texts kept. A notification shows far less, and an unbounded
     * SUMMARY would otherwise travel through every store write and every
     * notification call, where the system rejects oversized payloads.
     */
    static final int MAX_TITLE = 200;
    static final int MAX_BODY = 600;
    /** The key is an identity and cannot be shortened; a reminder with a longer one is dropped. */
    static final int MAX_KEY = 2048;
    /** Room a snoozed copy adds to its key ("|snooze" and a time in milliseconds). */
    static final int SNOOZE_ROOM = 32;
    /** {@link #start} of a reminder that carries its whole text in {@link #body}. */
    public static final long NO_START = Long.MIN_VALUE;

    /** Stable identity, e.g. "objectUrl#recurrenceId|15". */
    public final String key;
    /** Epoch millis when the notification should appear. */
    public final long at;
    public final String title;
    /**
     * With a {@link #start}: what the notification shows below the time,
     * the place of an event (or nothing). Without one: the whole text, as for
     * a test notification or a reminder stored by an earlier version.
     */
    public final String body;
    /**
     * True when the trigger follows the wall clock of the device (all-day
     * events, times without a zone), so it has to move when the time zone does.
     */
    public final boolean floating;
    /** Epoch millis of the event's start or the task's due time; {@link #NO_START} when the body says it all. */
    public final long start;
    /** The item takes whole days: its time is a day (midnight on the device's clock), not a time of day. */
    public final boolean allDay;

    public Reminder(String key, long at, String title, String body) {
        this(key, at, title, body, false);
    }

    public Reminder(String key, long at, String title, String body, boolean floating) {
        this(key, at, title, body, floating, NO_START, false);
    }

    public Reminder(String key, long at, String title, String body, boolean floating, long start, boolean allDay) {
        this.key = key == null ? "" : key;
        this.at = at;
        this.title = clip(title, MAX_TITLE);
        this.body = clip(body, MAX_BODY);
        this.floating = floating;
        this.start = start;
        this.allDay = start != NO_START && allDay;
    }

    /**
     * Whether a reminder under {@code key}, and a snoozed copy of it, would be
     * read back by {@link #fromJson}. Keys made from a calendar's data (a
     * hostile UID) are checked with it before a reminder is made at all.
     */
    static boolean keyFits(String key) {
        return key != null && !key.isEmpty() && key.length() + SNOOZE_ROOM <= MAX_KEY;
    }

    /** Whether the notification words the item's time itself, when it is shown. */
    public boolean hasStart() {
        return start != NO_START;
    }

    /** The same reminder at another time, for an item that starts at another time too (moved with the clock). */
    public Reminder moved(long time, long itemStart) {
        if (time == at && itemStart == start) return this;
        return new Reminder(key, time, title, body, floating, hasStart() ? itemStart : NO_START, allDay);
    }

    /** A copy under another key at another, fixed moment: what a snooze shows again. */
    public Reminder snoozed(String snoozedKey, long time) {
        return new Reminder(snoozedKey, time, title, body, false, start, allDay);
    }

    /**
     * The text of the notification when it is shown at {@code now}: the
     * item's time worded by {@code when}, and the place on a line below it.
     */
    public String text(WhenFormat when, long now) {
        if (!hasStart()) return body;
        String time = when.format(now, start, allDay);
        return body.isEmpty() ? time : time + "\n" + body;
    }

    static String clip(String text, int max) {
        if (text == null) return "";
        if (text.length() <= max) return text;
        int end = max - 1;
        // Never cut a surrogate pair in half.
        if (Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end) + "…";
    }

    /** Positive 31-bit id used for the alarm request code and the notification id. */
    public int id() {
        return idFor(key);
    }

    /**
     * The id of the notification: one per event occurrence or task due time,
     * shared by all of its reminders, so a newer one (15 minutes before)
     * replaces the one before it (1 hour before) instead of stacking up.
     */
    public int noticeId() {
        return noticeIdFor(key);
    }

    public static int noticeIdFor(String key) {
        return idFor(itemOf(key));
    }

    /**
     * The key without its lead time: every key ends in "|" and the minutes
     * (the app) or the offset (the worker), and a snoozed
     * copy adds "|snooze" and its time.
     */
    static String itemOf(String key) {
        String item = key.replaceFirst("\\|snooze\\d+$", "");
        int bar = item.lastIndexOf('|');
        return bar > 0 ? item.substring(0, bar) : item;
    }

    public static int idFor(String key) {
        // FNV-1a, same as the web side, so ids are stable across sources.
        int h = 0x811c9dc5;
        for (int i = 0; i < key.length(); i++) {
            h ^= key.charAt(i);
            h *= 16777619;
        }
        return (h >>> 1) & 0x7fffffff;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("key", key);
        o.put("at", at);
        o.put("title", title);
        o.put("body", body);
        if (floating) o.put("floating", true);
        if (hasStart()) {
            o.put("start", start);
            if (allDay) o.put("allDay", true);
        }
        return o;
    }

    private static String text(JSONObject o, String name) {
        Object value = o.opt(name);
        return value instanceof String ? (String) value : "";
    }

    /** Null when the object has no usable key or time. */
    public static Reminder fromJson(JSONObject o) {
        String key = text(o, "key");
        if (key.isEmpty() || key.length() > MAX_KEY || !(o.opt("at") instanceof Number)) return null;
        Object start = o.opt("start");
        // Written by the app, the worker or an earlier version (which had no start and a whole text).
        long itemStart = start instanceof Number ? ((Number) start).longValue() : NO_START;
        return new Reminder(key, o.optLong("at"), text(o, "title"), text(o, "body"), o.optBoolean("floating", false), itemStart, o.optBoolean("allDay", false));
    }
}
