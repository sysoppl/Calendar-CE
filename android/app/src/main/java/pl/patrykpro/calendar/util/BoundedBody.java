package pl.patrykpro.calendar.util;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import okhttp3.MediaType;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;
import okio.ByteString;

/**
 * Reads a response body as text, but only up to a limit. ResponseBody.string()
 * takes whatever the server sends, and a server that never stops sending
 * would run the app out of memory.
 */
public final class BoundedBody {
    private static final long CHUNK = 64 * 1024;
    private static final ByteString UTF_8_BOM = ByteString.decodeHex("efbbbf");
    private static final ByteString UTF_16_BE_BOM = ByteString.decodeHex("feff");
    private static final ByteString UTF_16_LE_BOM = ByteString.decodeHex("fffe");
    private static final ByteString UTF_32_BE_BOM = ByteString.decodeHex("0000feff");
    private static final ByteString UTF_32_LE_BOM = ByteString.decodeHex("fffe0000");

    private BoundedBody() {}

    /** The body was longer than the limit; told apart from a broken connection, which is worth another try. */
    public static final class TooLargeException extends IOException {
        public TooLargeException() {
            super("Response too large");
        }
    }

    /** @throws TooLargeException when the body is longer than {@code maxBytes} */
    public static String read(ResponseBody body, long maxBytes) throws IOException {
        if (body == null) return "";
        if (body.contentLength() > maxBytes) throw new TooLargeException();
        BufferedSource source = body.source();
        Buffer buffer = new Buffer();
        while (buffer.size() <= maxBytes) {
            if (source.read(buffer, CHUNK) == -1) break;
        }
        if (buffer.size() > maxBytes) throw new TooLargeException();

        // As ResponseBody.string() does: a byte order mark wins over the declared charset, UTF-8 is the default.
        MediaType type = body.contentType();
        Charset charset = type != null ? type.charset(StandardCharsets.UTF_8) : StandardCharsets.UTF_8;
        if (buffer.rangeEquals(0, UTF_8_BOM)) {
            buffer.skip(UTF_8_BOM.size());
            charset = StandardCharsets.UTF_8;
        } else if (buffer.rangeEquals(0, UTF_32_BE_BOM)) {
            buffer.skip(UTF_32_BE_BOM.size());
            charset = Charset.forName("UTF-32BE");
        } else if (buffer.rangeEquals(0, UTF_32_LE_BOM)) {
            buffer.skip(UTF_32_LE_BOM.size());
            charset = Charset.forName("UTF-32LE");
        } else if (buffer.rangeEquals(0, UTF_16_BE_BOM)) {
            buffer.skip(UTF_16_BE_BOM.size());
            charset = StandardCharsets.UTF_16BE;
        } else if (buffer.rangeEquals(0, UTF_16_LE_BOM)) {
            buffer.skip(UTF_16_LE_BOM.size());
            charset = StandardCharsets.UTF_16LE;
        }
        return buffer.readString(charset == null ? StandardCharsets.UTF_8 : charset);
    }
}
