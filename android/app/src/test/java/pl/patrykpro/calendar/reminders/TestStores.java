package pl.patrykpro.calendar.reminders;

import pl.patrykpro.calendar.vault.KeyValues;
import pl.patrykpro.calendar.vault.SecretVault;

/** Lets tests in other packages build a {@link ReminderStore} on storage of their own. */
public final class TestStores {
    private TestStores() {}

    public static ReminderStore store(KeyValues prefs, SecretVault vault) {
        return new ReminderStore(prefs, vault);
    }
}
