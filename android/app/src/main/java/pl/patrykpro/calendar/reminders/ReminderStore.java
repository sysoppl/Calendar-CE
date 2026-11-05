package pl.patrykpro.calendar.reminders;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import pl.patrykpro.calendar.util.Encoding;
import pl.patrykpro.calendar.vault.KeyValues;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.SharedPrefsValues;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * Persistent reminder state, shared by the app (via the plugin), the
 * background worker and the receivers.
 *
 * Reminders are stored per calendar ("set"), so the background worker can
 * refresh server calendars without touching device-only calendars that only
 * the app knows about.
 *
 * Everything that names an event or a server (the sets with their titles,
 * the sync configuration with its passwords, snoozed reminders, the
 * notifications that stay up, the last worker error) is kept in the
 * {@link SecretVault}. The preferences file
 * holds bookkeeping only. Methods that read the vault throw
 * {@link VaultException} when the Keystore fails: callers must tell "there
 * are no reminders" from "the reminders cannot be read right now".
 */
public class ReminderStore {
    private static final String PREFS = "calendar_reminders";

    private static final String VAULT_SETS = "reminders.sets";
    private static final String VAULT_CONFIG = "reminders.config";
    private static final String VAULT_EXTRA = "reminders.extra";
    private static final String VAULT_STANDING = "reminders.standing";
    private static final String VAULT_WORKER_ERROR = "reminders.workerError";

    private static final String KEY_SCHEDULED = "scheduled";
    private static final String KEY_FIRED = "firedIds";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_ZONE = "zone";
    private static final String KEY_WORKER_RUN = "workerLastRun";
    private static final String KEY_WORKER_FAILED = "workerFailed";
    private static final String KEY_WORKER_OK = "workerLastSuccess";

    /** Written in clear by versions that had no vault; moved or removed on first use. */
    private static final String LEGACY_SETS = "sets";
    private static final String LEGACY_CONFIG = "config";
    private static final String LEGACY_FIRED = "fired";
    private static final String LEGACY_WORKER_ERROR = "workerLastError";

    private static final long FIRED_RETENTION_MS = 3L * 24 * 3600 * 1000;
    /** Snoozed and test reminders are kept this long after their time, for the check after a reboot. */
    private static final long EXTRA_RETENTION_MS = 24L * 3600 * 1000;
    /**
     * Notifications that stay up kept at most, the newest ones. The system
     * keeps some 50 notifications of an app; an older one beyond these stays
     * where it is but is no longer put up again.
     */
    static final int MAX_STANDING = 24;

    /**
     * One lock for the whole process. The app, the worker and the receivers
     * all read, change and write back the same values, on different threads.
     */
    private static final Object LOCK = new Object();
    private static ReminderStore instance;

    private final KeyValues prefs;
    private final SecretVault vault;

    // Decrypted copies, so that a burst of calls costs one Keystore operation.
    private boolean migrated;
    private Map<String, ReminderSet> sets;
    private List<Reminder> extras;
    private List<Reminder> standing;
    private Map<String, Long> fired;
    private String configJson;
    private String workerError;
    private boolean workerErrorLoaded;

    /** For tests; the app uses {@link #get}, because the cached copies need a single instance. */
    ReminderStore(KeyValues prefs, SecretVault vault) {
        this.prefs = prefs;
        this.vault = vault;
    }

    public static ReminderStore get(Context context) {
        synchronized (LOCK) {
            if (instance == null) instance = new ReminderStore(new SharedPrefsValues(context, PREFS), SecretVault.get(context));
            return instance;
        }
    }

    /** Moves what older versions wrote in clear into the vault, once. */
    private void migrate() throws VaultException {
        if (migrated) return;
        moveToVault(LEGACY_SETS, VAULT_SETS);
        moveToVault(LEGACY_CONFIG, VAULT_CONFIG);
        moveToVault(LEGACY_WORKER_ERROR, VAULT_WORKER_ERROR);
        migrated = true;
    }

    private void moveToVault(String legacyKey, String name) throws VaultException {
        String plain = prefs.getString(legacyKey);
        if (plain == null) return;
        // A value already in the vault is newer: an earlier run was interrupted after writing it.
        if (!vault.has(name)) vault.putString(name, plain);
        prefs.remove(legacyKey);
    }

