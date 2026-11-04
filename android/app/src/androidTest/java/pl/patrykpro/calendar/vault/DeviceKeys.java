package pl.patrykpro.calendar.vault;

import android.content.Context;

/** Gives device tests in other packages the real Keystore key source, with its marks in a file of the tests' own. */
public final class DeviceKeys {
    public static final String MARKS_FILE = "calendar_vault_devicetest_keys";

    private DeviceKeys() {}

    public static SecretVault.KeySource keystore(Context context) {
        return new KeystoreKeys(new SharedPrefsValues(context, MARKS_FILE));
    }
}
