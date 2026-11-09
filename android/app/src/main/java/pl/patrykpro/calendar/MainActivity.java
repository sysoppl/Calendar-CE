package pl.patrykpro.calendar;

import android.os.Bundle;
import android.os.SystemClock;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

import pl.patrykpro.calendar.reminders.RemindersPlugin;

public class MainActivity extends BridgeActivity {
    /**
     * The splash stays until the web app drew its first screen, at most this long: without it
     * the empty page shows between the splash and the app while the WebView starts and the
     * scripts load, which looks like a hang.
     */
    static final long SPLASH_MAX_MS = 4000;

    /** Set by the web app through `DisplayPlugin.firstScreen` once its first screen is drawn. */
    static volatile boolean webReady;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The light splash (styles.xml, AppTheme.NoActionBarLaunch) on every Android version; before super.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        // A new activity loads the page again, which tells its first screen again.
        webReady = false;
        long until = SystemClock.uptimeMillis() + SPLASH_MAX_MS;
        splash.setKeepOnScreenCondition(() -> !webReady && SystemClock.uptimeMillis() < until);
        // Local plugins must be registered before the bridge starts.
        registerPlugin(DavHttpPlugin.class);
        registerPlugin(RemindersPlugin.class);
        registerPlugin(DisplayPlugin.class);
        // Saving files the page made (a backup, an .ics export): the WebView has no downloads.
        registerPlugin(FilesPlugin.class);
        // In place of Capacitor's own "WebView" plugin, which would let the page change where the app is served from.
        registerPlugin(WebViewGuardPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor's file and content routes are refused (GuardedWebViewClient).
        if (getBridge() != null) getBridge().setWebViewClient(new GuardedWebViewClient(getBridge()));
        // Text size is the app's own setting (Appearance › Text size), which follows the
        // system's font size itself, within bounds the layout takes (src/lib/display.ts).
        // The WebView would otherwise scale every text by the system's factor on top of that.
        // A change of the system's font size recreates the activity, so this runs again.
        if (getBridge() != null) getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
