package pl.patrykpro.calendar.vault;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import java.security.Key;
import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * The vault key in the Android Keystore: AES-256 for GCM only, generated on
 * the device and never exportable.
 *
 * It is deliberately not bound to user authentication or to an unlocked
 * screen. A reminder has to be read when its alarm fires, and the hourly
 * refresh needs the CalDAV passwords, both with the screen locked; a key that asks
 * for the user first would be useless to them.
 *
 * Once a key was made, a Keystore that answers with no key under the alias
 * is taken for one that is not answering (its service restarting, say), not
 * for an empty one: a key made anew in its place would leave every stored
 * value unreadable, and the vault drops what it cannot open. The mark that a
 * key was made lives in a preferences file of its own; it goes when the key
 * is thrown away for good, so that a new one may be made then. A Keystore
 * that keeps answering so for MISSING_GRACE_MS is taken at its word after
 * all (a key gone without the system saying so, as on some devices after an
 * OS upgrade): a new key is made, as it was made at once before.
 */
final class KeystoreKeys implements SecretVault.KeySource {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS = "calendar.vault.v1";
    /** The mark that a key was made under the alias. */
    static final String MADE = "key.made";
    /** Since when the Keystore answers with no key for a made key (ms since the epoch); absent while it answers. */
    static final String MISSING_SINCE = "key.missingSince";
    /** How long such answers are taken for a Keystore that is not answering, before a new key is made. */
    static final long MISSING_GRACE_MS = 6 * 60 * 60 * 1000L;
    /** The Keystore service occasionally fails under load; one more try after a pause usually works. */
    private static final long RETRY_PAUSE_MS = 150;

    private final KeyValues marks;
    private SecretKey cached;

    KeystoreKeys(KeyValues marks) {
        this.marks = marks;
    }

    @Override
    public synchronized SecretKey key() throws GeneralSecurityException {
        if (cached != null) return cached;
        try {
            cached = loadOrCreate(false);
        } catch (GeneralSecurityException | RuntimeException first) {
            boolean replacing = dead(first);
            if (replacing) {
                delete();
            } else {
                try {
                    Thread.sleep(RETRY_PAUSE_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            cached = loadOrCreate(replacing);
        }
        return cached;
    }

    @Override
    public synchronized void refused(InvalidKeyException reason) {
        // The handle may be stale even when the key is fine; look it up again next time.
        cached = null;
        if (dead(reason)) delete();
    }

    /**
     * Whether a key may be made when the Keystore answers with none: the first
     * time, after the old key was thrown away ({@code replacing}), and once the
     * Keystore has answered so for MISSING_GRACE_MS ({@code missingForMs}); not
     * when one was made before and the Keystore merely does not answer for it now.
     */
    static boolean mayGenerate(boolean madeBefore, boolean replacing, long missingForMs) {
        return !madeBefore || replacing || missingForMs >= MISSING_GRACE_MS;
    }

    private static KeyStore keyStore() throws GeneralSecurityException {
        KeyStore store = KeyStore.getInstance(PROVIDER);
        try {
            store.load(null);
        } catch (IOException e) {
            throw new GeneralSecurityException("The key store could not be opened", e);
        }
        return store;
    }

    private SecretKey loadOrCreate(boolean replacing) throws GeneralSecurityException {
        Key existing = keyStore().getKey(ALIAS, null);
        if (existing instanceof SecretKey) {
            noteMade();
            return (SecretKey) existing;
        }
        long now = System.currentTimeMillis();
        long since = marks.getLong(MISSING_SINCE, 0L);
        if (since == 0L) {
            marks.putLong(MISSING_SINCE, now);
            since = now;
        }
        if (!mayGenerate(marks.getBoolean(MADE, false), replacing, now - since)) {
            throw new GeneralSecurityException("The key store does not answer for the vault key");
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        SecretKey made = generator.generateKey();
        noteMade();
        return made;
    }

    private void noteMade() {
        if (!marks.getBoolean(MADE, false)) marks.putBoolean(MADE, true);
        if (marks.getLong(MISSING_SINCE, 0L) != 0L) marks.remove(MISSING_SINCE);
    }

    private void delete() {
        try {
            keyStore().deleteEntry(ALIAS);
        } catch (GeneralSecurityException | RuntimeException ignored) {
            // Nothing more can be done here; creating the new key reports the failure.
        }
        marks.remove(MADE);
        marks.remove(MISSING_SINCE);
    }

    /**
     * True only when the system itself says the key is gone for good. Anything
     * else is treated as a passing failure: throwing a working key away would
     * lose every stored reminder until the app is opened again.
     */
    private static boolean dead(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause()) {
            if (t instanceof KeyPermanentlyInvalidatedException) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && t instanceof android.security.KeyStoreException) {
                return ((android.security.KeyStoreException) t).getNumericErrorCode() == android.security.KeyStoreException.ERROR_KEY_CORRUPTED;
            }
        }
        return false;
    }
}
