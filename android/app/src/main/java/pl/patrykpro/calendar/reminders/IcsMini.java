package pl.patrykpro.calendar.reminders;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Just enough iCalendar parsing for reminders: components, properties with
 * parameters, DATE / DATE-TIME values and durations. Recurrence expansion is
 * left to the server (CalDAV calendar-data expand).
 */
public final class IcsMini {
    private IcsMini() {}

    public static final class Prop {
        public final String name;
        public final Map<String, String> params;
        public final String value;

        Prop(String name, Map<String, String> params, String value) {
            this.name = name;
            this.params = params;
            this.value = value;
        }

        public String param(String key) {
            return params.get(key);
        }
    }

    public static final class Component {
        public final String name;
        public final List<Prop> props = new ArrayList<>();
        public final List<Component> children = new ArrayList<>();

        Component(String name) {
            this.name = name;
        }

        public Prop prop(String name) {
            for (Prop p : props) if (p.name.equals(name)) return p;
            return null;
        }

        public String text(String name) {
            Prop p = prop(name);
            return p == null ? null : unescape(p.value);
        }

        public List<Component> all(String name) {
            List<Component> out = new ArrayList<>();
            for (Component c : children) if (c.name.equals(name)) out.add(c);
            return out;
        }
    }

    // The text comes from a server, and through it from anyone who can put an
    // event into a calendar the user syncs. Parsing is one pass over it, and
    // these limits keep one hostile event from filling the memory of the
    // background refresh.

    /** Longer lines (after unfolding) are skipped: no property used for a reminder comes near, inline attachments do. */
    static final int MAX_LINE = 64 * 1024;
    /** Parameters of one property beyond this many are ignored. */
    static final int MAX_PARAMS = 100;
    /** Lines read from one document (one event with its occurrences expanded); the rest is ignored. */
    static final int MAX_LINES = 100_000;

    /** Parses an iCalendar document into its top-level components. */
    public static List<Component> parse(String ics) {
        List<Component> roots = new ArrayList<>();
        List<Component> stack = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        boolean tooLong = false;
        int lines = 0;
        int n = ics.length();
        int pos = 0;
        while (pos < n && lines < MAX_LINES) {
            int newline = ics.indexOf('\n', pos);
            int next = newline < 0 ? n : newline + 1;
            int end = newline < 0 ? n : newline;
            if (end > pos && ics.charAt(end - 1) == '\r') end--;
            char first = end > pos ? ics.charAt(pos) : 0;
            if (pos > 0 && (first == ' ' || first == '\t')) {
                // A folded line continues the one before it, without its leading blank.
                pos++;
            } else {
                if (!tooLong && line.length() > 0) {
                    add(line.toString(), roots, stack);
                    lines++;
                }
                line.setLength(0);
                tooLong = false;
            }
            if (!tooLong && line.length() + (end - pos) > MAX_LINE) {
                tooLong = true;
                line.setLength(0);
            }
            if (!tooLong) line.append(ics, pos, end);
            pos = next;
        }
        if (!tooLong && line.length() > 0 && lines < MAX_LINES) add(line.toString(), roots, stack);
        return roots;
    }

    private static void add(String raw, List<Component> roots, List<Component> stack) {
        Prop p = parseLine(raw);
        if (p == null) return;
        if (p.name.equals("BEGIN")) {
            Component c = new Component(p.value.toUpperCase(Locale.ROOT));
            if (!stack.isEmpty()) stack.get(stack.size() - 1).children.add(c);
            else roots.add(c);
            stack.add(c);
        } else if (p.name.equals("END")) {
            if (!stack.isEmpty()) stack.remove(stack.size() - 1);
        } else if (!stack.isEmpty()) {
            stack.get(stack.size() - 1).props.add(p);
        }
    }

