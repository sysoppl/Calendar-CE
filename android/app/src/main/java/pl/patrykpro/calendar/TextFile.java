package pl.patrykpro.calendar;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.SyncFailedException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Writes a text the web app made (a backup, an .ics export) into the file the
 * user picked for it in the system's file picker ({@link FilesPlugin#saveText}):
 * the text exactly as it came, UTF-8 without a byte order mark, and nothing
 * else. A file left half written is removed again, so a cut backup is never
 * taken for a whole one later. Neither the text nor anything about a failure
 * is logged; a failure is only "failed".
 *
 * Only a few kinds of file are offered, each with its extension: JSON (the
 * one-file backup), iCalendar (exports) and plain text. A name the web app
 * offers is cleaned of what file systems do not take, and gets the kind's
 * extension when it has none of it.
 */
final class TextFile {
    static final String JSON = "application/json";
    static final String CALENDAR = "text/calendar";
    static final String PLAIN = "text/plain";

    static final String SAVED = "saved";
    static final String CANCELLED = "cancelled";
    static final String FAILED = "failed";

    /** Longest name offered, extension included. */
    static final int MAX_NAME = 120;

    /** The document the picker made, as far as writing it needs. */
    interface Target {
        /** Opens the document for writing from its start, emptying it first. */
        OutputStream open() throws IOException;

        /** Removes the document again, as far as its provider allows. Never throws. */
        void discard();
    }

    private TextFile() {}

    /** One of the kinds offered; anything else is plain text. */
    static String mimeType(String mimeType) {
        if (JSON.equals(mimeType) || CALENDAR.equals(mimeType)) return mimeType;
        return PLAIN;
    }

    /** The extension of a kind, with its dot. */
    static String extension(String mimeType) {
        switch (mimeType(mimeType)) {
            case JSON:
                return ".json";
            case CALENDAR:
                return ".ics";
            default:
                return ".txt";
        }
    }

    /** The name offered when the web app gives none that is usable. */
    static String defaultName(String mimeType) {
        return "calendar" + extension(mimeType);
    }

    /**
     * The name to offer in the picker: the web app's, with control characters
     * and the characters file systems refuse ({@code / \ : * ? " < > |})
     * turned into "-", without leading dots or spaces, at most
     * {@link #MAX_NAME} characters, and ending in the kind's extension.
     */
    static String safeName(String name, String mimeType) {
        String ext = extension(mimeType);
        if (name == null) return defaultName(mimeType);
        StringBuilder clean = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            clean.append(Character.isISOControl(c) || "/\\:*?\"<>|".indexOf(c) >= 0 ? '-' : c);
        }
        String out = clean.toString().trim();
        // A bare extension (".json") is no name.
        if (out.equalsIgnoreCase(ext)) return defaultName(mimeType);
        while (out.startsWith(".") || out.startsWith(" ")) out = out.substring(1);
        if (!out.toLowerCase(Locale.ROOT).endsWith(ext)) out = out + ext;
        if (out.length() > MAX_NAME) {
            String stem = out.substring(0, out.length() - ext.length());
            int keep = MAX_NAME - ext.length();
            // Not between the halves of a surrogate pair.
            if (Character.isHighSurrogate(stem.charAt(keep - 1))) keep--;
            out = stem.substring(0, keep).trim() + ext;
        }
        // Nothing but the extension: no name of its own.
        if (out.length() <= ext.length() || out.substring(0, out.length() - ext.length()).replace('-', ' ').trim().isEmpty()) return defaultName(mimeType);
        return out;
    }

    /** {@link #SAVED} once every byte is written and the file is closed; {@link #FAILED} otherwise. */
    static String write(Target target, String text) {
        if (text == null) return FAILED;
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        try {
            OutputStream out = target.open();
            if (out == null) throw new IOException();
            try (OutputStream file = out) {
                file.write(bytes);
                file.flush();
                sync(file);
            }
            return SAVED;
        } catch (IOException | RuntimeException e) {
            target.discard();
            return FAILED;
        }
    }

    /**
     * On storage the phone can lose power over, the file is on the disk before
     * the user is told it is saved. A provider that hands over a pipe instead
     * cannot be synced and keeps that promise itself.
     */
    private static void sync(OutputStream out) throws IOException {
        if (!(out instanceof FileOutputStream)) return;
        try {
            ((FileOutputStream) out).getFD().sync();
        } catch (SyncFailedException pipe) {
            // Not a file on a disk.
        }
    }
}
