package pl.patrykpro.calendar;

import java.io.EOFException;
import java.io.IOException;
import java.net.SocketException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import pl.patrykpro.calendar.util.CertificateBlocklist;
import pl.patrykpro.calendar.util.CleartextPassword;

/**
 * The HTTP side of the DavHttp plugin, apart from the bridge so that it can
 * be tested on its own. The clients are shared by every bridge the activity
 * creates, and so is their connection pool.
 */
final class DavHttpClient {
    private DavHttpClient() {}

    /** For requests that only read. A password goes over plain http only to the private network (CleartextPassword). */
    static final OkHttpClient READS = CleartextPassword.guard(CertificateBlocklist.guard(new OkHttpClient.Builder()))
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        // Bounds the whole exchange, so a server that answers a byte now and then cannot
        // hold one of the plugin's few threads, and the sync waiting on it, for good.
        // Whole calendars arrive well within this.
        .callTimeout(5, TimeUnit.MINUTES)
        .build();

    /**
     * For requests that change something. OkHttp on its own sends a request
     * again on a fresh connection when a pooled one turns out to be broken;
     * for a write that may already have been carried out, that is not safe.
     */
    static final OkHttpClient WRITES = READS.newBuilder().retryOnConnectionFailure(false).build();

    /** Methods that only read, so sending them twice changes nothing on the server. */
    static final Set<String> SAFE = new HashSet<>(Arrays.asList("GET", "HEAD", "OPTIONS", "PROPFIND", "REPORT"));

    /**
     * Simple servers (e.g. Radicale's built-in one) close idle keep-alive
     * connections without notice. OkHttp may then pick a dead pooled
     * connection and fail with "unexpected end of stream"; retry once on a
     * fresh connection in that case.
     *
     * Only for requests that read. When the connection breaks after a PUT or
     * a DELETE was sent, the server may well have carried it out; sending it
     * again would then fail its precondition and look like a conflict, or
     * create a second copy.
     */
    static Response execute(Request request) throws IOException {
        boolean safe = SAFE.contains(request.method());
        OkHttpClient client = safe ? READS : WRITES;
        try {
            return client.newCall(request).execute();
        } catch (IOException e) {
            String message = e.getMessage() != null ? e.getMessage() : "";
            boolean brokenConnection = message.contains("unexpected end of stream") || e instanceof EOFException || e instanceof SocketException;
            if (brokenConnection && safe) {
                client.connectionPool().evictAll();
                return client.newCall(request).execute();
            }
            throw e;
        }
    }
}
