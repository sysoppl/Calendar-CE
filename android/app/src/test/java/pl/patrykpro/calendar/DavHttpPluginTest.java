package pl.patrykpro.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.io.IOException;
import java.net.SocketTimeoutException;

import okhttp3.HttpUrl;

/** What the web layer is told of a failed request (src/lib/nativeHttp.ts shows it). */
public class DavHttpPluginTest {
    @Test
    public void passesTheFailuresOwnMessageOn() {
        assertEquals("timeout", DavHttpPlugin.messageOf(new SocketTimeoutException("timeout")));
    }

    @Test
    public void handsARedirectBackWithoutTheCredentialsAServerPutInIt() {
        HttpUrl base = HttpUrl.parse("https://dav.example.org/cal/");
        assertEquals("https://other.example.org/x/", DavHttpPlugin.locationOf(base, "https://ada:secret@other.example.org/x/"));
        assertEquals("https://dav.example.org/home/", DavHttpPlugin.locationOf(base, "/home/"));
        assertNull(DavHttpPlugin.locationOf(base, null));
        assertNull(DavHttpPlugin.locationOf(base, "mailto:ada@example.org"));
    }

    @Test
    public void saysAFixedTextWhereTheFailureHasNoMessageNeverItsClassName() {
        // R8 renames the app's classes in a release build ("a", "c4.a"): no use to anybody.
        assertEquals(DavHttpPlugin.NO_MESSAGE, DavHttpPlugin.messageOf(new IOException()));
        assertEquals(DavHttpPlugin.NO_MESSAGE, DavHttpPlugin.messageOf(new IllegalStateException("")));
        assertEquals("request failed", DavHttpPlugin.NO_MESSAGE);
    }
}
