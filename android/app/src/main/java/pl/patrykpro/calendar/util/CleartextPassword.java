package pl.patrykpro.calendar.util;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.regex.Pattern;

import okhttp3.Connection;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Route;

/**
 * Keeps a password off the internet in clear: a request over plain http that
 * carries an Authorization header goes only to a server on the private
 * network. As the web app's proxy decides it (server/davProxy.mjs): an IP
 * address must be a private or loopback one, a name a local one (a single
 * label, {@code .local}, {@code .lan}, {@code .home.arpa} and the like), and
 * any other name counts by the address the connection was made to. A request
 * without a password (a public feed) gives nothing away that the address does
 * not, and goes anywhere; so does every https one.
 *
 * The Network Security Config still allows plain http for every CalDAV
 * server, for those feeds and for servers on the LAN; the account form warns
 * about http. Both CalDAV clients (DavHttp and the background refresh, which
 * would otherwise send the password again every hour) are built through
 * {@link #guard}.
 */
public final class CleartextPassword {
    private CleartextPassword() {}

    /** The refusal's message. It is shown to the user and names no server. */
    public static final String REFUSED = "The password is sent to this server only over HTTPS. Change the server address to https://.";

    /** Suffixes that never resolve on the public internet (RFC 6761, 6762, 8375; ICANN's .internal; the common .lan). */
    private static final String[] LOCAL_SUFFIXES = {".localhost", ".local", ".lan", ".internal", ".home.arpa"};

    private static final Pattern IPV4 = Pattern.compile("\\d{1,3}(\\.\\d{1,3}){3}");

    /** {@code builder} with the check added, before the connection is made and once it is. */
    public static OkHttpClient.Builder guard(OkHttpClient.Builder builder) {
        return builder.addInterceptor(CleartextPassword::beforeConnecting).addNetworkInterceptor(CleartextPassword::onTheConnection);
    }

    private static boolean carriesPassword(Request request) {
        return !request.isHttps() && request.header("Authorization") != null;
    }

    /** An IP address that is not private is refused without connecting to it. */
    private static okhttp3.Response beforeConnecting(Interceptor.Chain chain) throws IOException {
        Request request = chain.request();
        if (carriesPassword(request)) {
            InetAddress literal = literal(request.url().host());
            if (literal != null && !isPrivate(literal)) throw new IOException(REFUSED);
        }
        return chain.proceed(request);
    }

    /** A name counts by the address it was connected to, before anything is written. */
    private static okhttp3.Response onTheConnection(Interceptor.Chain chain) throws IOException {
        Request request = chain.request();
        if (carriesPassword(request)) {
            Connection connection = chain.connection();
            Route route = connection == null ? null : connection.route();
            boolean direct = route != null && route.proxy().type() == Proxy.Type.DIRECT;
            InetSocketAddress socket = route == null ? null : route.socketAddress();
            if (!mayCarryPassword(request.url(), direct && socket != null ? socket.getAddress() : null)) throw new IOException(REFUSED);
        }
        return chain.proceed(request);
    }

    /**
     * Whether a plain-http request to {@code url} may carry a password, sent
     * over a direct connection to {@code connected} (null when it is not known,
     * or the request goes through a proxy, which may take it anywhere).
     */
    public static boolean mayCarryPassword(HttpUrl url, InetAddress connected) {
        if (url.isHttps()) return true;
        String host = url.host().toLowerCase(Locale.ROOT);
        InetAddress literal = literal(host);
        if (literal != null) return isPrivate(literal);
        if (isLocalName(host)) return true;
        return connected != null && isPrivate(connected);
    }

    /** A name that does not resolve on the public internet: a single label or one under a local-only suffix. */
    static boolean isLocalName(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty()) return false;
        if (!h.contains(".")) return true;
        for (String suffix : LOCAL_SUFFIXES) {
            if (h.endsWith(suffix)) return true;
        }
        return false;
    }

    /** The address an IP literal stands for, read without a lookup; null for a name. */
    static InetAddress literal(String host) {
        try {
            if (IPV4.matcher(host).matches()) {
                String[] parts = host.split("\\.");
                byte[] b = new byte[4];
                for (int i = 0; i < 4; i++) {
                    int n = Integer.parseInt(parts[i]);
                    if (n > 255) return null;
                    b[i] = (byte) n;
                }
                return InetAddress.getByAddress(b);
            }
            // Only an IPv6 literal has a colon; one is parsed, never looked up.
            return host.contains(":") ? InetAddress.getByName(host) : null;
        } catch (UnknownHostException e) {
            return null;
        }
    }

    /** Loopback, private (RFC 1918, IPv6 ULA), link-local and shared (CGNAT, 100.64.0.0/10) addresses. */
    static boolean isPrivate(InetAddress address) {
        if (address.isLoopbackAddress() || address.isAnyLocalAddress() || address.isSiteLocalAddress() || address.isLinkLocalAddress()) return true;
        byte[] b = address.getAddress();
        if (address instanceof Inet4Address) return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64;
        if (address instanceof Inet6Address) return (b[0] & 0xfe) == 0xfc;
        return false;
    }
}
