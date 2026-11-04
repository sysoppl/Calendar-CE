package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Telling a dialog the person answered from an answer the system gave without one. */
public class PermissionAnswerTest {
    @Test
    public void anAnswerWithinAFewFramesCameWithoutADialog() {
        assertFalse(PermissionAnswer.wasShown(10_000, 10_000));
        assertFalse(PermissionAnswer.wasShown(10_000, 10_000 + PermissionAnswer.SHOWN_AFTER_MS - 1));
    }

    @Test
    public void aLaterAnswerCameFromThePerson() {
        assertTrue(PermissionAnswer.wasShown(10_000, 10_000 + PermissionAnswer.SHOWN_AFTER_MS));
        assertTrue(PermissionAnswer.wasShown(10_000, 25_000));
    }

    @Test
    public void noRequestMeansNoDialog() {
        assertFalse(PermissionAnswer.wasShown(0, 25_000));
    }
}
