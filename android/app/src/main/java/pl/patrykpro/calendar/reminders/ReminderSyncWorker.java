package pl.patrykpro.calendar.reminders;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import pl.patrykpro.calendar.R;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * Hourly background refresh: downloads upcoming events and tasks from every
 * visible CalDAV calendar and reschedules their reminders, so reminders work even
 * when the app is not opened and for events created on other devices.
 */
public class ReminderSyncWorker extends Worker {
    private static final String TAG = "CalendarReminders";
    private static final String PERIODIC = "calendar-reminder-sync";
    private static final String ONCE = "calendar-reminder-sync-now";
    /** More reminders than this for one calendar within the horizon is not a real calendar; the rest is ignored. */
    static final int MAX_REMINDERS = 5000;
    /**
     * VALARMs read per event or task. A real one has a handful; a hostile one
     * with thousands would otherwise fill the calendar's whole allowance.
     */
    static final int MAX_ALARMS_PER_ITEM = 50;
    /** Longest UID taken. Real ones are far shorter; a longer one is a hostile event and is skipped. */
    static final int MAX_UID = 1024;
    /**
     * Notifications one event or task may set off, as in the app
     * (src/lib/reminders.ts, MAX_ALARMS_PER_ITEM): its distinct reminder
     * offsets nearest its time. Anyone can put an item into a calendar the user
     * shows, and its VALARMs would otherwise each be a notification in the app's name.
     */
    static final int MAX_NOTIFICATIONS_PER_ITEM = 5;
    /** Longer titles and places are not shown in a notification (src/lib/reminders.ts, MAX_REMINDER_TEXT). */
    static final int MAX_REMINDER_TEXT = 200;

    public ReminderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void ensurePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(ReminderSyncWorker.class, 1, TimeUnit.HOURS, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /** A refresh as soon as there is network. One already waiting or running is replaced: the app asks after a change. */
    public static void runOnce(Context context) {
        runOnce(context, ExistingWorkPolicy.REPLACE);
    }

    /** As {@link #runOnce(Context)}, but a refresh already waiting or running is left to do the job. */
    public static void runOnceUnlessPending(Context context) {
        runOnce(context, ExistingWorkPolicy.KEEP);
    }

    private static void runOnce(Context context, ExistingWorkPolicy policy) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReminderSyncWorker.class).setConstraints(constraints).build();
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, policy, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        ReminderStore store = ReminderStore.get(context);
        JSONObject config;
        try {
            config = store.getConfig();
        } catch (VaultException e) {
            // Without the configuration nothing can be refreshed. The alarms that are set stay.
            store.recordWorkerRun(context.getString(R.string.reminder_sync_storage));
            return Result.retry();
        }
        if (!store.isEnabled()) {
            ReminderScheduler.rescheduleAll(context);
            return Result.success();
        }

        long now = System.currentTimeMillis();
        long horizon = config.optInt("horizonDays", 45) * 86400000L;
        // While reminders are switched off in the app it sends no calendars at all.
        JSONArray calendars = config.optBoolean("enabled", true) ? config.optJSONArray("calendars") : null;
        String untitled = context.getString(R.string.reminder_no_title);
        String hiddenTitle = context.getString(R.string.reminder_hidden_title);
        List<String> errors = new ArrayList<>();
        List<String> log = new ArrayList<>();
        int refreshed = 0;

        if (calendars != null) {
            String failed = context.getString(R.string.reminder_sync_calendar_failed);
            refreshed += refreshCalDav(store, calendars, CalDavFetcher::new, now, horizon, untitled, hiddenTitle, failed, this::isStopped, errors, log);
            for (String line : log) Log.w(TAG, line);
        }

