package pl.patrykpro.calendar;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Takes the place of Capacitor's own "WebView" plugin (registered after it,
 * under the same name, so the bridge keeps this one). Capacitor's lets page
 * script point the app at another folder of files ({@code setServerBasePath})
 * and keep it for every later start ({@code persistServerBasePath}). The app
 * has no live updates, so nothing needs them, and a script that ran once in
 * the page would otherwise make itself permanent, or leave the app blank,
 * until the next update. Every method refuses, and a path kept by an earlier
 * run is forgotten in {@link #load}, which the bridge calls before it loads
 * the page (and before it reads that path).
 */
@CapacitorPlugin(name = "WebView")
public class WebViewGuardPlugin extends Plugin {
    /** Capacitor's names: com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME and CAP_SERVER_PATH. */
    static final String PREFS = "CapWebViewSettings";
    static final String SERVER_PATH = "serverBasePath";

    @Override
    public void load() {
        forgetServerPath(getContext());
    }

    /** Removes a kept server path; the version entries Capacitor keeps next to it stay. */
    static void forgetServerPath(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(SERVER_PATH).apply();
    }

    private static void refuse(PluginCall call) {
        call.unavailable("Not available in this app");
    }

    @PluginMethod
    public void setServerAssetPath(PluginCall call) {
        refuse(call);
    }

    @PluginMethod
    public void setServerBasePath(PluginCall call) {
        refuse(call);
    }

    @PluginMethod
    public void getServerBasePath(PluginCall call) {
        refuse(call);
    }

    @PluginMethod
    public void persistServerBasePath(PluginCall call) {
        refuse(call);
    }
}
