package pl.patrykpro.calendar.reminders;

import android.util.Xml;

import org.xmlpull.v1.XmlPullParser;

import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

import okhttp3.Credentials;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import pl.patrykpro.calendar.util.BoundedBody;
import pl.patrykpro.calendar.util.CertificateBlocklist;
import pl.patrykpro.calendar.util.CleartextPassword;
import pl.patrykpro.calendar.util.NoCredentials;

/** Fetches calendar data for reminders with CalDAV calendar-query REPORTs. */
final class CalDavFetcher implements ReminderSyncWorker.CalendarSource {
    private static final String CALDAV = "urn:ietf:params:xml:ns:caldav";
    private static final MediaType XML = MediaType.parse("application/xml; charset=utf-8");
    /**
     * Ten weeks of one calendar, expanded, is far below this. The text is held
     * several times over while it is parsed, so the limit is what keeps a
     * hostile server from running the background refresh out of memory.
     */
    static final long MAX_BODY_BYTES = 8L * 1024 * 1024;

    /**
     * Shared by every calendar and every run, so they share one connection
     * pool. Every request carries the password, so over plain http it goes only
     * to a server on the private network (CleartextPassword): the hourly
     * refresh does not send it across the internet in clear.
     */
    static final OkHttpClient CLIENT = CleartextPassword.guard(CertificateBlocklist.guard(new OkHttpClient.Builder()))
        .followRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        // Bounds the whole exchange: a server that sends a byte now and then, each
        // just inside the read timeout, would otherwise hold the refresh for days.
        .callTimeout(2, TimeUnit.MINUTES)
        .retryOnConnectionFailure(true)
        .build();

    private final OkHttpClient client;
    private final String auth;

    CalDavFetcher(String username, String password) {
        this(username, password, CLIENT);
    }

    CalDavFetcher(String username, String password, OkHttpClient client) {
        this.client = client;
        this.auth = Credentials.basic(username == null ? "" : username, password == null ? "" : password, StandardCharsets.UTF_8);
    }

    private static String utc(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }

    /**
     * Events overlapping [from, to), expanded into single instances by the
     * server so recurrence rules need no client-side handling.
     */
    @Override
    public List<String> events(String calendarUrl, long from, long to) throws IOException {
        String body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"" + CALDAV + "\">"
            + "<d:prop><c:calendar-data><c:expand start=\"" + utc(from) + "\" end=\"" + utc(to) + "\"/></c:calendar-data></d:prop>"
            + "<c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\">"
            + "<c:time-range start=\"" + utc(from) + "\" end=\"" + utc(to) + "\"/>"
            + "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
        return report(calendarUrl, body);
    }

    /** All open tasks (tasks are few; no time-range so undated ones are skipped later). */
    @Override
    public List<String> tasks(String calendarUrl) throws IOException {
        String body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"" + CALDAV + "\">"
            + "<d:prop><c:calendar-data/></d:prop>"
            + "<c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VTODO\">"
            + "<c:prop-filter name=\"COMPLETED\"><c:is-not-defined/></c:prop-filter>"
            + "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
        return report(calendarUrl, body);
    }

    /** Same scheme, host and port: the only place a redirect may take the password to. */
    static boolean sameOrigin(HttpUrl a, HttpUrl b) {
        return a.scheme().equals(b.scheme()) && a.host().equals(b.host()) && a.port() == b.port();
    }

    // The messages below end up on the settings screen and must not contain the calendar's address.
    private List<String> report(String url, String body) throws IOException {
        // A user name and password in the address are not used; the Authorization header carries them.
        HttpUrl target = NoCredentials.parse(url);
        if (target == null) throw new IOException("Invalid calendar address");
        for (int hop = 0; hop < 4; hop++) {
            Request request = new Request.Builder()
                .url(target)
                .header("Authorization", auth)
                .header("Depth", "1")
                .method("REPORT", RequestBody.create(body.getBytes(StandardCharsets.UTF_8), XML))
                .build();
            try (Response res = client.newCall(request).execute()) {
                int code = res.code();
                if (code >= 300 && code < 400 && res.header("Location") != null) {
                    HttpUrl next = target.resolve(res.header("Location"));
                    if (next == null) throw new IOException("Bad redirect");
                    // The request carries the password. A redirect to another host, or
                    // from https to http, would hand it to whoever is named there.
                    if (!sameOrigin(target, next)) throw new IOException("Redirect to another server refused");
                    target = next;
                    continue;
                }
                if (code != 207) throw new IOException("HTTP " + code);
                return parseCalendarData(BoundedBody.read(res.body(), MAX_BODY_BYTES));
            }
        }
        throw new IOException("Too many redirects");
    }

    static List<String> parseCalendarData(String xml) throws IOException {
        // Android's parser reads a DOCTYPE and expands the entities it defines: a few hundred
        // bytes of nested ones ("billion laughs") would hold the refresh or run it out of memory.
        // No CalDAV server sends one in a multistatus answer.
        if (hasDoctype(xml)) throw new IOException("Invalid multistatus");
        List<String> out = new ArrayList<>();
        try {
            XmlPullParser p = Xml.newPullParser();
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true);
            p.setInput(new StringReader(xml));
            int event;
            while ((event = p.next()) != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG && CALDAV.equals(p.getNamespace()) && "calendar-data".equals(p.getName())) {
                    String text = p.nextText();
                    if (text != null && text.contains("BEGIN:")) out.add(text);
                }
            }
        } catch (Exception e) {
            // The parser's own message quotes the text around the error, which is calendar content.
            throw new IOException("Invalid multistatus");
        }
        return out;
    }

    /**
     * Whether the document declares a DOCTYPE, which XML allows only before
     * its first element: after a byte order mark, white space, the XML
     * declaration, processing instructions and comments. A text that cannot be
     * read that far counts as having one.
     */
    static boolean hasDoctype(String xml) {
        int i = 0;
        int n = xml.length();
        if (i < n && xml.charAt(i) == '﻿') i++;
        while (true) {
            while (i < n && Character.isWhitespace(xml.charAt(i))) i++;
            if (xml.startsWith("<?", i)) {
                int end = xml.indexOf("?>", i + 2);
                if (end < 0) return true;
                i = end + 2;
            } else if (xml.startsWith("<!--", i)) {
                int end = xml.indexOf("-->", i + 4);
                if (end < 0) return true;
                i = end + 3;
            } else {
                // "<!DOCTYPE" in any case, or any other declaration, which has no place here either.
                return xml.startsWith("<!", i);
            }
        }
    }
}
