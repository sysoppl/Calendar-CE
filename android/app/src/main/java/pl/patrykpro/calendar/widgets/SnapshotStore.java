package pl.patrykpro.calendar.widgets;

import org.json.JSONObject;

import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.VaultException;

/**
 * The snapshot at rest, encrypted, and in memory, parsed.
 *
 * Titles, places and calendar names are private, so the snapshot is kept in
 * the app's vault ({@link SecretVault}, AES-GCM under the Keystore key the
 * reminders use), in a folder of its own ({@link FileValues}) so that the
 * reminders' preferences file does not carry it. Decrypting and parsing it
 * takes a moment, and widgets are drawn often (every list, every resize, every
 * refresh), so the parsed form is kept once read, until the next one comes.
 *
 * What is stored is the web app's JSON as it came, not the parsed form: a
 * later version of this class may read more of it.
 */
final class SnapshotStore {
    static final String NAME = "snapshot";

    private final SecretVault vault;
    private Snapshot cached;
    private boolean loaded;

    SnapshotStore(SecretVault vault) {
        this.vault = vault;
    }

    /**
     * The current snapshot, or null when there is none (never pushed, cleared,
     * or one that can no longer be opened).
     *
     * @throws VaultException when the Keystore does not answer for now; nothing is cached then, so the next call tries again
     */
    synchronized Snapshot get() throws VaultException {
        if (loaded) return cached;
        String json = vault.getString(NAME);
        Snapshot snapshot = null;
        if (json != null) {
            try {
                snapshot = Snapshot.parse(new JSONObject(json));
            } catch (org.json.JSONException e) {
                snapshot = null;
            }
            // Stored by an earlier version and not readable now: the app sends a new one when it is opened.
            if (snapshot == null) vault.remove(NAME);
        }
        cached = snapshot;
        loaded = true;
        return snapshot;
    }

    /**
     * Stores and caches a new snapshot.
     *
     * @return the parsed snapshot
     * @throws IllegalArgumentException when it is not a snapshot the widgets can use; the one before stays
     * @throws VaultException           when it could not be encrypted; the one before stays
     */
    synchronized Snapshot put(JSONObject json) throws VaultException {
        Snapshot snapshot = Snapshot.parse(json);
        if (snapshot == null) throw new IllegalArgumentException("Not a usable snapshot");
        vault.putString(NAME, json.toString());
        cached = snapshot;
        loaded = true;
        return snapshot;
    }

    /** Forgets the snapshot, on disk and in memory. */
    synchronized void clear() {
        vault.remove(NAME);
        cached = null;
        loaded = true;
    }
}
