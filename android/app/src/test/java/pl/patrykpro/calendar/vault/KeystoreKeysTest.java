package pl.patrykpro.calendar.vault;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The Keystore itself is not there in a JVM test; the rule that keeps a made key from being replaced is. */
public class KeystoreKeysTest {

    @Test
    public void makesAKeyTheFirstTimeAndAfterTheOldOneWasThrownAway() {
        assertTrue(KeystoreKeys.mayGenerate(false, false, 0));
        assertTrue(KeystoreKeys.mayGenerate(false, true, 0));
        assertTrue(KeystoreKeys.mayGenerate(true, true, 0));
    }

    @Test
    public void doesNotReplaceAKeyThatWasMadeWhileTheKeystoreMerelyDoesNotAnswerForIt() {
        // A new key in its place would leave every stored value unreadable, and the vault drops those.
        assertFalse(KeystoreKeys.mayGenerate(true, false, 0));
        assertFalse(KeystoreKeys.mayGenerate(true, false, KeystoreKeys.MISSING_GRACE_MS - 1));
        // A clock set back is no answer either.
        assertFalse(KeystoreKeys.mayGenerate(true, false, -1));
    }

    @Test
    public void takesAKeystoreAtItsWordOnceItHasAnsweredWithNoKeyForTheGracePeriod() {
        // A key gone without the system saying so: the vault would otherwise never work again.
        assertTrue(KeystoreKeys.mayGenerate(true, false, KeystoreKeys.MISSING_GRACE_MS));
        assertEquals(6 * 60 * 60 * 1000L, KeystoreKeys.MISSING_GRACE_MS);
    }
}
