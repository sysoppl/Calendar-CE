package pl.patrykpro.calendar.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.util.Collections;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class CleartextPasswordTest {
    private static boolean may(String url, String connected) throws Exception {
        return CleartextPassword.mayCarryPassword(HttpUrl.parse(url), connected == null ? null : InetAddress.getByName(connected));
    }

    @Test
    public void aPasswordGoesOverHttpOnlyToThePrivateNetwork() throws Exception {
        // Addresses: private, loopback, link-local, shared (CGNAT) and IPv6 ULA ones only.
        assertTrue(may("http://192.168.1.5:5232/anna/", null));
        assertTrue(may("http://10.0.0.13/dav/", null));
        assertTrue(may("http://172.16.4.2/dav/", null));
        assertTrue(may("http://127.0.0.1:5232/", null));
        assertTrue(may("http://100.64.1.2/", null));
        assertTrue(may("http://169.254.10.1/", null));
        assertTrue(may("http://[::1]:5232/", null));
        assertTrue(may("http://[fd12:3456::1]/", null));
        assertTrue(may("http://[fe80::1]/", null));
        assertFalse(may("http://93.184.215.14/dav/", null));
        assertFalse(may("http://172.32.0.1/dav/", null));
        assertFalse(may("http://[2001:4860::8888]/", null));
        assertFalse(may("http://[::ffff:8.8.8.8]/", null));
        // An address given as an address counts whatever it was connected through.
        assertFalse(may("http://93.184.215.14/dav/", "192.168.1.1"));

        // Local names.
        assertTrue(may("http://nas/dav/", null));
        assertTrue(may("http://nas.local/dav/", null));
        assertTrue(may("http://radicale.lan:5232/", null));
        assertTrue(may("http://dav.home.arpa/", null));
        assertTrue(may("http://NAS.LOCAL./", null));
        assertFalse(may("http://local.example.com/", null));
        assertFalse(may("http://lan.example.org/", null));

        // Any other name: by the address the connection was made to.
        assertTrue(may("http://nas.example.org/", "192.168.1.20"));
        assertFalse(may("http://dav.example.org/", "93.184.215.14"));
        assertFalse(may("http://dav.example.org/", null));

        // Over https, anywhere.
        assertTrue(may("https://dav.example.org/", null));
        assertTrue(may("https://93.184.215.14/", null));
    }

    @Test
    public void readsAddressesWithoutLookingThemUp() {
        assertNull(CleartextPassword.literal("dav.example.org"));
        assertNull(CleartextPassword.literal("999.1.1.1"));
        assertEquals("192.168.1.5", CleartextPassword.literal("192.168.1.5").getHostAddress());
    }

    private static OkHttpClient guarded() {
        return CleartextPassword.guard(new OkHttpClient.Builder()).build();
    }

    @Test(timeout = 10000)
    public void aPublicAddressIsRefusedBeforeConnecting() {
        Request request = new Request.Builder().url("http://93.184.215.14:9/dav/").header("Authorization", "Basic YW5uYTpzZWNyZXQ=").build();
        try (Response res = guarded().newCall(request).execute()) {
            fail("Sent with the password: " + res.code());
        } catch (IOException expected) {
            assertEquals(CleartextPassword.REFUSED, expected.getMessage());
        }
    }

    @Test(timeout = 10000)
    public void aNameOnThePrivateNetworkGetsThePassword() throws Exception {
        try (RawServer server = new RawServer(c -> {
            c.readRequest();
            c.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        })) {
            int port = HttpUrl.parse(server.url("/")).port();
            // The name is resolved to the loopback address the server listens on.
            OkHttpClient client = CleartextPassword.guard(new OkHttpClient.Builder())
                .dns(host -> Collections.singletonList(InetAddress.getLoopbackAddress()))
                .build();
            Request request = new Request.Builder().url("http://dav.example.org:" + port + "/cal/").header("Authorization", "Basic YW5uYTpzZWNyZXQ=").build();
            try (Response res = client.newCall(request).execute()) {
                assertEquals("ok", res.body().string());
            }
        }
    }

    @Test(timeout = 10000)
    public void aNameReachedThroughAProxyIsRefusedWithoutSendingAnything() throws Exception {
        // The refused request may leave its connection open or closed; either way the next one is answered.
        RawServer.Script answer = c -> {
            c.readRequest();
            c.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        };
        try (RawServer server = new RawServer(answer, answer)) {
            HttpUrl local = HttpUrl.parse(server.url("/"));
            // The proxy may take the request anywhere, on the internet included.
            OkHttpClient client = CleartextPassword.guard(new OkHttpClient.Builder())
                .proxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress(local.host(), local.port())))
                .build();
            Request request = new Request.Builder().url("http://dav.example.org/cal/").header("Authorization", "Basic YW5uYTpzZWNyZXQ=").build();
            try (Response res = client.newCall(request).execute()) {
                fail("Sent with the password: " + res.code());
            } catch (IOException expected) {
                assertEquals(CleartextPassword.REFUSED, expected.getMessage());
            }
            assertTrue(server.requests.isEmpty());

            // Without a password (a public feed) the request goes as before.
            try (Response res = client.newCall(new Request.Builder().url("http://dav.example.org/feed.ics").build()).execute()) {
                assertEquals("ok", res.body().string());
            }
        }
    }
}
