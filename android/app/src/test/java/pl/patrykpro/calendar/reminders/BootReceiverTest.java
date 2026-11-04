package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Intent;

import org.junit.Test;

public class BootReceiverTest {
    private static final String EXACT_ALARMS = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";

    @Test
    public void acceptsOnlyBroadcastsThatTheSystemAloneMaySend() {
        for (int sdk : new int[] {24, 30, 31, 36}) {
            assertTrue(BootReceiver.accepts(Intent.ACTION_BOOT_COMPLETED, sdk));
            assertTrue(BootReceiver.accepts(Intent.ACTION_MY_PACKAGE_REPLACED, sdk));
            assertTrue(BootReceiver.accepts(Intent.ACTION_TIME_CHANGED, sdk));
            assertTrue(BootReceiver.accepts(Intent.ACTION_TIMEZONE_CHANGED, sdk));
            assertFalse(BootReceiver.accepts("android.intent.action.QUICKBOOT_POWERON", sdk));
            assertFalse(BootReceiver.accepts("pl.patrykpro.calendar.REFRESH", sdk));
            assertFalse(BootReceiver.accepts(null, sdk));
        }
        // Before Android 12 the system does not know this action, so any app could send it
        // and start a full refresh as often as it likes.
        assertFalse(BootReceiver.accepts(EXACT_ALARMS, 24));
        assertFalse(BootReceiver.accepts(EXACT_ALARMS, 30));
        assertTrue(BootReceiver.accepts(EXACT_ALARMS, 31));
    }
}
