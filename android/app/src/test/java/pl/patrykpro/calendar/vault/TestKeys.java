package pl.patrykpro.calendar.vault;

import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import java.security.SecureRandom;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/**
 * A plain AES key in place of the Android Keystore, which does not exist in
 * JVM unit tests. It can be told to fail the ways the Keystore does.
 */
public final class TestKeys implements SecretVault.KeySource {
    private SecretKey key = fresh();
    /** While true, the key store is "down": asking for the key fails. */
    public boolean unavailable;
    /** While true, a refused key is not replaced: the Keystore keeps handing out one that does not work. */
    public boolean stuck;
    /** How often a cipher refused the key. */
    public int refusals;

    private static SecretKey fresh() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return new SecretKeySpec(bytes, "AES");
    }

    /** The key is lost, as after a wiped Keystore: a new one takes its place. */
    public void lose() {
        key = fresh();
    }

    /** The key turns into one every cipher refuses. */
    public void invalidate() {
        key = new SecretKeySpec(new byte[5], "AES");
    }

    @Override
    public SecretKey key() throws GeneralSecurityException {
        if (unavailable) throw new GeneralSecurityException("Key store unavailable");
        return key;
    }

    @Override
    public void refused(InvalidKeyException reason) {
        refusals++;
        // Unless stuck, the refused key counts as dead for good and a new one is made.
        if (!stuck) key = fresh();
    }
}