    private static Prop parseLine(String line) {
        // One pass: the name and the parameters end at a ';', the last of them
        // at the first ':', in both cases only outside a quoted parameter value.
        List<String> parts = new ArrayList<>();
        boolean quoted = false;
        int from = 0;
        int colon = -1;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                quoted = !quoted;
            } else if (!quoted && (c == ';' || c == ':')) {
                if (parts.size() <= MAX_PARAMS) parts.add(line.substring(from, i));
                from = i + 1;
                if (c == ':') {
                    colon = i;
                    break;
                }
            }
        }
        if (colon < 0) return null;
        String value = line.substring(colon + 1);
        Map<String, String> params = parts.size() > 1 ? new HashMap<>() : Collections.emptyMap();
        for (int i = 1; i < parts.size(); i++) {
            String part = parts.get(i);
            int eq = part.indexOf('=');
            if (eq > 0) {
                String v = part.substring(eq + 1);
                if (v.startsWith("\"") && v.endsWith("\"") && v.length() >= 2) v = v.substring(1, v.length() - 1);
                params.put(part.substring(0, eq).toUpperCase(Locale.ROOT), v);
            }
        }
        return new Prop(parts.get(0).toUpperCase(Locale.ROOT), params, value);
    }

    public static String unescape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                out.append(n == 'n' || n == 'N' ? '\n' : n);
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    /** A parsed DATE or DATE-TIME. */
    public static final class Time {
        public final long millis;
        public final boolean allDay;
        /** True when the value names no zone (a DATE, or a time without Z or TZID) and was read in the device's zone. */
        public final boolean floating;

        Time(long millis, boolean allDay, boolean floating) {
            this.millis = millis;
            this.allDay = allDay;
            this.floating = floating;
        }
    }

    private static final Pattern DATE_TIME = Pattern.compile("(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2})(Z)?)?");

    public static Time parseTime(Prop p) {
        if (p == null) return null;
        Matcher m = DATE_TIME.matcher(p.value.trim());
        if (!m.lookingAt()) return null;
        int y = Integer.parseInt(m.group(1));
        int mo = Integer.parseInt(m.group(2)) - 1;
        int d = Integer.parseInt(m.group(3));
        if (m.group(4) == null) {
            // DATE values are floating: midnight in the device's zone.
            Calendar cal = Calendar.getInstance();
            cal.clear();
            cal.set(y, mo, d, 0, 0, 0);
            return new Time(cal.getTimeInMillis(), true, true);
        }
        TimeZone zone;
        boolean floating = false;
        if (m.group(7) != null) zone = TimeZone.getTimeZone("UTC");
        else if (p.param("TZID") != null) zone = zoneFor(p.param("TZID"));
        else {
            zone = TimeZone.getDefault();
            floating = true;
        }
        Calendar cal = Calendar.getInstance(zone);
        cal.clear();
        cal.set(y, mo, d, Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), Integer.parseInt(m.group(6)));
        return new Time(cal.getTimeInMillis(), false, floating);
    }

    /**
     * The zone a TZID names, else the device's. A TZID not found here is still
     * a zone, not a floating time: the app resolves Windows names and the
     * object's own VTIMEZONE, which this reader does not, so such a time (an
     * Exchange meeting, typically) keeps its instant when the device's zone changes.
     */
    private static TimeZone zoneFor(String tzid) {
        String id = tzid;
        // "/freeassociation.sourceforge.net/Europe/Warsaw" style prefixes.
        String[] segments = tzid.split("/");
        TimeZone tz = TimeZone.getTimeZone(id);
        if (!tz.getID().equals("GMT") || id.equals("GMT")) return tz;
        for (int n = Math.min(3, segments.length); n >= 2; n--) {
            StringBuilder sb = new StringBuilder();
            for (int i = segments.length - n; i < segments.length; i++) {
                if (sb.length() > 0) sb.append('/');
                sb.append(segments[i]);
            }
            tz = TimeZone.getTimeZone(sb.toString());
            if (!tz.getID().equals("GMT")) return tz;
        }
        return TimeZone.getDefault();
    }

    /** At most nine digits a group: even all five at their largest add up to far less than a long holds. */
    private static final Pattern DURATION = Pattern.compile("([+-])?P(?:(\\d{1,9})W)?(?:(\\d{1,9})D)?(?:T(?:(\\d{1,9})H)?(?:(\\d{1,9})M)?(?:(\\d{1,9})S)?)?");

    /** Parses an RFC 5545 duration into signed milliseconds, or null. */
    public static Long parseDuration(String value) {
        if (value == null) return null;
        Matcher m = DURATION.matcher(value.trim());
        if (!m.matches()) return null;
        long ms = 0;
        if (m.group(2) != null) ms += Long.parseLong(m.group(2)) * 7 * 86400000L;
        if (m.group(3) != null) ms += Long.parseLong(m.group(3)) * 86400000L;
        if (m.group(4) != null) ms += Long.parseLong(m.group(4)) * 3600000L;
        if (m.group(5) != null) ms += Long.parseLong(m.group(5)) * 60000L;
        if (m.group(6) != null) ms += Long.parseLong(m.group(6)) * 1000L;
        return "-".equals(m.group(1)) ? -ms : ms;
    }
}
