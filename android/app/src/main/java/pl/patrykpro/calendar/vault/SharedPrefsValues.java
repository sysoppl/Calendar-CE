package pl.patrykpro.calendar.vault;

import android.content.Context;
import android.content.SharedPreferences;

/** {@link KeyValues} on a private SharedPreferences file. */
public final class SharedPrefsValues implements KeyValues {
    private final SharedPreferences prefs;

    public SharedPrefsValues(Context context, String name) {
        this.prefs = context.getApplicationContext().getSharedPreferences(name, Context.MODE_PRIVATE);
    }

    @Override
    public String getString(String key) {
        return prefs.getString(key, null);
    }

    @Override
    public void putString(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    @Override
    public long getLong(String key, long fallback) {
        return prefs.getLong(key, fallback);
    }

    @Override
    public void putLong(String key, long value) {
        prefs.edit().putLong(key, value).apply();
    }

    @Override
    public boolean getBoolean(String key, boolean fallback) {
        return prefs.getBoolean(key, fallback);
    }

    @Override
    public void putBoolean(String key, boolean value) {
        prefs.edit().putBoolean(key, value).apply();
    }

    @Override
    public void remove(String key) {
        prefs.edit().remove(key).apply();
    }
}
