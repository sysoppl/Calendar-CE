package pl.patrykpro.calendar;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Assume;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class TextFileTest {
    /** Shaped like an .ics export: CRLF lines, letters outside ASCII. */
    private static final String ICS = String.join("\r\n",
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "SUMMARY:Spotkanie – zażółć gęślą jaźń 📅",
        "END:VEVENT",
        "END:VCALENDAR",
        "");

    /** A document in memory that remembers what was done to it. */
    private static class Doc implements TextFile.Target {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean opened;
        boolean closed;
        boolean discarded;
        IOException failOpen;
        RuntimeException failOpenUnchecked;
        boolean failWrite;
        boolean failClose;
        boolean noStream;

        @Override
        public OutputStream open() throws IOException {
            opened = true;
            if (failOpen != null) throw failOpen;
            if (failOpenUnchecked != null) throw failOpenUnchecked;
            if (noStream) return null;
            return new OutputStream() {
                @Override
                public void write(int b) throws IOException {
                    if (failWrite) throw new IOException("disk full");
                    bytes.write(b);
                }

                @Override
                public void write(byte[] b, int off, int len) throws IOException {
                    if (failWrite) {
                        bytes.write(b, off, len / 2);
                        throw new IOException("disk full");
                    }
                    bytes.write(b, off, len);
                }

                @Override
                public void close() throws IOException {
                    closed = true;
                    if (failClose) throw new IOException("upload failed");
                }
            };
        }

        @Override
        public void discard() {
            discarded = true;
        }
    }

    @Test
    public void writesExactlyTheTextAsUtf8WithoutAByteOrderMark() {
        Doc doc = new Doc();
        assertEquals(TextFile.SAVED, TextFile.write(doc, ICS));
        byte[] written = doc.bytes.toByteArray();
        assertArrayEquals(ICS.getBytes(StandardCharsets.UTF_8), written);
        assertEquals('B', written[0]);
        assertTrue(doc.closed);
        assertFalse(doc.discarded);
    }

    @Test
    public void writesMegabytesToAFileOnDisk() throws IOException {
        StringBuilder big = new StringBuilder();
        while (big.length() < 3_000_000) big.append("{\"title\":\"Ćwiczenia\",\"start\":1762700000000},");
        File file = File.createTempFile("backup", ".json");
        try {
            TextFile.Target target = new TextFile.Target() {
                @Override
                public OutputStream open() throws IOException {
                    return new FileOutputStream(file);
                }

                @Override
                public void discard() {
                    throw new AssertionError("nothing to discard");
                }
            };
            assertEquals(TextFile.SAVED, TextFile.write(target, big.toString()));
            assertArrayEquals(big.toString().getBytes(StandardCharsets.UTF_8), Files.readAllBytes(file.toPath()));
        } finally {
            assertTrue(file.delete());
        }
    }

    @Test
    public void anEmptyTextIsAnEmptyFile() {
        Doc doc = new Doc();
        assertEquals(TextFile.SAVED, TextFile.write(doc, ""));
        assertEquals(0, doc.bytes.size());
        Doc none = new Doc();
        assertEquals(TextFile.FAILED, TextFile.write(none, null));
        assertFalse(none.opened);
    }

    @Test
    public void removesTheDocumentWhenTheTextDidNotGetThereWhole() {
        Doc cut = new Doc();
        cut.failWrite = true;
        assertEquals(TextFile.FAILED, TextFile.write(cut, ICS));
        assertTrue(cut.discarded);
        assertTrue("left open", cut.closed);

        Doc unsent = new Doc();
        unsent.failClose = true;
        assertEquals(TextFile.FAILED, TextFile.write(unsent, ICS));
        assertTrue(unsent.discarded);

        Doc unopened = new Doc();
        unopened.failOpen = new IOException("no such document");
        assertEquals(TextFile.FAILED, TextFile.write(unopened, ICS));
        assertTrue(unopened.discarded);

        Doc refused = new Doc();
        refused.failOpenUnchecked = new SecurityException("no permission");
        assertEquals(TextFile.FAILED, TextFile.write(refused, ICS));
        assertTrue(refused.discarded);

        Doc crashed = new Doc();
        crashed.noStream = true;
        assertEquals(TextFile.FAILED, TextFile.write(crashed, ICS));
        assertTrue(crashed.discarded);
    }

    @Test
    public void offersOnlyTheKindsItKnows() {
        assertEquals("application/json", TextFile.mimeType("application/json"));
        assertEquals("text/calendar", TextFile.mimeType("text/calendar"));
        assertEquals("text/plain", TextFile.mimeType("text/plain"));
        for (String other : new String[] {null, "", "text/html", "application/octet-stream", "image/svg+xml", "*/*", "application/vnd.android.package-archive"}) {
            assertEquals(String.valueOf(other), "text/plain", TextFile.mimeType(other));
        }
        assertEquals(".json", TextFile.extension("application/json"));
        assertEquals(".ics", TextFile.extension("text/calendar"));
        assertEquals(".txt", TextFile.extension("text/html"));
        assertEquals("calendar.ics", TextFile.defaultName("text/calendar"));
    }

    @Test
    public void cleansTheNameItOffers() {
        assertEquals("calendar-backup-2026-11-09.json", TextFile.safeName("calendar-backup-2026-11-09.json", "application/json"));
        assertEquals("Kalendarz – kopia.json", TextFile.safeName("Kalendarz – kopia.json", "application/json"));
        assertEquals("Work.ics", TextFile.safeName("Work", "text/calendar"));
        assertEquals("Work.ICS", TextFile.safeName("Work.ICS", "text/calendar"));
        assertEquals("notes.json.txt", TextFile.safeName("notes.json", "text/html"));
        assertEquals("a-b-c-d.json", TextFile.safeName("a/b\\c:d", "application/json"));
        assertEquals("x-y.json", TextFile.safeName("x\ny", "application/json"));
        assertEquals("hidden.json", TextFile.safeName("...hidden", "application/json"));
        assertEquals("trimmed.ics", TextFile.safeName("  trimmed  ", "text/calendar"));
    }

    @Test
    public void offersItsOwnNameForNoName() {
        for (String name : new String[] {null, "", "   ", ".json", "..", "///", "- -"}) {
            assertEquals(String.valueOf(name), "calendar.json", TextFile.safeName(name, "application/json"));
        }
    }

    @Test
    public void keepsLongNamesShortAndTheirExtension() {
        String name = TextFile.safeName("k".repeat(300), "text/calendar");
        assertEquals(TextFile.MAX_NAME, name.length());
        assertTrue(name.endsWith(".ics"));
        // Not between the halves of a character outside the basic plane.
        for (int pad = TextFile.MAX_NAME - 8; pad <= TextFile.MAX_NAME; pad++) {
            String emoji = TextFile.safeName("k".repeat(pad) + "📅📅📅", "text/calendar");
            assertTrue(emoji.length() <= TextFile.MAX_NAME);
            assertTrue(emoji.endsWith(".ics"));
            for (int i = 0; i < emoji.length(); i++) {
                if (Character.isHighSurrogate(emoji.charAt(i))) assertTrue(Character.isLowSurrogate(emoji.charAt(i + 1)));
            }
        }
    }

    @Test
    public void answersInTheWordsTheWebSideKnows() {
        assertEquals("saved", TextFile.SAVED);
        assertEquals("cancelled", TextFile.CANCELLED);
        assertEquals("failed", TextFile.FAILED);
    }

    @Test
    public void neitherTheWriterNorThePluginLogs() throws IOException {
        File dir = new File(System.getProperty("user.dir"), "src/main/java/pl/patrykpro/calendar");
        Assume.assumeTrue("sources are not part of this checkout", dir.isDirectory());
        for (String name : new String[] {"TextFile.java", "FilesPlugin.java"}) {
            String source = new String(Files.readAllBytes(new File(dir, name).toPath()), StandardCharsets.UTF_8);
            for (String logging : new String[] {"Log.", "Logger.", "printStackTrace", "System.out", "System.err"}) {
                assertFalse(name + " uses " + logging, source.contains(logging));
            }
        }
    }

    /** The text can be megabytes: it must not go into the saved state of the activity. */
    @Test
    public void thePluginKeepsTheTextOutOfTheSavedState() throws Exception {
        java.lang.reflect.Method save = FilesPlugin.class.getDeclaredMethod("saveInstanceState");
        save.setAccessible(true);
        assertNull(save.invoke(new FilesPlugin()));
    }
}
