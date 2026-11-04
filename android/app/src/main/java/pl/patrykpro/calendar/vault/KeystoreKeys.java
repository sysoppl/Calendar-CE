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
 */
final class KeystoreKeys implements SecretVault.KeySource {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS = "calendar.vault.v1";
    /** The Keystore service occasionally fails under load; one more try after a pause usually works. */
    private static final long RETRY_PAUSE_MS = 150;

    private SecretKey cached;

    @Override
    public synchronized SecretKey key() throws GeneralSecurityException {
        if (cached != null) return cached;
        try {
            cached = loadOrCreate();
        } catch (GeneralSecurityException | RuntimeException first) {
            if (dead(first)) {
                delete();
            } else {
                try {
                    Thread.sleep(RETRY_PAUSE_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            cached = loadOrCreate();
        }
        return cached;
    }

    @Override
    public synchronized void refused(InvalidKeyException reason) {
        // The handle may be stale even when the key is fine; look it up again next time.
        cached = null;
        if (dead(reason)) delete();
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

    private static SecretKey loadOrCreate() throws GeneralSecurityException {
        Key existing = keyStore().getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private static void delete() {
        try {
            keyStore().deleteEntry(ALIAS);
        } catch (GeneralSecurityException | RuntimeException ignored) {
            // Nothing more can be done here; creating the new key reports the failure.
        }
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
