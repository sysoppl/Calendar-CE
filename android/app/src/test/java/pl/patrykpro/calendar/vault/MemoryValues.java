package pl.patrykpro.calendar.vault;

import java.util.HashMap;
import java.util.Map;

/** {@link KeyValues} in memory, standing in for a preferences file. */
public final class MemoryValues implements KeyValues {
    public final Map<String, Object> map = new HashMap<>();
    /** How many times a text was written; lets a test see that an unchanged value is not written again. */
    public int stringWrites;

    @Override
    public String getString(String key) {
        return (String) map.get(key);
    }

    @Override
    public void putString(String key, String value) {
        stringWrites++;
        map.put(key, value);
    }

    @Override
    public long getLong(String key, long fallback) {
        Object value = map.get(key);
        return value == null ? fallback : (Long) value;
    }

    @Override
    public void putLong(String key, long value) {
        map.put(key, value);
    }

    @Override
    public boolean getBoolean(String key, boolean fallback) {
        Object value = map.get(key);
        return value == null ? fallback : (Boolean) value;
    }

    @Override
    public void putBoolean(String key, boolean value) {
        map.put(key, value);
    }

    @Override
    public void remove(String key) {
        map.remove(key);
    }

    /** True when any stored text contains the given one: what a look at the file would reveal. */
    public boolean reveals(String text) {
        for (Map.Entry<String, Object> e : map.entrySet()) {
            if (e.getKey().contains(text) || String.valueOf(e.getValue()).contains(text)) return true;
        }
        return false;
    }
}