        ReminderScheduler.rescheduleAll(context);
        // Hourly: a persistent notification that went some other way (a cleaner app) goes up again.
        ReminderNotifier.restoreStanding(context);
        // Stopped (replaced by a newer run, or out of time): what was fetched is in place, the record is left to a whole run.
        if (isStopped()) return Result.retry();
        store.recordWorkerRun(errors.isEmpty() ? null : String.join("\n", errors));
        Log.i(TAG, "Background reminder refresh: " + refreshed + " refreshed, " + errors.size() + " errors");
        return errors.isEmpty() || refreshed > 0 ? Result.success() : Result.retry();
    }

    /** Where the refresh gets the data of a CalDAV calendar from: the network in the app, a stand-in in tests. */
    interface CalendarSource {
        List<String> events(String calendarUrl, long from, long to) throws IOException;

        List<String> tasks(String calendarUrl) throws IOException;
    }

    interface CalendarSources {
        CalendarSource open(String username, String password);
    }

    /**
     * Refreshes the reminder set of every visible CalDAV calendar in the
     * configuration. A calendar that fails costs only its own set: what went
     * wrong goes to {@code errors} (for the settings screen, which only the
     * user reads) and to {@code log} (the kind of failure and nothing that
     * names a calendar), and the next calendar is tried.
     *
     * @return how many calendars were refreshed
     */
    static int refreshCalDav(ReminderStore store, JSONArray calendars, CalendarSources sources, long now, long horizon,
                             String untitled, String hiddenTitle, String failed, BooleanSupplier stopped, List<String> errors, List<String> log) {
        // Look past the horizon by the longest common lead time (4 weeks).
        long to = now + horizon + 28L * 86400000L;
        int refreshed = 0;
        for (int i = 0; i < calendars.length() && !stopped.getAsBoolean(); i++) {
            JSONObject cal = calendars.optJSONObject(i);
            if (cal == null || !cal.optBoolean("visible", true) || cal.optString("url").isEmpty()) continue;
            String key = cal.optString("key");
            try {
                CalendarSource source = sources.open(cal.optString("username"), cal.optString("password"));
                List<Reminder> reminders = new ArrayList<>();
                boolean expanded = true;
                JSONArray comps = cal.optJSONArray("components");
                boolean events = comps == null || comps.toString().contains("VEVENT");
                boolean tasks = comps == null || comps.toString().contains("VTODO");
                if (events) {
                    for (String ics : source.events(cal.optString("url"), now, to)) {
                        if (!collectEvents(key, ics, now, now + horizon, untitled, hiddenTitle, reminders)) expanded = false;
                    }
                }
                if (tasks) {
                    for (String ics : source.tasks(cal.optString("url"))) collectTasks(key, ics, now, now + horizon, untitled, reminders);
                }
                if (expanded) {
                    store.replaceSet(key, reminders, "worker");
                    refreshed++;
                } else {
                    // Server ignored <expand>: keep the app's (fully expanded) reminders.
                    log.add("A server did not expand recurrences");
                }
            } catch (Exception | StackOverflowError | OutOfMemoryError e) {
                // The two errors are what calendar data built to break the parser could still
                // cause. All that this calendar's attempt allocated is garbage once it is caught.
                // The message, or a fixed text: never the class name, which R8 renames in release builds.
                String message = e.getMessage();
                errors.add(cal.optString("name", "?") + ": " + (message != null && !message.isEmpty() ? message : failed));
                log.add("Reminder refresh failed for a calendar: " + e.getClass().getSimpleName());
            }
        }
        return refreshed;
    }

    /**
     * Adds the reminders of the events in {@code ics} to {@code out}, up to
     * {@link #MAX_REMINDERS}. Each carries the event's start, which its
     * notification words when it is shown, and the place as the line below
     * it. An event that cannot be made sense of is skipped.
     * Returns false when an RRULE is present, i.e. the server did not expand.
     */
    static boolean collectEvents(String calendarKey, String ics, long from, long to, String untitled, List<Reminder> out) {
        return collectEvents(calendarKey, ics, from, to, untitled, untitled, out);
    }

    /**
     * As above; a hidden event (X-PATRYKPRO-HIDDEN:TRUE, src/lib/hidden.ts) is
     * named {@code hiddenTitle}, without its place. Hiding belongs to a series:
     * the web app writes it on the master only, and a server that expands
     * copies it onto the instances it makes but not onto stored overrides, so
     * any VEVENT of a UID that carries it hides all of that UID's. So it is
     * with a persistent notification (X-PATRYKPRO-PERSISTENT:TRUE,
     * src/lib/persistent.ts).
     */
    static boolean collectEvents(String calendarKey, String ics, long from, long to, String untitled, String hiddenTitle, List<Reminder> out) {
        boolean expanded = true;
        List<IcsMini.Component> calendars = IcsMini.parse(ics);
        Set<String> hidden = new HashSet<>();
        Set<String> persistent = new HashSet<>();
        for (IcsMini.Component cal : calendars) {
            for (IcsMini.Component ev : cal.all("VEVENT")) {
                if (flagged(ev, "X-PATRYKPRO-HIDDEN")) hidden.add(String.valueOf(ev.text("UID")));
                if (flagged(ev, "X-PATRYKPRO-PERSISTENT")) persistent.add(String.valueOf(ev.text("UID")));
            }
        }
        for (IcsMini.Component cal : calendars) {
            for (IcsMini.Component ev : cal.all("VEVENT")) {
                if (ev.prop("RRULE") != null) expanded = false;
                String uid = String.valueOf(ev.text("UID"));
                try {
                    collectEvent(calendarKey, ev, from, to, hidden.contains(uid) ? hiddenTitle : null, persistent.contains(uid), untitled, out);
                } catch (RuntimeException e) {
                    // One odd event costs its own reminders, not the calendar's.
                }
            }
        }
        return expanded;
    }

    /** Whether a component carries {@code name}:TRUE, in any case. */
    static boolean flagged(IcsMini.Component comp, String name) {
        String flag = comp.text(name);
        return flag != null && flag.trim().equalsIgnoreCase("TRUE");
    }

    /** {@code hiddenTitle} names a hidden event (no place then); null for one that is not. */
    private static void collectEvent(String calendarKey, IcsMini.Component ev, long from, long to, String hiddenTitle, boolean persistent, String untitled, List<Reminder> out) {
        if ("CANCELLED".equalsIgnoreCase(ev.text("STATUS"))) return;
        IcsMini.Time start = IcsMini.parseTime(ev.prop("DTSTART"));
        if (start == null) return;
        IcsMini.Time endT = IcsMini.parseTime(ev.prop("DTEND"));
        long end;
        if (endT != null) end = endT.millis;
        else {
            Long dur = IcsMini.parseDuration(ev.text("DURATION"));
            end = start.millis + (dur != null ? dur : (start.allDay ? 86400000L : 0));
        }
        String title = ev.text("SUMMARY");
        if (title == null || title.isEmpty() || title.length() > MAX_REMINDER_TEXT) title = untitled;
        String location = ev.text("LOCATION");
        String place = location == null || location.length() > MAX_REMINDER_TEXT ? "" : location;
        if (hiddenTitle != null) {
            title = hiddenTitle;
            place = "";
        }
        String uid = ev.text("UID");
        if (uid != null && uid.length() > MAX_UID) return;
        List<IcsMini.Component> alarms = ev.all("VALARM");
        Set<Long> kept = keptOffsets(alarms, start.millis, end, start.millis);
        for (int i = 0; i < alarms.size() && i < MAX_ALARMS_PER_ITEM; i++) {
            if (out.size() >= MAX_REMINDERS) return;
            IcsMini.Component alarm = alarms.get(i);
            Long at = triggerTime(alarm, start.millis, end);
            if (at == null || !kept.remove(at - start.millis) || at < from || at >= to) continue;
            String key = calendarKey + "|" + uid + "|" + start.millis + "|" + (at - start.millis);
            // A key too long to be read back would never fire; it is not made at all.
            if (!Reminder.keyFits(key)) continue;
            out.add(new Reminder(key, at, title, place, start.floating && !absoluteTrigger(alarm), start.millis, start.allDay, persistent, false));
        }
    }

    /** As {@link #collectEvents}, for the tasks in {@code ics}. */
    static void collectTasks(String calendarKey, String ics, long from, long to, String untitled, List<Reminder> out) {
        for (IcsMini.Component cal : IcsMini.parse(ics)) {
            for (IcsMini.Component todo : cal.all("VTODO")) {
                try {
                    collectTask(calendarKey, todo, from, to, untitled, out);
                } catch (RuntimeException e) {
                    // One odd task costs its own reminders, not the calendar's.
                }
            }
        }
    }

    private static void collectTask(String calendarKey, IcsMini.Component todo, long from, long to, String untitled, List<Reminder> out) {
        String status = todo.text("STATUS");
        if (status != null && (status.equalsIgnoreCase("COMPLETED") || status.equalsIgnoreCase("CANCELLED"))) return;
        if (todo.prop("COMPLETED") != null) return;
        IcsMini.Time due = IcsMini.parseTime(todo.prop("DUE"));
        IcsMini.Time start = IcsMini.parseTime(todo.prop("DTSTART"));
        if (due == null && start == null) return;
        long dueMs = due != null ? due.millis : start.millis;
        // The notification names the due time, or the start of a task without one.
        boolean dueAllDay = (due != null ? due : start).allDay;
        long startMs = start != null ? start.millis : dueMs;
        boolean floating = (start != null ? start : due).floating;
        String title = todo.text("SUMMARY");
        if (title == null || title.isEmpty() || title.length() > MAX_REMINDER_TEXT) title = untitled;
        String uid = todo.text("UID");
        if (uid != null && uid.length() > MAX_UID) return;
        boolean persistent = flagged(todo, "X-PATRYKPRO-PERSISTENT");
        List<IcsMini.Component> alarms = todo.all("VALARM");
        Set<Long> kept = keptOffsets(alarms, startMs, dueMs, dueMs);
        for (int i = 0; i < alarms.size() && i < MAX_ALARMS_PER_ITEM; i++) {
            if (out.size() >= MAX_REMINDERS) return;
            IcsMini.Component alarm = alarms.get(i);
            Long at = triggerTime(alarm, startMs, dueMs);
            if (at == null || !kept.remove(at - dueMs) || at < from || at >= to) continue;
            String key = calendarKey + "|" + uid + "|" + dueMs + "|" + (at - dueMs);
            if (!Reminder.keyFits(key)) continue;
            out.add(new Reminder(key, at, title, "", floating && !absoluteTrigger(alarm), dueMs, dueAllDay, persistent, true));
        }
    }

    /**
     * The offsets from {@code anchor} (the item's time) of the alarms that may
     * set off a notification: distinct, at most {@link #MAX_NOTIFICATIONS_PER_ITEM},
     * those nearest the item's time, and of two as far from it the one before
     * it (as src/lib/reminders.ts cappedAlarms, whose minutes count before the
     * item: there the larger wins a tie, here, where an offset before the item
     * is negative, the smaller). Each offset is used once.
     */
    static Set<Long> keptOffsets(List<IcsMini.Component> alarms, long start, long end, long anchor) {
        Set<Long> distinct = new LinkedHashSet<>();
        for (int i = 0; i < alarms.size() && i < MAX_ALARMS_PER_ITEM; i++) {
            Long at = triggerTime(alarms.get(i), start, end);
            if (at != null) distinct.add(at - anchor);
        }
        List<Long> sorted = new ArrayList<>(distinct);
        sorted.sort((a, b) -> {
            int byDistance = Long.compare(Math.abs(a), Math.abs(b));
            return byDistance != 0 ? byDistance : Long.compare(a, b);
        });
        return new LinkedHashSet<>(sorted.subList(0, Math.min(MAX_NOTIFICATIONS_PER_ITEM, sorted.size())));
    }

    /** True when the alarm names a point in time instead of an offset from the event. */
    static boolean absoluteTrigger(IcsMini.Component alarm) {
        IcsMini.Prop trigger = alarm.prop("TRIGGER");
        return trigger != null && ("DATE-TIME".equalsIgnoreCase(trigger.param("VALUE")) || (!trigger.value.contains("P") && trigger.value.length() >= 15));
    }

    /** Absolute time of a VALARM trigger relative to start (default) or end. */
    static Long triggerTime(IcsMini.Component alarm, long start, long end) {
        IcsMini.Prop trigger = alarm.prop("TRIGGER");
        if (trigger == null) return null;
        String action = alarm.text("ACTION");
        if (action != null && !action.equalsIgnoreCase("DISPLAY") && !action.equalsIgnoreCase("AUDIO") && !action.equalsIgnoreCase("EMAIL")) return null;
        if (absoluteTrigger(alarm)) {
            IcsMini.Time t = IcsMini.parseTime(trigger);
            return t == null ? null : t.millis;
        }
        Long offset = IcsMini.parseDuration(trigger.value);
        if (offset == null) return null;
        long base = "END".equalsIgnoreCase(trigger.param("RELATED")) ? end : start;
        return base + offset;
    }
}
