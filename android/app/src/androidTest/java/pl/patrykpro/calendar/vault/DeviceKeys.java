package pl.patrykpro.calendar.vault;

/** Gives device tests in other packages the real Keystore key source. */
public final class DeviceKeys {
    private DeviceKeys() {}

    public static SecretVault.KeySource keystore() {
        return new KeystoreKeys();
    }
}
