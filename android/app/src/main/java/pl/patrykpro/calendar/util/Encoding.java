package pl.patrykpro.calendar.util;

import java.util.Arrays;

/**
 * Base64 and hex for what the app keeps in its own storage.
 *
 * java.util.Base64 needs API 26 and android.util.Base64 does not exist in
 * plain JVM unit tests, so the few lines live here. The decoder is strict on
 * purpose (standard alphabet, exact padding, no whitespace, no stray bits).
 */
public final class Encoding {
    private static final char[] ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
    private static final int[] VALUES = new int[128];
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    static {
        Arrays.fill(VALUES, -1);
        for (int i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET[i]] = i;
    }

    private Encoding() {}

    /** Standard base64 with padding. */
    public static String base64(byte[] bytes) {
        StringBuilder out = new StringBuilder((bytes.length + 2) / 3 * 4);
        for (int i = 0; i < bytes.length; i += 3) {
            int left = bytes.length - i;
            int b0 = bytes[i] & 0xff;
            int b1 = left > 1 ? bytes[i + 1] & 0xff : 0;
            int b2 = left > 2 ? bytes[i + 2] & 0xff : 0;
            out.append(ALPHABET[b0 >>> 2]);
            out.append(ALPHABET[(b0 & 0x03) << 4 | b1 >>> 4]);
            out.append(left > 1 ? ALPHABET[(b1 & 0x0f) << 2 | b2 >>> 6] : '=');
            out.append(left > 2 ? ALPHABET[b2 & 0x3f] : '=');
        }
        return out.toString();
    }

    private static int sextet(String text, int index) {
        char c = text.charAt(index);
        int value = c < 128 ? VALUES[c] : -1;
        if (value < 0) throw new IllegalArgumentException("Not base64");
        return value;
    }

    /** @throws IllegalArgumentException when the text is not canonical standard base64 */
    public static byte[] fromBase64(String text) {
        int length = text.length();
        if (length % 4 != 0) throw new IllegalArgumentException("Not base64");
        if (length == 0) return new byte[0];
        int padding = text.charAt(length - 1) != '=' ? 0 : text.charAt(length - 2) != '=' ? 1 : 2;
        byte[] out = new byte[length / 4 * 3 - padding];
        int o = 0;
        for (int i = 0; i < length; i += 4) {
            boolean last = i + 4 == length;
            int s0 = sextet(text, i);
            int s1 = sextet(text, i + 1);
            int s2 = last && padding == 2 ? 0 : sextet(text, i + 2);
            int s3 = last && padding >= 1 ? 0 : sextet(text, i + 3);
            int word = s0 << 18 | s1 << 12 | s2 << 6 | s3;
            out[o++] = (byte) (word >>> 16);
            if (!last || padding < 2) out[o++] = (byte) (word >>> 8);
            if (!last || padding < 1) out[o++] = (byte) word;
            // Bits that no byte takes must be zero, or two texts would decode to the same bytes.
            if (last && ((padding == 2 && (s1 & 0x0f) != 0) || (padding == 1 && (s2 & 0x03) != 0))) {
                throw new IllegalArgumentException("Not base64");
            }
        }
        return out;
    }

    /** Lower-case hexadecimal. */
    public static String hex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            out[2 * i] = HEX[(bytes[i] & 0xf0) >>> 4];
            out[2 * i + 1] = HEX[bytes[i] & 0x0f];
        }
        return new String(out);
    }

    private static int nibble(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        throw new IllegalArgumentException("Not hexadecimal");
    }

    /** @throws IllegalArgumentException when the text is not hexadecimal */
    public static byte[] fromHex(String text) {
        if (text.length() % 2 != 0) throw new IllegalArgumentException("Not hexadecimal");
        byte[] out = new byte[text.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) (nibble(text.charAt(2 * i)) << 4 | nibble(text.charAt(2 * i + 1)));
        return out;
    }
}
