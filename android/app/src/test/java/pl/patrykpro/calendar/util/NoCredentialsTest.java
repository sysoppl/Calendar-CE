package pl.patrykpro.calendar.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import org.junit.Test;

import okhttp3.HttpUrl;

public class NoCredentialsTest {
    @Test
    public void takesTheUserNameAndPasswordOutOfTheAddress() {
        assertEquals("https://dav.example.org/cal/home/", NoCredentials.parse("https://ada:s3cr%40t@dav.example.org/cal/home/").toString());
        assertEquals("http://192.168.1.5:5232/ada/", NoCredentials.parse("http://ada@192.168.1.5:5232/ada/").toString());
        // A redirect resolved against the address carries none either.
        HttpUrl base = NoCredentials.parse("https://ada:pw@dav.example.org/a/");
        assertEquals("https://dav.example.org/b/", base.resolve("/b/").toString());
    }

    @Test
    public void leavesOtherAddressesAsTheyAre() {
        HttpUrl plain = HttpUrl.parse("https://dav.example.org/cal/?x=1");
        assertSame(plain, NoCredentials.strip(plain));
        assertNull(NoCredentials.parse("ftp://dav.example.org/"));
        assertNull(NoCredentials.parse("not a url"));
        assertNull(NoCredentials.parse(null));
    }
}
