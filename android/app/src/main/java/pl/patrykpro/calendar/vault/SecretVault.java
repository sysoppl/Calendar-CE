package pl.patrykpro.calendar.vault;

import android.content.Context;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import java.util.Arrays;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import pl.patrykpro.calendar.util.Encoding;

/**
 * Small named secrets, encrypted at rest: the CalDAV sync configuration
 * with its passwords, and the reminder texts.
 *
 * Every value is sealed with AES-256-GCM under one key that lives in the
 * Android Keystore and cannot be exported. The key is not tied to a screen
 * unlock or a fingerprint, because reminders and the background refresh have
 * to read these values while the device is locked. Each write draws a fresh
 * IV, and the name of the value is authenticated with it, so one stored value
 * cannot be put in the place of another.
 *
 * Stored form (base64 in a private preferences file):
 *   [format 1][IV length][IV][ciphertext with the 16-byte tag]
 */
public final class SecretVault {
    /** Where the key comes from: the Android Keystore in the app, a plain key in unit tests. */
    public interface KeySource {
        SecretKey key() throws GeneralSecurityException;

        /**
         * Called when a cipher refused the key. The source forgets its handle,
         * so that the next {@link #key} looks the key up again, and throws the
         * key away if it can never work again, so that a new one is made.
         */
        void refused(InvalidKeyException reason);
    }

    private static final String PREFS = "calendar_vault";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte FORMAT = 1;
    private static final int TAG_BITS = 128;
    private static final int TAG_LENGTH = TAG_BITS / 8;
    private static final String AAD_PREFIX = "calendar-vault/v1/";

    private static final Object LOCK = new Object();
    private static SecretVault instance;

    private final KeyValues values;
    private final KeySource keys;

    public SecretVault(KeyValues values, KeySource keys) {
        this.values = values;
        this.keys = keys;
    }

    /** The vault of this app, on the Keystore key. */
    public static SecretVault get(Context context) {
        synchronized (LOCK) {
            if (instance == null) instance = new SecretVault(new SharedPrefsValues(context, PREFS), new KeystoreKeys(new SharedPrefsValues(context, PREFS + "_keys")));
            return instance;
        }
    }

    private static byte[] aad(String name) {
        return (AAD_PREFIX + name).getBytes(StandardCharsets.UTF_8);
    }

    private SecretKey key() throws VaultException {
        try {
            return keys.key();
        } catch (GeneralSecurityException | RuntimeException e) {
            throw new VaultException("The device key store is not available", e);
        }
    }

    /** True when a value is stored under this name; it is not decrypted. */
    public boolean has(String name) {
        synchronized (LOCK) {
            return values.getString(name) != null;
        }
    }

    public void remove(String name) {
        synchronized (LOCK) {
            values.remove(name);
        }
    }

    private byte[] seal(SecretKey key, String name, byte[] plain) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        // No IV is passed in: the provider draws a fresh one for every value.
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(aad(name));
        byte[] body = cipher.doFinal(plain);
        byte[] iv = cipher.getIV();
        byte[] sealed = new byte[2 + iv.length + body.length];
        sealed[0] = FORMAT;
        sealed[1] = (byte) iv.length;
        System.arraycopy(iv, 0, sealed, 2, iv.length);
        System.arraycopy(body, 0, sealed, 2 + iv.length, body.length);
        return sealed;
    }

    /**
     * Encrypts and stores a value.
     *
     * @throws VaultException when the Keystore fails; nothing was changed then
     */
    public void putString(String name, String value) throws VaultException {
        byte[] plain = value.getBytes(StandardCharsets.UTF_8);
        try {
            synchronized (LOCK) {
                for (int attempt = 0; ; attempt++) {
                    SecretKey key = key();
                    try {
                        values.putString(name, Encoding.base64(seal(key, name, plain)));
                        return;
                    } catch (InvalidKeyException e) {
                        // A stale handle or a dead key: one more try on what the source hands out next.
                        keys.refused(e);
                        if (attempt > 0) throw new VaultException("The device key was refused", e);
                    } catch (GeneralSecurityException | RuntimeException e) {
                        throw new VaultException("The value could not be encrypted", e);
                    }
                }
            }
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
    }

    /**
     * Reads and decrypts a value. Returns null when there is none, and also
     * when the stored one can never be opened again (its key is gone, or it
     * was damaged): that value is dropped, since whoever wrote it can write it
     * again.
     *
     * @throws VaultException when the Keystore fails for now; the value stays
     */
    public String getString(String name) throws VaultException {
        synchronized (LOCK) {
            String stored = values.getString(name);
            if (stored == null) return null;
            byte[] sealed;
            try {
                sealed = Encoding.fromBase64(stored);
            } catch (IllegalArgumentException e) {
                sealed = new byte[0];
            }
            int ivLength = sealed.length > 2 ? sealed[1] & 0xff : 0;
            if (sealed.length < 2 || sealed[0] != FORMAT || ivLength == 0 || sealed.length < 2 + ivLength + TAG_LENGTH) {
                values.remove(name);
                return null;
            }
            for (int attempt = 0; ; attempt++) {
                SecretKey key = key();
                byte[] plain;
                try {
                    Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                    cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, sealed, 2, ivLength));
                    cipher.updateAAD(aad(name));
                    plain = cipher.doFinal(sealed, 2 + ivLength, sealed.length - 2 - ivLength);
                } catch (AEADBadTagException e) {
                    // Sealed under a key that no longer exists, or altered on disk.
                    values.remove(name);
                    return null;
                } catch (InvalidKeyException e) {
                    // As when writing. If the key was replaced, the next attempt ends
                    // in the branch above and the value is dropped.
                    keys.refused(e);
                    if (attempt > 0) throw new VaultException("The device key was refused", e);
                    continue;
                } catch (GeneralSecurityException | RuntimeException e) {
                    throw new VaultException("The value could not be decrypted", e);
                }
                try {
                    return new String(plain, StandardCharsets.UTF_8);
                } finally {
                    Arrays.fill(plain, (byte) 0);
                }
            }
        }
    }
}