    // ---------------------------------------------------------------------
    // Enabled flag

    public boolean isEnabled() {
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    public void setEnabled(boolean enabled) {
        prefs.putBoolean(KEY_ENABLED, enabled);
    }

    // ---------------------------------------------------------------------
    // Reminder sets

    public static class ReminderSet {
        public final String source;
        public final long updatedAt;
        public final List<Reminder> items;

        ReminderSet(String source, long updatedAt, List<Reminder> items) {
            this.source = source;
            this.updatedAt = updatedAt;
            this.items = Collections.unmodifiableList(items);
        }
    }

    private static List<Reminder> parseItems(JSONArray arr) {
        List<Reminder> items = new ArrayList<>();
        if (arr == null) return items;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            Reminder r = o == null ? null : Reminder.fromJson(o);
            if (r != null) items.add(r);
        }
        return items;
    }

    private static JSONArray itemsJson(List<Reminder> items) throws JSONException {
        JSONArray arr = new JSONArray();
        for (Reminder r : items) arr.put(r.toJson());
        return arr;
    }

    private Map<String, ReminderSet> loadSets() throws VaultException {
        if (sets != null) return sets;
        migrate();
        Map<String, ReminderSet> out = new HashMap<>();
        String json = vault.getString(VAULT_SETS);
        if (json != null) {
            try {
                JSONObject root = new JSONObject(json);
                Iterator<String> keys = root.keys();
                while (keys.hasNext()) {
                    String calendarKey = keys.next();
                    JSONObject set = root.getJSONObject(calendarKey);
                    out.put(calendarKey, new ReminderSet(set.optString("source"), set.optLong("updatedAt"), parseItems(set.optJSONArray("items"))));
                }
            } catch (JSONException ignored) {
                // Corrupt state: start from scratch.
                out.clear();
            }
        }
        sets = out;
        return out;
    }

    private void writeSets(Map<String, ReminderSet> next) throws VaultException {
        JSONObject root = new JSONObject();
        try {
            for (Map.Entry<String, ReminderSet> e : next.entrySet()) {
                JSONObject set = new JSONObject();
                set.put("source", e.getValue().source);
                set.put("updatedAt", e.getValue().updatedAt);
                set.put("items", itemsJson(e.getValue().items));
                root.put(e.getKey(), set);
            }
        } catch (JSONException e) {
            return;
        }
        vault.putString(VAULT_SETS, root.toString());
        sets = next;
    }

    private static boolean same(Reminder a, Reminder b) {
        return a.at == b.at && a.floating == b.floating && a.start == b.start && a.allDay == b.allDay
            && a.persistent == b.persistent && a.task == b.task
            && a.key.equals(b.key) && a.title.equals(b.title) && a.body.equals(b.body);
    }

    private static boolean same(ReminderSet set, List<Reminder> items, String source) {
        if (set == null || !set.source.equals(source) || set.items.size() != items.size()) return false;
        for (int i = 0; i < items.size(); i++) {
            if (!same(set.items.get(i), items.get(i))) return false;
        }
        return true;
    }

    public Map<String, ReminderSet> getSets() throws VaultException {
        synchronized (LOCK) {
            return new HashMap<>(loadSets());
        }
    }

    /** Replaces every set with the given ones (used by the app). */
    public void replaceAllSets(Map<String, List<Reminder>> incoming, String source) throws VaultException {
        synchronized (LOCK) {
            Map<String, ReminderSet> current = loadSets();
            Map<String, ReminderSet> next = new HashMap<>();
            long now = System.currentTimeMillis();
            boolean changed = current.size() != incoming.size();
            for (Map.Entry<String, List<Reminder>> e : incoming.entrySet()) {
                ReminderSet old = current.get(e.getKey());
                List<Reminder> items = withLate(old, e.getValue(), now);
                // The app pushes its full list often and mostly unchanged; an
                // identical set is kept as it is, so nothing has to be encrypted again.
                boolean keep = same(old, items, source);
                next.put(e.getKey(), keep ? old : new ReminderSet(source, now, new ArrayList<>(items)));
                changed |= !keep;
            }
            if (changed) writeSets(next);
            // Every set is fresh, so every wall-clock time in it was computed in today's zone.
            prefs.putString(KEY_ZONE, TimeZone.getDefault().getID());
        }
    }

