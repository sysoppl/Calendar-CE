package pl.patrykpro.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.res.Configuration;

import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.junit.Test;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Set;
import java.util.TreeSet;

/** What the web app can ask of the {@code Display} plugin (src/lib/display.ts). */
public class DisplayPluginTest {
    @Test
    public void answersExactlyWhatTheWebAppAsks() {
        assertEquals("Display", DisplayPlugin.class.getAnnotation(CapacitorPlugin.class).name());
        Set<String> methods = new TreeSet<>();
        for (Method method : DisplayPlugin.class.getDeclaredMethods()) {
            if (method.isAnnotationPresent(PluginMethod.class)) methods.add(method.getName());
        }
        assertEquals(new TreeSet<>(Arrays.asList("firstScreen", "getFontScale", "getKeyboard", "setBackground")), methods);
    }

    @Test
    public void passesTheSystemFontScaleOnAsItIs() {
        // The bounds are the web app's to apply (0.85 to 1.3): the plugin reports what the system has.
        assertEquals(1.0, DisplayPlugin.fontScale(1.0f), 0);
        assertEquals(2.0, DisplayPlugin.fontScale(2.0f), 0);
        // Exactly the scale the system names, not the float's nearest double (1.2999999523...).
        assertEquals(1.3, DisplayPlugin.fontScale(1.3f), 0);
        assertEquals(0.85, DisplayPlugin.fontScale(0.85f), 0);
        assertEquals(1.15, DisplayPlugin.fontScale(1.15f), 0);
    }

    @Test
    public void reportsOneWhenTheSystemSaysNothingUsable() {
        for (float odd : new float[] {0f, -1f, Float.NaN, Float.POSITIVE_INFINITY}) {
            assertEquals(String.valueOf(odd), 1.0, DisplayPlugin.fontScale(odd), 0);
        }
    }

    @Test
    public void seesAKeyboardOnlyWhenOneForTypingIsAttachedAndOpen() {
        assertTrue(DisplayPlugin.hardwareKeyboard(Configuration.KEYBOARD_QWERTY, Configuration.HARDKEYBOARDHIDDEN_NO));
        // Folded away, as on a convertible in tablet mode.
        assertFalse(DisplayPlugin.hardwareKeyboard(Configuration.KEYBOARD_QWERTY, Configuration.HARDKEYBOARDHIDDEN_YES));
        // A phone: no keys, or only a number pad.
        assertFalse(DisplayPlugin.hardwareKeyboard(Configuration.KEYBOARD_NOKEYS, Configuration.HARDKEYBOARDHIDDEN_YES));
        assertFalse(DisplayPlugin.hardwareKeyboard(Configuration.KEYBOARD_12KEY, Configuration.HARDKEYBOARDHIDDEN_NO));
        assertFalse(DisplayPlugin.hardwareKeyboard(Configuration.KEYBOARD_UNDEFINED, Configuration.HARDKEYBOARDHIDDEN_UNDEFINED));
    }

    @Test
    public void paintsTheFrameColoursOfTheThemesOpaque() {
        // Daylight, Linen, Graphite, Night (src/theme/themes.ts).
        assertEquals(0xFFF5F5F3, (int) DisplayPlugin.opaqueColor("#f5f5f3"));
        assertEquals(0xFFF4F1EC, (int) DisplayPlugin.opaqueColor("#F4F1EC"));
        assertEquals(0xFF121417, (int) DisplayPlugin.opaqueColor("#121417"));
        assertEquals(0xFF000000, (int) DisplayPlugin.opaqueColor("#000000"));
        assertEquals(0xFFFFFFFF, (int) DisplayPlugin.opaqueColor("#ffffff"));
    }

    @Test
    public void paintsNothingButAColourWrittenAsTheWebAppWritesIt() {
        for (String odd : new String[] {null, "", "#", "#fff", "121417", "#1214170", "#12141780", "#12141g", " #121417", "#12 417",
            "black", "rgb(0,0,0)", "#\u0661\u0662\u0661\u0664\u0661\u0667"}) {
            assertNull(String.valueOf(odd), DisplayPlugin.opaqueColor(odd));
        }
    }
}
