package pl.patrykpro.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import pl.patrykpro.calendar.util.CertificateBlocklistTest;
import pl.patrykpro.calendar.util.CleartextPassword;
import pl.patrykpro.calendar.util.RawServer;

public class DavHttpClientTest {
    private static final MediaType XML = MediaType.parse("application/xml; charset=utf-8");

    @Test
    public void bothClientsRefuseTheBlockedCertificates() {
        assertTrue(CertificateBlocklistTest.guarded(DavHttpClient.READS));
        assertTrue(CertificateBlocklistTest.guarded(DavHttpClient.WRITES));
    }

    @Test(timeout = 10000)
    public void bothClientsSendAPasswordOverHttpOnlyToThePrivateNetwork() throws Exception {
        for (String method : new String[] {"PROPFIND", "PUT"}) {
            Request request = new Request.Builder()
                .url("http://93.184.215.14:9/dav/")
                .header("Authorization", "Basic YW5uYTpzZWNyZXQ=")
                .method(method, RequestBody.create(new byte[0], XML))
                .build();
            try (Response res = DavHttpClient.execute(request)) {
                fail("Sent the password: " + res.code());
            } catch (IOException expected) {
                assertEquals(CleartextPassword.REFUSED, expected.getMessage());
            }
        }
        // The loopback address (as a LAN server's) gets it.
        try (RawServer server = new RawServer(c -> {
            c.readRequest();
            c.write("HTTP/1.1 207 Multi-Status\r\nContent-Length: 2\r\n\r\nok");
        })) {
            Request request = new Request.Builder().url(server.url("/dav/")).header("Authorization", "Basic YW5uYTpzZWNyZXQ=").method("PROPFIND", RequestBody.create(new byte[0], XML)).build();
            try (Response res = DavHttpClient.execute(request)) {
                assertEquals(207, res.code());
            }
        }
    }

    /** A first exchange, so that the next request goes out on a pooled keep-alive connection. */
    private static void warm(RawServer server) throws IOException {
        try (Response res = DavHttpClient.execute(new Request.Builder().url(server.url("/warm")).build())) {
            assertEquals("ok", res.body().string());
        }
    }

    /** Answers the first request of a connection, reads the second and then drops the connection without an answer. */
    private static RawServer.Script answerOnceThenDrop() {
        return c -> {
            c.readRequest();
            c.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
            c.readRequest();
        };
    }

    @Test(timeout = 20000)
    public void aWriteIsNotSentAgainWhenTheConnectionBreaksAfterIt() throws Exception {
        // The server may well have stored the event before the connection broke. Sent again,
        // the PUT with If-None-Match: * fails its precondition and looks like a conflict.
        try (RawServer server = new RawServer(answerOnceThenDrop(), c -> {
            c.readRequest();
            c.write("HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\n\r\n");
        })) {
            warm(server);
            Request put = new Request.Builder()
                .url(server.url("/cal/a.ics"))
                .header("If-None-Match", "*")
                .put(RequestBody.create("BEGIN:VCALENDAR".getBytes(StandardCharsets.UTF_8), null))
                .build();
            try (Response res = DavHttpClient.execute(put)) {
                fail("The PUT was sent again and answered " + res.code());
            } catch (IOException expected) {
                // The web layer reports a network error and syncs again later.
            }
            assertEquals(1, server.count("PUT"));
        }
    }

    @Test(timeout = 20000)
    public void otherWritingMethodsAreNotSentAgainEither() throws Exception {
        for (String method : new String[] {"DELETE", "MKCALENDAR", "PROPPATCH"}) {
            try (RawServer server = new RawServer(answerOnceThenDrop(), c -> {
                c.readRequest();
                c.write("HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n");
            })) {
                warm(server);
                Request request = new Request.Builder()
                    .url(server.url("/cal/"))
                    .method(method, RequestBody.create("<x/>".getBytes(StandardCharsets.UTF_8), XML))
                    .build();
                try (Response res = DavHttpClient.execute(request)) {
                    fail(method + " was sent again and answered " + res.code());
                } catch (IOException expected) {
                }
                assertEquals(method, 1, server.count(method));
            }
        }
    }

    @Test(timeout = 20000)
    public void aReadIsTriedAgainOnAFreshConnection() throws Exception {
        try (RawServer server = new RawServer(answerOnceThenDrop(), c -> {
            c.readRequest();
            c.write("HTTP/1.1 207 Multi-Status\r\nContent-Length: 5\r\n\r\n<ok/>");
        })) {
            warm(server);
            Request propfind = new Request.Builder()
                .url(server.url("/cal/"))
                .method("PROPFIND", RequestBody.create("<x/>".getBytes(StandardCharsets.UTF_8), XML))
                .build();
            try (Response res = DavHttpClient.execute(propfind)) {
                assertEquals(207, res.code());
                assertEquals("<ok/>", res.body().string());
            }
            assertEquals(2, server.count("PROPFIND"));
        }
    }
}