    /**
     * {@code items} after the reminders of {@code old} that came due less
     * than {@link ReminderScheduler#MISSED_GRACE_MS} ago, have not been shown
     * and are not among them. The app and the worker list reminders from now
     * on, and an alarm the system delivers late (Doze, an inexact alarm) has
     * to find its reminder still there, under the key it was set with.
     */
    private List<Reminder> withLate(ReminderSet old, List<Reminder> items, long now) {
        if (old == null) return items;
        Map<String, Long> fired = loadFired();
        List<Reminder> late = new ArrayList<>();
        Set<String> keys = null;
        for (Reminder r : old.items) {
            if (r.at >= now || r.at < now - ReminderScheduler.MISSED_GRACE_MS || shown(fired, r, now)) continue;
            if (keys == null) {
                keys = new HashSet<>();
                for (Reminder i : items) keys.add(i.key);
            }
            if (!keys.contains(r.key)) late.add(r);
        }
        if (late.isEmpty()) return items;
        late.addAll(items);
        return late;
    }

    /** Replaces one calendar's set (used by the background worker). */
    public void replaceSet(String calendarKey, List<Reminder> items, String source) throws VaultException {
        synchronized (LOCK) {
            rezone(TimeZone.getDefault());
            Map<String, ReminderSet> current = loadSets();
            items = withLate(current.get(calendarKey), items, System.currentTimeMillis());
            if (same(current.get(calendarKey), items, source)) return;
            Map<String, ReminderSet> next = new HashMap<>(current);
            next.put(calendarKey, new ReminderSet(source, System.currentTimeMillis(), new ArrayList<>(items)));
            writeSets(next);
        }
    }

    /** Every reminder at or after {@code from}, de-duplicated by key, sorted by time. */
    public List<Reminder> allUpcoming(long from) throws VaultException {
        synchronized (LOCK) {
            Map<String, Reminder> byKey = new HashMap<>();
            for (ReminderSet set : loadSets().values()) {
                for (Reminder r : set.items) {
                    if (r.at >= from) byKey.put(r.key, r);
                }
            }
            for (Reminder r : loadExtras()) {
                if (r.at >= from) byKey.put(r.key, r);
            }
            List<Reminder> list = new ArrayList<>(byKey.values());
            Collections.sort(list, (a, b) -> a.at != b.at ? Long.compare(a.at, b.at) : a.key.compareTo(b.key));
            return list;
        }
    }

    /** The first {@code limit} of {@link #allUpcoming} that have not been shown yet. */
    public List<Reminder> nextUnfired(long from, int limit) throws VaultException {
        synchronized (LOCK) {
            List<Reminder> out = new ArrayList<>();
            Map<String, Long> shown = loadFired();
            long now = System.currentTimeMillis();
            for (Reminder r : allUpcoming(from)) {
                if (out.size() >= limit) break;
                if (!shown(shown, r, now)) out.add(r);
            }
            return out;
        }
    }

    /** The reminder with this key, or null when no set holds it any more. */
    public Reminder find(String key) throws VaultException {
        synchronized (LOCK) {
            for (ReminderSet set : loadSets().values()) {
                for (Reminder r : set.items) {
                    if (r.key.equals(key)) return r;
                }
            }
            for (Reminder r : loadExtras()) {
                if (r.key.equals(key)) return r;
            }
            return null;
        }
    }

    /** Reminders whose time lies in [from, to) and that have not fired yet, oldest first. */
    public List<Reminder> missedBetween(long from, long to) throws VaultException {
        synchronized (LOCK) {
            List<Reminder> out = new ArrayList<>();
            Map<String, Long> shown = loadFired();
            for (Reminder r : allUpcoming(from)) {
                if (r.at < to && !shown(shown, r, to)) out.add(r);
            }
            return out;
        }
    }

    // ---------------------------------------------------------------------
    // Extra reminders (snooze, test): not part of any calendar's set, so a
    // push from the app does not remove them, and they survive a reboot.

    private List<Reminder> loadExtras() throws VaultException {
        if (extras != null) return extras;
        migrate();
        List<Reminder> out = new ArrayList<>();
        String json = vault.getString(VAULT_EXTRA);
        if (json != null) {
            try {
                out = parseItems(new JSONArray(json));
            } catch (JSONException ignored) {
            }
        }
        extras = out;
        return out;
    }

