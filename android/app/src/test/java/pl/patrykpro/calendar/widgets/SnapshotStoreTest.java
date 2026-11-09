package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import pl.patrykpro.calendar.vault.MemoryValues;
import pl.patrykpro.calendar.vault.SecretVault;
import pl.patrykpro.calendar.vault.TestKeys;
import pl.patrykpro.calendar.vault.VaultException;

public class SnapshotStoreTest {
    private File dir;

    @Before
    public void folder() throws Exception {
        dir = Files.createTempDirectory("widgets").toFile();
    }

    @After
    public void cleanUp() {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) assertTrue(f.delete());
        assertTrue(dir.delete());
    }

    private static Snap secretSnapshot() {
        return Snap.november()
            .calendar("local|personal", "Therapy calendar", "#d12e2c", true, true, true)
            .timed("local|personal", "k1", "Appointment with Dr Secret", Snap.at(2026, 11, 9, 9, 0), Snap.at(2026, 11, 9, 10, 0));
    }

    @Test
    public void keepsTheSnapshotEncryptedAndReadsItBack() throws Exception {
        MemoryValues values = new MemoryValues();
        TestKeys keys = new TestKeys();
        SnapshotStore store = new SnapshotStore(new SecretVault(values, keys));
        assertNull(store.get());
        Snapshot put = store.put(secretSnapshot().json);
        assertEquals(1, put.events.size());
        assertFalse(values.reveals("Dr Secret"));
        assertFalse(values.reveals("Therapy"));
        assertTrue(values.map.containsKey(SnapshotStore.NAME));
        assertSame(put, store.get());

        // A new process: read from the stored, encrypted form.
        SnapshotStore again = new SnapshotStore(new SecretVault(values, keys));
        Snapshot read = again.get();
        assertNotNull(read);
        assertEquals("Appointment with Dr Secret", read.events.get(0).title);
        assertEquals("Therapy calendar", read.calendar("local|personal").name);
    }

    @Test
    public void refusesWhatIsNoSnapshotAndKeepsTheOneBefore() throws Exception {
        SnapshotStore store = new SnapshotStore(new SecretVault(new MemoryValues(), new TestKeys()));
        store.put(secretSnapshot().json);
        try {
            store.put(Snap.november().put("v", 9).json);
            fail("a snapshot of another version was taken");
        } catch (IllegalArgumentException expected) {
            // The widgets go on with the one they have.
        }
        assertEquals(1, store.get().events.size());
    }

    @Test
    public void forgetsTheSnapshot() throws Exception {
        MemoryValues values = new MemoryValues();
        SnapshotStore store = new SnapshotStore(new SecretVault(values, new TestKeys()));
        store.put(secretSnapshot().json);
        store.clear();
        assertNull(store.get());
        assertTrue(values.map.isEmpty());
    }

    @Test
    public void aSnapshotThatCanNoLongerBeOpenedIsDropped() throws Exception {
        MemoryValues values = new MemoryValues();
        TestKeys keys = new TestKeys();
        new SnapshotStore(new SecretVault(values, keys)).put(secretSnapshot().json);
        keys.lose();
        assertNull(new SnapshotStore(new SecretVault(values, keys)).get());
        assertTrue(values.map.isEmpty());
    }

    @Test
    public void aKeyStoreThatDoesNotAnswerIsTriedAgainLater() throws Exception {
        MemoryValues values = new MemoryValues();
        TestKeys keys = new TestKeys();
        new SnapshotStore(new SecretVault(values, keys)).put(secretSnapshot().json);
        SnapshotStore store = new SnapshotStore(new SecretVault(values, keys));
        keys.unavailable = true;
        try {
            store.get();
            fail("no key, but a snapshot");
        } catch (VaultException expected) {
            // Nothing cached: the next call tries again.
        }
        keys.unavailable = false;
        assertNotNull(store.get());
    }

    @Test
    public void filesKeepTheValuesWholeAndPlain() throws Exception {
        FileValues files = new FileValues(new File(dir, "sub"));
        assertNull(files.getString("snapshot"));
        files.putString("snapshot", "zażółć – " + "x".repeat(200_000));
        assertEquals("zażółć – " + "x".repeat(200_000), files.getString("snapshot"));
        files.putString("snapshot", "second");
        assertEquals("second", files.getString("snapshot"));
        assertFalse(new File(new File(dir, "sub"), "snapshot.new").exists());
        files.putLong("n", 42L);
        assertEquals(42L, files.getLong("n", 0L));
        assertEquals(7L, files.getLong("missing", 7L));
        files.putBoolean("b", true);
        assertTrue(files.getBoolean("b", false));
        files.putString("bad", "not a number");
        assertEquals(3L, files.getLong("bad", 3L));
        files.remove("snapshot");
        assertNull(files.getString("snapshot"));
        files.remove("snapshot");
        for (String name : new String[] {"n", "b", "bad"}) files.remove(name);
        assertTrue(new File(dir, "sub").delete());
    }

    @Test
    public void filesRefuseNamesThatAreNotPlain() {
        FileValues files = new FileValues(dir);
        for (String name : new String[] {"", "../x", "a/b", "a\\b", ".hidden", null}) {
            try {
                files.putString(name, "x");
                fail("took the name " + name);
            } catch (IllegalArgumentException expected) {
                // Nothing written.
            }
        }
        assertEquals(0, dir.listFiles().length);
    }

    @Test
    public void theVaultWorksOnFiles() throws Exception {
        TestKeys keys = new TestKeys();
        SnapshotStore store = new SnapshotStore(new SecretVault(new FileValues(dir), keys));
        store.put(secretSnapshot().json);
        byte[] stored = Files.readAllBytes(new File(dir, SnapshotStore.NAME).toPath());
        assertFalse(new String(stored, StandardCharsets.UTF_8).contains("Secret"));
        assertEquals(1, new SnapshotStore(new SecretVault(new FileValues(dir), keys)).get().events.size());

        // Damaged on disk: dropped, not a crash.
        try (FileOutputStream out = new FileOutputStream(new File(dir, SnapshotStore.NAME))) {
            out.write("AAAA".getBytes(StandardCharsets.UTF_8));
        }
        assertNull(new SnapshotStore(new SecretVault(new FileValues(dir), keys)).get());
        assertFalse(new File(dir, SnapshotStore.NAME).exists());
    }
}
