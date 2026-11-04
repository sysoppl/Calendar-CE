package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import pl.patrykpro.calendar.util.BoundedBody;
import pl.patrykpro.calendar.util.CertificateBlocklistTest;
import pl.patrykpro.calendar.util.CleartextPassword;
import pl.patrykpro.calendar.util.RawServer;

public class CalDavFetcherTest {

    @Test
    public void theClientRefusesTheBlockedCertificates() {
        assertTrue(CertificateBlocklistTest.guarded(CalDavFetcher.CLIENT));
    }

    @Test(timeout = 5000)
    public void anAnswerWithADoctypeIsRefusedBeforeItIsParsed() {
        StringBuilder laughs = new StringBuilder("<?xml version=\"1.0\"?>\n<!DOCTYPE lolz [\n <!ENTITY lol \"lol\">\n");
        laughs.append(" <!ENTITY lol1 \"&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;\">\n");
        for (int i = 2; i <= 9; i++) {
            laughs.append(" <!ENTITY lol").append(i).append(" \"");
            for (int j = 0; j < 10; j++) laughs.append("&lol").append(i - 1).append(';');
            laughs.append("\">\n");
        }
        laughs.append("]>\n<d:multistatus xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:response><d:propstat><d:prop>"
            + "<c:calendar-data>&lol9;</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>");
        try {
            CalDavFetcher.parseCalendarData(laughs.toString());
            fail("A billion laughs were parsed");
        } catch (IOException expected) {
            // No text of the answer in the message, as for every other bad answer.
            assertTrue(expected.getMessage().equals("Invalid multistatus"));
        }
    }

    @Test
    public void findsADoctypeOnlyWhereXmlAllowsOne() {
        assertTrue(CalDavFetcher.hasDoctype("<!DOCTYPE x><x/>"));
        assertTrue(CalDavFetcher.hasDoctype("﻿ <?xml version=\"1.0\"?><!-- a -->\n<?pi x?><!doctype x [ ]><x/>"));
        assertTrue(CalDavFetcher.hasDoctype("<?xml version=\"1.0\""));
        assertTrue(CalDavFetcher.hasDoctype("<!-- open"));
        assertFalse(CalDavFetcher.hasDoctype("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:multistatus xmlns:d=\"DAV:\"/>"));
        assertFalse(CalDavFetcher.hasDoctype("<d:multistatus xmlns:d=\"DAV:\"><c:calendar-data><![CDATA[DESCRIPTION:<!DOCTYPE html>]]></c:calendar-data></d:multistatus>"));
        assertFalse(CalDavFetcher.hasDoctype(""));
    }

    private static boolean followed(String from, String location) {
        HttpUrl base = HttpUrl.parse(from);
        return CalDavFetcher.sameOrigin(base, base.resolve(location));
    }

    @Test
    public void followsRedirectsOnlyWithinTheSameServer() {
        String calendar = "https://dav.example.org/calendars/anna/work/";
        // The password goes along with the request, so only the same scheme, host and port will do.
        assertTrue(followed(calendar, "/remote.php/dav/calendars/anna/work/"));
        assertTrue(followed(calendar, "https://dav.example.org/other/"));
        assertTrue(followed(calendar, "https://DAV.example.org:443/other/"));
        assertTrue(followed("http://192.168.1.10:5232/anna/", "/anna/calendar/"));

        assertFalse(followed(calendar, "https://evil.example.com/calendars/anna/work/"));
        assertFalse(followed(calendar, "https://dav.example.org.evil.example.com/"));
        assertFalse(followed(calendar, "https://sub.dav.example.org/"));
        assertFalse(followed(calendar, "//evil.example.com/x"));
        assertFalse(followed(calendar, "http://dav.example.org/calendars/anna/work/"));
        assertFalse(followed(calendar, "https://dav.example.org:8443/"));
        assertFalse(followed(calendar, "https://dav.example.org@evil.example.com/"));
        assertFalse(followed("http://192.168.1.10:5232/anna/", "http://192.168.1.11:5232/anna/"));
        assertFalse(followed("http://192.168.1.10:5232/anna/", "https://192.168.1.10:5232/anna/"));
    }

    @Test
    public void aWholeRequestHasATimeLimit() {
        // A server that sends a byte now and then, each just before the read timeout,
        // would otherwise hold the background refresh for days.
        long limit = CalDavFetcher.CLIENT.callTimeoutMillis();
        assertTrue(limit > 0);
        assertTrue(limit <= TimeUnit.MINUTES.toMillis(5));
    }

    @Test(timeout = 10000)
    public void thePasswordIsNotSentOverHttpToAPublicAddress() {
        // The hourly refresh would otherwise send it across the internet in clear, again and again.
        try {
            new CalDavFetcher("anna", "secret").events("http://93.184.215.14:9/cal/", 0, 1000);
            fail("Sent the password");
        } catch (IOException expected) {
            assertEquals(CleartextPassword.REFUSED, expected.getMessage());
        }
    }

    @Test(timeout = 10000)
    public void anAnswerThatTricklesInIsCutOff() throws Exception {
        try (RawServer server = new RawServer(c -> {
            c.readRequest();
            c.write("HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nContent-Length: 100000\r\n\r\n");
            for (int i = 0; i < 100; i++) {
                c.write("<");
                Thread.sleep(100);
            }
        })) {
            // The client of the app with the whole-call limit scaled down to a second.
            OkHttpClient quick = CalDavFetcher.CLIENT.newBuilder().callTimeout(1, TimeUnit.SECONDS).build();
            long start = System.nanoTime();
            try {
                new CalDavFetcher("anna", "secret", quick).events(server.url("/cal/"), 0, 1000);
                fail("Waited for the whole answer");
            } catch (IOException expected) {
            }
            assertTrue(System.nanoTime() - start < TimeUnit.SECONDS.toNanos(3));
        }
    }

    @Test(timeout = 20000)
    public void refusesAnAnswerFarLargerThanTenWeeksOfACalendar() throws Exception {
        byte[] body = new byte[9 * 1024 * 1024];
        Arrays.fill(body, (byte) 'x');
        try (RawServer server = new RawServer(c -> {
            c.readRequest();
            c.write("HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nContent-Length: " + body.length + "\r\n\r\n");
            c.write(body);
        })) {
            try {
                new CalDavFetcher("anna", "secret").tasks(server.url("/cal/"));
                fail("Accepted the answer");
            } catch (BoundedBody.TooLargeException expected) {
            }
        }
    }
}