    public void addExtra(Reminder reminder) throws VaultException {
        synchronized (LOCK) {
            long oldest = System.currentTimeMillis() - EXTRA_RETENTION_MS;
            List<Reminder> next = new ArrayList<>();
            for (Reminder r : loadExtras()) {
                if (r.at >= oldest && !r.key.equals(reminder.key)) next.add(r);
            }
            next.add(reminder);
            try {
                vault.putString(VAULT_EXTRA, itemsJson(next).toString());
            } catch (JSONException e) {
                return;
            }
            extras = next;
        }
    }

    // ---------------------------------------------------------------------
    // Notifications that stay up (persistent reminders that were shown), one
    // per item, oldest first: put up again after a swipe, a restart or an
    // update, until Done, Snooze or Dismiss, or the app clears them.

    private List<Reminder> loadStanding() throws VaultException {
        if (standing != null) return standing;
        migrate();
        List<Reminder> out = new ArrayList<>();
        String json = vault.getString(VAULT_STANDING);
        if (json != null) {
            try {
                out = parseItems(new JSONArray(json));
            } catch (JSONException ignored) {
            }
        }
        standing = out;
        return out;
    }

    private void writeStanding(List<Reminder> next) throws VaultException {
        try {
            if (next.isEmpty()) vault.remove(VAULT_STANDING);
            else vault.putString(VAULT_STANDING, itemsJson(next).toString());
        } catch (JSONException e) {
            return;
        }
        standing = next;
    }

    /**
     * Keeps a shown persistent reminder up, in place of the one of its item
     * shown before. Returns those that gave way to it beyond {@link #MAX_STANDING}.
     */
    public List<Reminder> addStanding(Reminder reminder) throws VaultException {
        synchronized (LOCK) {
            String item = reminder.item();
            List<Reminder> next = new ArrayList<>();
            for (Reminder r : loadStanding()) {
                if (!r.item().equals(item)) next.add(r);
            }
            next.add(reminder);
            List<Reminder> dropped = new ArrayList<>();
            while (next.size() > MAX_STANDING) dropped.add(next.remove(0));
            writeStanding(next);
            return dropped;
        }
    }

    /** The notification kept up for the item of {@code key}, or null. */
    public Reminder findStanding(String key) throws VaultException {
        synchronized (LOCK) {
            String item = Reminder.itemOf(key);
            for (Reminder r : loadStanding()) {
                if (r.item().equals(item)) return r;
            }
            return null;
        }
    }

    /** Stops keeping up the notification of the item of {@code key}; the one that was kept, or null. */
    public Reminder removeStanding(String key) throws VaultException {
        synchronized (LOCK) {
            String item = Reminder.itemOf(key);
            List<Reminder> next = new ArrayList<>();
            Reminder removed = null;
            for (Reminder r : loadStanding()) {
                if (r.item().equals(item)) removed = r;
                else next.add(r);
            }
            if (removed != null) writeStanding(next);
            return removed;
        }
    }

    /** Every notification kept up, oldest first. */
    public List<Reminder> standing() throws VaultException {
        synchronized (LOCK) {
            return new ArrayList<>(loadStanding());
        }
    }

    /** Stops keeping up all of them (reminders turned off); the ones that were kept. */
    public List<Reminder> clearStanding() throws VaultException {
        synchronized (LOCK) {
            List<Reminder> all = new ArrayList<>(loadStanding());
            if (!all.isEmpty()) writeStanding(new ArrayList<>());
            return all;
        }
    }

    // ---------------------------------------------------------------------
    // Time zone

    /** The instant at which a clock in {@code to} shows what a clock in {@code from} shows at {@code millis}. */
    public static long sameWallClock(long millis, TimeZone from, TimeZone to) {
        Calendar a = new GregorianCalendar(from, Locale.ROOT);
        a.setTimeInMillis(millis);
        Calendar b = new GregorianCalendar(to, Locale.ROOT);
        b.clear();
        b.set(a.get(Calendar.YEAR), a.get(Calendar.MONTH), a.get(Calendar.DAY_OF_MONTH), a.get(Calendar.HOUR_OF_DAY), a.get(Calendar.MINUTE), a.get(Calendar.SECOND));
        b.set(Calendar.MILLISECOND, a.get(Calendar.MILLISECOND));
        return b.getTimeInMillis();
    }

