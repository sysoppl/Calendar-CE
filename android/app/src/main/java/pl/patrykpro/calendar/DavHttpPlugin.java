package pl.patrykpro.calendar;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import pl.patrykpro.calendar.util.BoundedBody;
import pl.patrykpro.calendar.util.NoCredentials;

/**
 * Minimal HTTP client for WebDAV/CalDAV.
 *
 * HttpURLConnection (and therefore CapacitorHttp) only accepts the classic
 * HTTP verbs, while CalDAV needs PROPFIND, REPORT, MKCALENDAR and PROPPATCH.
 * OkHttp accepts any method. Redirects are not followed so the web layer can
 * re-issue the request itself without losing the Authorization header.
 * Over plain http an Authorization header goes only to a server on the
 * private network (CleartextPassword, built into DavHttpClient).
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {

    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    /** Methods OkHttp refuses to send without a body. */
    private static final Set<String> REQUIRES_BODY = new HashSet<>(Arrays.asList("POST", "PUT", "PATCH", "PROPPATCH", "REPORT", "QUERY"));

    /**
     * The whole response is handed to the web layer as one string, so a body
     * without an end would exhaust memory. Whole calendars stay far below this.
     */
    private static final long MAX_BODY_BYTES = 32L * 1024 * 1024;

    @Override
    protected void handleOnDestroy() {
        // The bridge is gone with its activity, and a new one brings a new plugin with threads
        // of its own. Requests already running finish; nothing new is taken.
        executor.shutdown();
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        final String url = call.getString("url");
        final JSObject headers = call.getObject("headers", new JSObject());
        final String body = call.getString("body");

        if (url == null) {
            call.reject("Missing url");
            return;
        }
        // A user name and password typed into the address are not sent (OkHttp never does), nor
        // handed back in a redirect's address; the Authorization header carries them.
        final HttpUrl target = NoCredentials.parse(url);
        if (target == null) {
            call.reject("Invalid url");
            return;
        }

        executor.execute(() -> {
            try {
                Request.Builder builder = new Request.Builder().url(target);
                String contentType = null;
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String name = keys.next();
                    String value = headers.getString(name);
                    if (value == null) continue;
                    if (name.equalsIgnoreCase("content-type")) contentType = value;
                    builder.header(name, value);
                }

                RequestBody requestBody = null;
                boolean allowsBody = !method.equals("GET") && !method.equals("HEAD");
                if (allowsBody && body != null) {
                    MediaType type = contentType != null ? MediaType.parse(contentType) : null;
                    requestBody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), type);
                } else if (REQUIRES_BODY.contains(method)) {
                    requestBody = RequestBody.create(new byte[0], null);
                }
                builder.method(method, requestBody);

                try (Response response = DavHttpClient.execute(builder.build())) {
                    JSObject result = new JSObject();
                    result.put("status", response.code());

                    JSObject outHeaders = new JSObject();
                    for (String name : response.headers().names()) {
                        // A header may come several times (DAV, WWW-Authenticate); joined the way fetch() does it.
                        outHeaders.put(name.toLowerCase(Locale.ROOT), String.join(", ", response.headers(name)));
                    }
                    result.put("headers", outHeaders);

                    String location = locationOf(response.request().url(), response.header("Location"));
                    if (location != null) result.put("location", location);

                    result.put("body", BoundedBody.read(response.body(), MAX_BODY_BYTES));
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(messageOf(e), e);
            }
        });
    }

    /** A redirect's target, resolved against the request's address, without a user name and password in it; null when there is none. */
    static String locationOf(HttpUrl base, String location) {
        HttpUrl resolved = location == null ? null : NoCredentials.strip(base.resolve(location));
        return resolved == null ? null : resolved.toString();
    }

    /** What the web layer shows of a failure without a message of its own. Never a class name: R8 renames those in release builds. */
    static final String NO_MESSAGE = "request failed";

    /** The failure's own message, or {@link #NO_MESSAGE}. */
    static String messageOf(Exception e) {
        String message = e.getMessage();
        return message != null && !message.isEmpty() ? message : NO_MESSAGE;
    }
}
