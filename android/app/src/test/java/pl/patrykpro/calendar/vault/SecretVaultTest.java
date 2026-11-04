package pl.patrykpro.calendar.vault;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import pl.patrykpro.calendar.util.Encoding;

public class SecretVaultTest {
    private final MemoryValues values = new MemoryValues();
    private final TestKeys keys = new TestKeys();
    private final SecretVault vault = new SecretVault(values, keys);

    @Test
    public void storesOnlyCiphertext() throws Exception {
        vault.putString("caldav.password", "{\"password\":\"s3cr3t-value\"}");
        assertEquals("{\"password\":\"s3cr3t-value\"}", vault.getString("caldav.password"));
        assertFalse(values.reveals("s3cr3t"));
        // Stored as base64 of [format][IV length][IV][ciphertext and tag].
        byte[] stored = Encoding.fromBase64(values.getString("caldav.password"));
        assertEquals(1, stored[0]);
        assertEquals(12, stored[1]);
        assertEquals(2 + 12 + "{\"password\":\"s3cr3t-value\"}".length() + 16, stored.length);
    }

    @Test
    public void handlesEmptyAndLargeValuesAndTextOutsideAscii() throws Exception {
        vault.putString("empty", "");
        assertEquals("", vault.getString("empty"));
        StringBuilder large = new StringBuilder();
        for (int i = 0; i < 20000; i++) large.append("Zażółć gęślą jaźń 📅 ");
        vault.putString("large", large.toString());
        assertEquals(large.toString(), vault.getString("large"));
    }

    @Test
    public void drawsAFreshIvForEveryWrite() throws Exception {
        vault.putString("a", "same text");
        String first = values.getString("a");
        vault.putString("a", "same text");
        String second = values.getString("a");
        assertNotEquals(first, second);
        // The IVs themselves differ, not only the ciphertext.
        assertNotEquals(Encoding.hex(Encoding.fromBase64(first)).substring(4, 28), Encoding.hex(Encoding.fromBase64(second)).substring(4, 28));
    }

    @Test
    public void reportsAbsentValues() throws Exception {
        assertNull(vault.getString("nothing"));
        assertFalse(vault.has("nothing"));
        vault.putString("something", "x");
        assertTrue(vault.has("something"));
        vault.remove("something");
        assertFalse(vault.has("something"));
        assertNull(vault.getString("something"));
    }

    @Test
    public void aValueCannotBeMovedToAnotherName() throws Exception {
        vault.putString("reminders.config", "calendar passwords");
        vault.putString("other.secret", "another secret");
        // Someone with write access to the file swaps the two.
        values.map.put("other.secret", values.getString("reminders.config"));
        assertNull(vault.getString("other.secret"));
        assertFalse(vault.has("other.secret"));
        assertEquals("calendar passwords", vault.getString("reminders.config"));
    }

    @Test
    public void dropsAValueThatWasAltered() throws Exception {
        vault.putString("a", "text");
        byte[] stored = Encoding.fromBase64(values.getString("a"));
        for (int at : new int[] {2, 14, stored.length - 1}) {
            byte[] changed = stored.clone();
            changed[at] ^= 1;
            values.map.put("a", Encoding.base64(changed));
            assertNull("byte " + at, vault.getString("a"));
            assertFalse(vault.has("a"));
        }
        for (String junk : new String[] {"", "not base64 at all", "AQ==", Encoding.base64(new byte[] {2, 12, 0, 0}), Encoding.base64(new byte[40])}) {
            values.map.put("a", junk);
            assertNull(vault.getString("a"));
            assertFalse(vault.has("a"));
        }
    }

    @Test
    public void dropsValuesOfALostKeyAndWorksOnTheNewOne() throws Exception {
        vault.putString("a", "text");
        keys.lose();
        assertNull(vault.getString("a"));
        assertFalse(vault.has("a"));
        vault.putString("a", "again");
        assertEquals("again", vault.getString("a"));
    }

    @Test
    public void keepsValuesWhileTheKeyStoreIsDown() throws Exception {
        vault.putString("a", "text");
        keys.unavailable = true;
        try {
            vault.getString("a");
            fail("Read without a key");
        } catch (VaultException expected) {
        }
        try {
            vault.putString("a", "other");
            fail("Wrote without a key");
        } catch (VaultException expected) {
        }
        try {
            vault.putString("b", "new");
            fail("Wrote without a key");
        } catch (VaultException expected) {
        }
        // Nothing was lost or half-written, and nothing landed in clear.
        assertTrue(vault.has("a"));
        assertFalse(vault.has("b"));
        keys.unavailable = false;
        assertEquals("text", vault.getString("a"));
    }

    @Test
    public void replacesAKeyThatIsDeadForGood() throws Exception {
        vault.putString("a", "text");
        keys.invalidate();
        // Writing goes through on the replacement key.
        vault.putString("b", "new");
        assertEquals(1, keys.refusals);
        assertEquals("new", vault.getString("b"));
        // What the dead key sealed is gone, and is reported as absent, not as an error.
        assertNull(vault.getString("a"));

        vault.putString("c", "text");
        keys.invalidate();
        assertNull(vault.getString("c"));
        assertEquals(2, keys.refusals);
        assertFalse(vault.has("c"));
    }

    @Test
    public void keepsValuesWhenTheKeyKeepsBeingRefused() throws Exception {
        vault.putString("a", "text");
        keys.stuck = true;
        keys.invalidate();
        try {
            vault.getString("a");
            fail("Read with a refused key");
        } catch (VaultException expected) {
        }
        try {
            vault.putString("b", "new");
            fail("Wrote with a refused key");
        } catch (VaultException expected) {
        }
        // Two tries each, and nothing was dropped on the strength of a refusal alone.
        assertEquals(4, keys.refusals);
        assertTrue(vault.has("a"));
        assertFalse(vault.has("b"));
    }

    @Test
    public void errorMessagesCarryNoValue() throws Exception {
        keys.unavailable = true;
        try {
            vault.putString("a", "s3cr3t-value");
            fail();
        } catch (VaultException e) {
            assertFalse(e.getMessage().contains("s3cr3t"));
        }
    }
}