    /**
     * Moves reminders that follow the wall clock (all-day events, times
     * without a zone) to the given zone, if the stored ones were computed in
     * another. A reminder for an all-day event at 9:00 has to stay at 9:00
     * local time after a flight. Returns true when a zone change was applied.
     *
     * Only reminders marked as floating are moved, together with the time of
     * their item; the others name instants, which a zone does not change.
     */
    public boolean rezone(TimeZone zone) throws VaultException {
        synchronized (LOCK) {
            String stored = prefs.getString(KEY_ZONE);
            if (zone.getID().equals(stored)) return false;
            if (stored != null) {
                TimeZone from = TimeZone.getTimeZone(stored);
                Map<String, ReminderSet> next = new HashMap<>();
                boolean changed = false;
                for (Map.Entry<String, ReminderSet> e : loadSets().entrySet()) {
                    List<Reminder> items = new ArrayList<>();
                    boolean moved = false;
                    for (Reminder r : e.getValue().items) {
                        // The item's time moves with the trigger: both are times on the clock.
                        Reminder shifted = r.floating ? r.moved(sameWallClock(r.at, from, zone), r.hasStart() ? sameWallClock(r.start, from, zone) : r.start) : r;
                        moved |= shifted != r;
                        items.add(shifted);
                    }
                    next.put(e.getKey(), moved ? new ReminderSet(e.getValue().source, e.getValue().updatedAt, items) : e.getValue());
                    changed |= moved;
                }
                if (changed) writeSets(next);
            }
            prefs.putString(KEY_ZONE, zone.getID());
            return stored != null;
        }
    }

    // ---------------------------------------------------------------------
    // Scheduled ids (so stale alarms can be cancelled)

    public List<Integer> getScheduledIds() {
        synchronized (LOCK) {
            List<Integer> ids = new ArrayList<>();
            String json = prefs.getString(KEY_SCHEDULED);
            if (json == null) return ids;
            try {
                JSONArray arr = new JSONArray(json);
                for (int i = 0; i < arr.length(); i++) ids.add(arr.getInt(i));
            } catch (JSONException ignored) {
            }
            return ids;
        }
    }

    public void setScheduledIds(List<Integer> ids) {
        synchronized (LOCK) {
            JSONArray arr = new JSONArray();
            for (Integer id : ids) arr.put(id.intValue());
            prefs.putString(KEY_SCHEDULED, arr.toString());
        }
    }

    // ---------------------------------------------------------------------
    // Fired reminders (avoid showing the same reminder twice)

    /**
     * What a fired reminder is remembered by. Keys contain the address of the
     * calendar server, so the preferences file gets a digest of the key instead.
     */
    static String firedId(String key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            return Encoding.hex(digest).substring(0, 32);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private Map<String, Long> loadFired() {
        if (fired != null) return fired;
        Map<String, Long> out = new HashMap<>();
        boolean legacy = prefs.getString(LEGACY_FIRED) != null;
        try {
            // The old map was keyed by the reminder keys themselves.
            JSONObject stored = new JSONObject(legacy ? prefs.getString(LEGACY_FIRED) : orEmpty(prefs.getString(KEY_FIRED)));
            Iterator<String> keys = stored.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(legacy ? firedId(k) : k, stored.optLong(k));
            }
        } catch (JSONException ignored) {
        }
        fired = out;
        if (legacy) {
            writeFired();
            prefs.remove(LEGACY_FIRED);
        }
        return out;
    }

    private static String orEmpty(String json) {
        return json == null ? "{}" : json;
    }

    private void writeFired() {
        prefs.putString(KEY_FIRED, new JSONObject(fired).toString());
    }

    public boolean wasFired(String key) {
        synchronized (LOCK) {
            return loadFired().containsKey(firedId(key));
        }
    }

    /** Whether the reminder was shown, as of {@code now}: see {@link #shown}. */
    public boolean wasFired(Reminder r, long now) {
        synchronized (LOCK) {
            return shown(loadFired(), r, now);
        }
    }

