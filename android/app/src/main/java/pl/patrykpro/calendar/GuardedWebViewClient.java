package pl.patrykpro.calendar;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.Locale;

/**
 * Capacitor's WebView client without Capacitor's internal routes.
 *
 * Capacitor answers paths under {@code /_capacitor_file_/} and
 * {@code /_capacitor_content_/} at the app's own origin with any file of the
 * app or any other app's content provider, and keeps a tapped link to
 * {@code https://localhost/...} inside the app. A link in calendar data could
 * so load a page at the app's origin, with its keys and its native plugins.
 * The app uses none of these routes (no convertFileSrc, the HTTP proxy is
 * off), so every request and navigation to one is refused: a navigation
 * stays where it is, a request gets a 404.
 */
public class GuardedWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public GuardedWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /**
     * Whether {@code path} (decoded, as {@link Uri#getPath()} gives it) names one
     * of Capacitor's internal routes: a first segment that starts with
     * {@code _capacitor_}, whatever the case or the number of slashes before it.
     */
    static boolean isInternalRoute(String path) {
        if (path == null) return false;
        int start = 0;
        while (start < path.length() && (path.charAt(start) == '/' || path.charAt(start) == '\\')) start++;
        return path.substring(start).toLowerCase(Locale.ROOT).startsWith("_capacitor_");
    }

    /** Whether {@code url} is one of those routes on the app's own host. */
    boolean isRefused(Uri url) {
        if (url == null || !isInternalRoute(url.getPath())) return false;
        Uri app = Uri.parse(bridge.getAppUrl());
        String host = url.getHost();
        return host != null && host.equalsIgnoreCase(app.getHost());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (isRefused(request.getUrl())) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (isRefused(request.getUrl())) return true;
        return super.shouldOverrideUrlLoading(view, request);
    }
}
