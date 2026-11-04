package pl.patrykpro.calendar.vault;

/**
 * The vault cannot be used right now: the Keystore refused or failed. The
 * stored values are untouched, so the same call may work later. The message
 * never contains a value.
 */
public final class VaultException extends Exception {
    public VaultException(String message, Throwable cause) {
        super(message, cause);
    }
}
