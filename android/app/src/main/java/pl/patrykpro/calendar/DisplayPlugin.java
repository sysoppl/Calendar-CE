package pl.patrykpro.calendar;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the system says about its display and input, for the web app
 * (src/lib/display.ts):
 * - the font size chosen in the system's settings. The WebView's own text
 *   zoom is held at 100% (MainActivity), and the app scales its text by this
 *   factor itself, within bounds its layout takes;
 * - whether a hardware keyboard is attached, which is when the app shows
 *   keyboard shortcuts and their hints.
 * And the other way: the page tells when its first screen is drawn, which
 * ends the splash (`firstScreen`), and the colour of its background, which
 * the window and the WebView take (`setBackground`), and which the next start
 * paints before the page is there (`load`).
 *
 * A change of the font scale recreates the activity, and with it the page,
 * which asks again. The page asks about the keyboard again whenever the app
 * comes back to the front.
 */
@CapacitorPlugin(name = "Display")
public class DisplayPlugin extends Plugin {

    /** Where the colour behind the page is kept for the next start: a colour, nothing private. */
    static final String PREFS = "display";
    static final String KEY_BACKGROUND = "background";

    /** The colour the page last asked for behind it; main thread only. */
    private Integer background;

    /**
     * A colour written {@code #rrggbb} (either case) as an opaque ARGB int, null for anything
     * else: the page sends its frame colour (src/lib/display.ts), never one that lets anything show
     * through.
     */
    static Integer opaqueColor(String hex) {
        if (hex == null || hex.length() != 7 || hex.charAt(0) != '#') return null;
        int rgb = 0;
        for (int i = 1; i < 7; i++) {
            int digit = hexDigit(hex.charAt(i));
            if (digit < 0) return null;
            rgb = rgb << 4 | digit;
        }
        return 0xFF000000 | rgb;
    }

    /** 0 to 15 for an ASCII hex digit, -1 otherwise (Character.digit would take other scripts' digits too). */
    private static int hexDigit(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    /**
     * The system's font scale, 1 when the configuration has none. Rounded to
     * thousandths: the float 1.3f is 1.2999999523 as a double, which the page
     * would otherwise carry into its styles.
     */
    static double fontScale(float configured) {
        // NaN is not above 0 either.
        return configured > 0 && !Float.isInfinite(configured) ? Math.round(configured * 1000.0) / 1000.0 : 1.0;
    }

    /** Whether a keyboard with keys for typing text is attached and not hidden (a laptop lid folded back). */
    static boolean hardwareKeyboard(int keyboard, int hardKeyboardHidden) {
        return keyboard == Configuration.KEYBOARD_QWERTY && hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO;
    }

    /**
     * At start, as the bridge is made and before the page is there: the colour the page gave last
     * time, so that a dark theme starts dark around the page, not in the window's light colour.
     * Nothing before the page first gave one: a new install starts in light Daylight. Posted, as
     * SystemBars (loaded before the app's plugins) posts its own repaint of the window.
     */
    @Override
    public void load() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.contains(KEY_BACKGROUND)) return;
        int color = 0xFF000000 | prefs.getInt(KEY_BACKGROUND, 0);
        background = color;
        getBridge().executeOnMainThread(() -> paint(getActivity(), getBridge().getWebView(), color));
    }

    private Configuration configuration() {
        return getContext().getResources().getConfiguration();
    }

    @PluginMethod
    public void getFontScale(PluginCall call) {
        JSObject res = new JSObject();
        res.put("fontScale", fontScale(configuration().fontScale));
        call.resolve(res);
    }

    @PluginMethod
    public void getKeyboard(PluginCall call) {
        Configuration config = configuration();
        JSObject res = new JSObject();
        res.put("hardware", hardwareKeyboard(config.keyboard, config.hardKeyboardHidden));
        call.resolve(res);
    }

    /**
     * The page's background colour, painted behind it: on the window, and so on the decor view,
     * whose bottom padding Capacitor's SystemBars sets to the keyboard's height while it is shown,
     * and on the WebView, which shows its own background while it is resized. Without it the
     * window's light colour from the theme (@color/surface) flashes below the page as the keyboard
     * slides in, whatever the app's own theme. Kept for the next start (`load`).
     */
    @PluginMethod
    public void setBackground(PluginCall call) {
        Integer color = opaqueColor(call.getString("color"));
        if (color == null) {
            call.reject("A colour written #rrggbb");
            return;
        }
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            background = color;
            paint(activity, getBridge().getWebView(), color);
            SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.contains(KEY_BACKGROUND) || prefs.getInt(KEY_BACKGROUND, 0) != color) {
                prefs.edit().putInt(KEY_BACKGROUND, color).apply();
            }
            call.resolve();
        });
    }

    /**
     * Capacitor's SystemBars sets the decor view back to the theme's window colour on every
     * configuration change (night mode, rotation, a keyboard attached). Painted again once every
     * plugin has had the change: posted, so it runs after SystemBars' own handler.
     */
    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        Integer color = background;
        if (color != null) getBridge().executeOnMainThread(() -> paint(getActivity(), getBridge().getWebView(), color));
    }

    /** Main thread only. */
    private static void paint(Activity activity, WebView webView, int color) {
        Window window = activity.getWindow();
        // The window's background is the decor view's. A new drawable, since SystemBars recolours the one it finds.
        window.setBackgroundDrawable(new ColorDrawable(color));
        if (webView != null) webView.setBackgroundColor(color);
    }

    /** The web app drew its first screen: the splash, held until now (MainActivity), may go. */
    @PluginMethod
    public void firstScreen(PluginCall call) {
        MainActivity.webReady = true;
        call.resolve();
    }
}
