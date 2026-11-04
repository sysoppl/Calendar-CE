package pl.patrykpro.calendar.vault;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.security.KeyStore;

import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

import pl.patrykpro.calendar.util.Encoding;

/**
 * The vault on the real Android Keystore, which the JVM unit tests can only
 * stand in for. Runs on a device or emulator: gradlew connectedDebugAndroidTest.
 */
@RunWith(AndroidJUnit4.class)
public class SecretVaultDeviceTest {
    private static final String FILE = "calendar_vault_devicetest";

    private SharedPreferences file;
    private SecretVault vault;

    @Before
    public void setUp() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        file = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
        file.edit().clear().commit();
        vault = new SecretVault(new SharedPrefsValues(context, FILE), new KeystoreKeys());
    }

    @After
    public void tearDown() {
        file.edit().clear().commit();
    }

    @Test
    public void theKeyStaysInTheKeystoreAndAsksForNoUnlock() throws Exception {
        SecretKey key = new KeystoreKeys().key();
        // No key material in this process.
        assertNull(key.getEncoded());
        KeyInfo info = (KeyInfo) SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
        assertEquals(256, info.getKeySize());
        assertArrayEquals(new String[] {KeyProperties.BLOCK_MODE_GCM}, info.getBlockModes());
        assertEquals(KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT, info.getPurposes());
        // Usable by a receiver or a worker while the screen is locked.
        assertFalse(info.isUserAuthenticationRequired());
        assertEquals(KeyProperties.ORIGIN_GENERATED, info.getOrigin());
    }

    @Test
    public void sealsAndOpensWithTheKeystoreKey() throws Exception {
        String secret = "{\"password\":\"s3cr3t-value\"} zażółć 📅";
        vault.putString("other.secret", secret);
        assertEquals(secret, vault.getString("other.secret"));

        String stored = file.getString("other.secret", null);
        assertFalse(stored.contains("s3cr3t"));
        byte[] sealed = Encoding.fromBase64(stored);
        assertEquals(1, sealed[0]);
        assertEquals(12, sealed[1]);
        assertEquals(2 + 12 + secret.getBytes("UTF-8").length + 16, sealed.length);

        // A fresh IV for every write, drawn by the Keystore.
        vault.putString("other.secret", secret);
        assertNotEquals(stored, file.getString("other.secret", null));
        assertNotEquals(Encoding.hex(sealed).substring(4, 28), Encoding.hex(Encoding.fromBase64(file.getString("other.secret", null))).substring(4, 28));

        // A second vault object, as after a restart of the process, reads the same value.
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(secret, new SecretVault(new SharedPrefsValues(context, FILE), new KeystoreKeys()).getString("other.secret"));
    }

    @Test
    public void handlesAValueTheSizeOfALargeReminderStore() throws Exception {
        StringBuilder large = new StringBuilder();
        for (int i = 0; large.length() < 300_000; i++) large.append("{\"key\":\"https://dav.example.org/cal/").append(i).append(".ics|15\",\"title\":\"Spotkanie\"},");
        vault.putString("reminders.sets", large.toString());
        assertEquals(large.toString(), vault.getString("reminders.sets"));
        vault.putString("empty", "");
        assertEquals("", vault.getString("empty"));
    }

    @Test
    public void aValueCannotBeMovedOrAltered() throws Exception {
        vault.putString("reminders.config", "calendar passwords");
        vault.putString("other.secret", "another secret");
        file.edit().putString("other.secret", file.getString("reminders.config", null)).commit();
        assertNull(vault.getString("other.secret"));
        assertFalse(vault.has("other.secret"));
        assertEquals("calendar passwords", vault.getString("reminders.config"));

        byte[] sealed = Encoding.fromBase64(file.getString("reminders.config", null));
        sealed[sealed.length - 1] ^= 1;
        file.edit().putString("reminders.config", Encoding.base64(sealed)).commit();
        assertNull(vault.getString("reminders.config"));
        assertFalse(vault.has("reminders.config"));
    }

    @Test
    public void startsOverWhenTheKeyIsGone() throws Exception {
        vault.putString("a", "text");
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        keyStore.deleteEntry("calendar.vault.v1");

        // The vault still holds a handle to the deleted key. It notices, makes a new
        // key, and reports the old value as gone instead of failing.
        assertNull(vault.getString("a"));
        assertFalse(vault.has("a"));
        vault.putString("a", "again");
        assertEquals("again", vault.getString("a"));
        assertTrue(keyStore.containsAlias("calendar.vault.v1"));
    }
}
