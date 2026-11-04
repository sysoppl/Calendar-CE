package pl.patrykpro.calendar.util;

import okhttp3.HttpUrl;

/**
 * CalDAV addresses without a user name and password in them
 * ({@code https://user:pass@host/}). The password belongs in its own field,
 * which the app keeps encrypted and sends as an Authorization header; OkHttp
 * never sends the userinfo part anyway, so taking it off changes nothing for
 * the server. What it changes: an address resolved from an answer (a
 * redirect's Location, handed back to the web app) and an error message do not
 * carry the password on.
 */
public final class NoCredentials {
    private NoCredentials() {}

    /** {@code url} without user name and password; the same object when it has none. */
    public static HttpUrl strip(HttpUrl url) {
        if (url == null) return null;
        if (url.encodedUsername().isEmpty() && url.encodedPassword().isEmpty()) return url;
        return url.newBuilder().username("").password("").build();
    }

    /** As {@link #strip(HttpUrl)}, for a text; null when it is not an http(s) address. */
    public static HttpUrl parse(String url) {
        return url == null ? null : strip(HttpUrl.parse(url));
    }
}
