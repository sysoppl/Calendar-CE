package pl.patrykpro.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.junit.Test;

import java.lang.reflect.Method;
import java.util.Set;
import java.util.TreeSet;

/** The stand-in for Capacitor's "WebView" plugin. */
public class WebViewGuardPluginTest {
    private static Set<String> methods(Class<?> plugin) {
        Set<String> names = new TreeSet<>();
        for (Method method : plugin.getDeclaredMethods()) {
            if (method.isAnnotationPresent(PluginMethod.class)) names.add(method.getName());
        }
        return names;
    }

    @Test
    public void takesThePlaceOfCapacitorsOwnWithEveryMethod() {
        // The same name, so the bridge keeps this one; every method Capacitor's has, so none is left over.
        assertEquals("WebView", WebViewGuardPlugin.class.getAnnotation(CapacitorPlugin.class).name());
        assertEquals(methods(com.getcapacitor.plugin.WebView.class), methods(WebViewGuardPlugin.class));
        assertFalse(methods(WebViewGuardPlugin.class).isEmpty());
    }

    @Test
    public void forgetsTheSameEntryCapacitorReads() {
        assertEquals(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, WebViewGuardPlugin.PREFS);
        assertEquals(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, WebViewGuardPlugin.SERVER_PATH);
    }
}
