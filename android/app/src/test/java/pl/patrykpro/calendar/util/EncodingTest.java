package pl.patrykpro.calendar.util;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.util.Base64;
import java.util.Random;

public class EncodingTest {

    @Test
    public void base64AgreesWithTheJdkForEveryLength() {
        Random random = new Random(7);
        for (int length = 0; length <= 300; length++) {
            byte[] bytes = new byte[length];
            random.nextBytes(bytes);
            String text = Encoding.base64(bytes);
            assertEquals(Base64.getEncoder().encodeToString(bytes), text);
            assertArrayEquals(bytes, Encoding.fromBase64(text));
        }
    }

    private static void assertNotBase64(String text) {
        try {
            Encoding.fromBase64(text);
            fail("Accepted: " + text);
        } catch (IllegalArgumentException expected) {
        }
    }

    @Test
    public void base64DecoderIsStrict() {
        assertNotBase64("QQ");          // padding left out
        assertNotBase64("QQ=");         // wrong length
        assertNotBase64("Q===");        // too much padding
        assertNotBase64("QQ=Q");        // padding in the middle
        assertNotBase64("=QQQ");
        assertNotBase64("QR==");        // bits that belong to no byte
        assertNotBase64("QUJ=");
        assertNotBase64("QUJD QUJD");   // whitespace
        assertNotBase64("QUJD\n");
        assertNotBase64("QU*D");        // outside the alphabet
        assertNotBase64("QU-_");        // the URL-safe alphabet is another encoding
        assertNotBase64("QUJł");   // outside ASCII
        assertArrayEquals(new byte[0], Encoding.fromBase64(""));
        assertArrayEquals(new byte[] {'A'}, Encoding.fromBase64("QQ=="));
        assertArrayEquals(new byte[] {'A', 'B'}, Encoding.fromBase64("QUI="));
    }

    @Test
    public void hexRoundTripsAndRefusesOtherText() {
        byte[] bytes = {0, 1, 0x7f, (byte) 0x80, (byte) 0xff};
        assertEquals("00017f80ff", Encoding.hex(bytes));
        assertArrayEquals(bytes, Encoding.fromHex("00017f80ff"));
        assertArrayEquals(bytes, Encoding.fromHex("00017F80FF"));
        for (String bad : new String[] {"0", "0g", "0x10", " 00", "００"}) {
            try {
                Encoding.fromHex(bad);
                fail("Accepted: " + bad);
            } catch (IllegalArgumentException expected) {
            }
        }
    }
}
