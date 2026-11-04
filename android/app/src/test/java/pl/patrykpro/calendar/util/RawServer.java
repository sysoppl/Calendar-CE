package pl.patrykpro.calendar.util;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * A bare HTTP/1.1 server on the loopback interface, scripted connection by
 * connection, for tests that need what only a real socket shows: an answer
 * that trickles in, or a connection that is lost in the middle of an exchange.
 */
public final class RawServer implements Closeable {
    /** What the server does with one accepted connection; the connection is closed when it returns. */
    public interface Script {
        void run(Connection connection) throws Exception;
    }

    public final class Connection {
        private final InputStream in;
        private final OutputStream out;

        Connection(Socket socket) throws IOException {
            this.in = socket.getInputStream();
            this.out = socket.getOutputStream();
        }

        /** Reads one whole request, body included; returns its first line, or null when the client closed the connection. */
        public String readRequest() throws IOException {
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            int b;
            while ((b = in.read()) != -1) {
                head.write(b);
                byte[] h = head.toByteArray();
                int n = h.length;
                if (n >= 4 && h[n - 4] == '\r' && h[n - 3] == '\n' && h[n - 2] == '\r' && h[n - 1] == '\n') break;
            }
            if (b == -1) return null;
            String[] lines = head.toString("ISO-8859-1").split("\r\n");
            long length = 0;
            for (String line : lines) {
                if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) length = Long.parseLong(line.substring(15).trim());
            }
            for (long i = 0; i < length; i++) {
                if (in.read() == -1) break;
            }
            requests.add(lines[0]);
            return lines[0];
        }

        public void write(String text) throws IOException {
            write(text.getBytes(StandardCharsets.ISO_8859_1));
        }

        public void write(byte[] bytes) throws IOException {
            out.write(bytes);
            out.flush();
        }
    }

    private final ServerSocket socket;
    /** The first line of every request read, from every connection, in order. */
    public final List<String> requests = Collections.synchronizedList(new ArrayList<>());

    /** The i-th script handles the i-th connection; any connection beyond them is closed at once. */
    public RawServer(Script... scripts) throws IOException {
        socket = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
        Thread acceptor = new Thread(() -> {
            for (int i = 0; ; i++) {
                Socket accepted;
                try {
                    accepted = socket.accept();
                } catch (IOException closed) {
                    return;
                }
                Script script = i < scripts.length ? scripts[i] : null;
                Thread worker = new Thread(() -> {
                    try (Socket s = accepted) {
                        if (script != null) script.run(new Connection(s));
                    } catch (Exception ignored) {
                        // The client went away; that is what several tests are about.
                    }
                });
                worker.setDaemon(true);
                worker.start();
            }
        });
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public String url(String path) {
        return "http://127.0.0.1:" + socket.getLocalPort() + path;
    }

    /** How many requests with this method were read. */
    public int count(String method) {
        synchronized (requests) {
            int n = 0;
            for (String line : requests) if (line.startsWith(method + " ")) n++;
            return n;
        }
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }
}