    /** "item|time|offset", the app's key of a reminder since it carries the item's time. */
    private static final Pattern WITH_TIME = Pattern.compile("(.*)\\|(-?\\d+)\\|(-?\\d+)", Pattern.DOTALL);

    /**
     * The key earlier versions of the app gave the same reminder of an event
     * ("item|offset", without the item's time), or null for a key of another
     * form. Keys of the worker and of tasks are of that form too and never had
     * the shorter one; theirs is simply never found among the fired.
     */
    static String earlierKey(String key) {
        Matcher m = WITH_TIME.matcher(key);
        return m.matches() ? m.group(1) + "|" + m.group(3) : null;
    }

    /**
     * Whether a reminder was shown: under its key, or, once its time has
     * passed, under the key an earlier version gave it, so a reminder shown
     * before the keys changed does not fire again as a late one. Only then: a
     * reminder still to come under a new key is that of a moved event.
     * Scheduling and firing ask the same, or an alarm left unshown would be set
     * again at once.
     */
    private static boolean shown(Map<String, Long> fired, Reminder r, long now) {
        if (fired.containsKey(firedId(r.key))) return true;
        if (r.at > now) return false;
        String earlier = earlierKey(r.key);
        return earlier != null && fired.containsKey(firedId(earlier));
    }

    public void markFired(String key) {
        synchronized (LOCK) {
            Map<String, Long> all = loadFired();
            long now = System.currentTimeMillis();
            all.put(firedId(key), now);
            // Forget entries older than 3 days to keep the map small.
            Iterator<Map.Entry<String, Long>> it = all.entrySet().iterator();
            while (it.hasNext()) {
                if (now - it.next().getValue() >= FIRED_RETENTION_MS) it.remove();
            }
            writeFired();
        }
    }

    // ---------------------------------------------------------------------
    // Background sync configuration (CalDAV addresses, user names and passwords)

    public JSONObject getConfig() throws VaultException {
        synchronized (LOCK) {
            if (configJson == null) {
                migrate();
                configJson = orEmpty(vault.getString(VAULT_CONFIG));
            }
            try {
                return new JSONObject(configJson);
            } catch (JSONException e) {
                return new JSONObject();
            }
        }
    }

    public void setConfig(JSONObject config) throws VaultException {
        synchronized (LOCK) {
            migrate();
            String json = config.toString();
            // The app sends the configuration on every start; an unchanged one is not encrypted again.
            if (json.equals(configJson) && vault.has(VAULT_CONFIG)) return;
            vault.putString(VAULT_CONFIG, json);
            configJson = json;
        }
    }

    // ---------------------------------------------------------------------
    // Worker diagnostics

    /** Records a run of the background worker; {@code error} is null when it went well. */
    public void recordWorkerRun(String error) {
        synchronized (LOCK) {
            long now = System.currentTimeMillis();
            prefs.putLong(KEY_WORKER_RUN, now);
            prefs.putBoolean(KEY_WORKER_FAILED, error != null);
            if (error == null) prefs.putLong(KEY_WORKER_OK, now);
            // The text names calendars, so it goes into the vault. If that fails the
            // flag above still says that the run went wrong.
            workerError = null;
            workerErrorLoaded = true;
            try {
                migrate();
                if (error == null) {
                    vault.remove(VAULT_WORKER_ERROR);
                } else {
                    vault.putString(VAULT_WORKER_ERROR, error);
                    workerError = error;
                }
            } catch (VaultException ignored) {
                vault.remove(VAULT_WORKER_ERROR);
            }
        }
    }

    public long getWorkerLastRun() {
        return prefs.getLong(KEY_WORKER_RUN, 0);
    }

    public long getWorkerLastSuccess() {
        return prefs.getLong(KEY_WORKER_OK, 0);
    }

    /** The error of the last run: null when it went well, an empty text when it failed but the details cannot be read. */
    public String getWorkerLastError() {
        synchronized (LOCK) {
            if (!workerErrorLoaded) {
                try {
                    migrate();
                    workerError = vault.getString(VAULT_WORKER_ERROR);
                    workerErrorLoaded = true;
                } catch (VaultException ignored) {
                }
            }
            if (workerError != null) return workerError;
            return prefs.getBoolean(KEY_WORKER_FAILED, false) ? "" : null;
        }
    }
}
