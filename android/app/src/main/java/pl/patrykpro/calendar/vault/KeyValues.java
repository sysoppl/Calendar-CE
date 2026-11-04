package pl.patrykpro.calendar.vault;

/**
 * The few SharedPreferences operations native storage needs. Going through
 * this interface lets the stores run in plain JVM unit tests, where
 * SharedPreferences does not exist.
 */
public interface KeyValues {
    /** The stored text, or null when there is none. */
    String getString(String key);

    void putString(String key, String value);

    long getLong(String key, long fallback);

    void putLong(String key, long value);

    boolean getBoolean(String key, boolean fallback);

    void putBoolean(String key, boolean value);

    void remove(String key);
}
