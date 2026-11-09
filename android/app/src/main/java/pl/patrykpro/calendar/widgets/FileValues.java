package pl.patrykpro.calendar.widgets;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import pl.patrykpro.calendar.vault.KeyValues;

/**
 * {@link KeyValues} as one file per name in a private folder, for values too
 * big for a preferences file.
 *
 * The widgets' snapshot is several hundred kilobytes once encrypted. In a
 * preferences file it would be read in whole with the first value of that
 * file and stay in memory for as long as the process lives, and every change
 * would write all of it again. Here it is read when it is needed, and
 * written to a new file first and then put in the place of the old one, so a
 * write cut short (the battery, the process ended) leaves the old value whole.
 *
 * Names are only ever the app's own constants; anything that is not a plain
 * name is refused rather than turned into a path.
 */
final class FileValues implements KeyValues {
    /** A value bigger than this is not read: it was not written by this class. */
    static final int MAX_BYTES = 16 * 1024 * 1024;

    private final File dir;

    FileValues(File dir) {
        this.dir = dir;
    }

    private File file(String key) {
        if (key == null || key.isEmpty() || key.length() > 64) throw new IllegalArgumentException("Bad name");
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            boolean plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || (c == '.' && i > 0);
            if (!plain) throw new IllegalArgumentException("Bad name");
        }
        return new File(dir, key);
    }

    @Override
    public synchronized String getString(String key) {
        File file = file(key);
        if (!file.isFile() || file.length() > MAX_BYTES) return null;
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) file.length());
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                if (out.size() > MAX_BYTES) return null;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * Writes the value through a temporary file. When the disk refuses, the
     * old value stays and the write is dropped: whoever wrote it writes it
     * again with the next change.
     */
    @Override
    public synchronized void putString(String key, String value) {
        File file = file(key);
        if (value == null) {
            remove(key);
            return;
        }
        if (!dir.isDirectory() && !dir.mkdirs()) return;
        File temp = new File(dir, key + ".new");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(value.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        } catch (IOException e) {
            discard(temp);
            return;
        }
        // Some file systems do not replace on rename.
        if (!temp.renameTo(file) && (!file.delete() || !temp.renameTo(file))) discard(temp);
    }

    @Override
    public long getLong(String key, long fallback) {
        String value = getString(key);
        if (value == null) return fallback;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    @Override
    public void putLong(String key, long value) {
        putString(key, Long.toString(value));
    }

    @Override
    public boolean getBoolean(String key, boolean fallback) {
        String value = getString(key);
        if ("true".equals(value)) return true;
        if ("false".equals(value)) return false;
        return fallback;
    }

    @Override
    public void putBoolean(String key, boolean value) {
        putString(key, Boolean.toString(value));
    }

    @Override
    public synchronized void remove(String key) {
        discard(file(key));
    }

    /** Deletes a file if it is there. One that cannot be deleted is left as it is: the folder is the app's own. */
    @SuppressWarnings("ResultOfMethodCallIgnored")
    private static void discard(File file) {
        if (file.exists()) file.delete();
    }
}
