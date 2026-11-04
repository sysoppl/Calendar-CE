package pl.patrykpro.calendar.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.net.ssl.SSLEngine;
import javax.net.ssl.X509ExtendedTrustManager;

import okhttp3.OkHttpClient;

public class CertificateBlocklistTest {
    /**
     * "CN=EM OV TLS CA - G3C, O=eMudhra Inc, C=US", one of the eight blocked
     * intermediates (its private key is 4), signed by the root below. Both from
     * OkHttp 5.5.1's okhttp/src/commonTest/kotlin/okhttp3/CompromisedIntermediateTest.kt.
     */
    static final String COMPROMISED_INTERMEDIATE = "-----BEGIN CERTIFICATE-----\n"
        + "MIIDaDCCAu6gAwIBAgIPKWkmwiejoVJjkrGUgqUEMAoGCCqGSM49BAMDMFYxCzAJ\n"
        + "BgNVBAYTAklOMSUwIwYDVQQKDBxlTXVkaHJhIFRlY2hub2xvZ2llcyBMaW1pdGVk\n"
        + "MSAwHgYDVQQDDBdlbVNpZ24gUm9vdCBUTFMgQ0EgLSBHMzAeFw0yNTA0MzAxNTM3\n"
        + "NDFaFw00MDA0MjgxODMwMDBaMEAxCzAJBgNVBAYTAlVTMRQwEgYDVQQKDAtlTXVk\n"
        + "aHJhIEluYzEbMBkGA1UEAwwSRU0gT1YgVExTIENBIC0gRzNDMHYwEAYHKoZIzj0C\n"
        + "AQYFK4EEACIDYgAEE4JRzVKskpjByKrZdzId65fnCb0LTKCspV3IrVHc/J0ViaFZ\n"
        + "fjpRIOHv1jHGPhg1ysrimGmmLhYx6KKBgatWYW3EXZGKvAnzqw5jz3kqpNztc4e+\n"
        + "N7ulaVSfHAKycO1no4IBljCCAZIwHwYDVR0jBBgwFoAU4TqrIXzx401UrtRyt/2L\n"
        + "WUIgkFQwHQYDVR0OBBYEFDTq6gzryQra+dDF4u2beMmHnhtsMB0GA1UdJQQWMBQG\n"
        + "CCsGAQUFBwMBBggrBgEFBQcDAjBdBgNVHSAEVjBUMDkGCysGAQQBg44hAQABMCow\n"
        + "KAYIKwYBBQUHAgEWHGh0dHA6Ly9yZXBvc2l0b3J5LmVtc2lnbi5jb20wDQYLKwYB\n"
        + "BAGDjiEBAm4wCAYGZ4EMAQICMHUGCCsGAQUFBwEBBGkwZzAkBggrBgEFBQcwAYYY\n"
        + "aHR0cDovL29jc3AtYy5lbXNpZ24uY29tMD8GCCsGAQUFBzAChjNodHRwOi8vcmVw\n"
        + "b3NpdG9yeS5lbXNpZ24uY29tL2NlcnRzL0VNT1ZUTFNDQUczQy5wN2MwNwYDVR0f\n"
        + "BDAwLjAsoCqgKIYmaHR0cDovL2NybC5lbXNpZ24uY29tLz9yb290dGxzY2FnMy5j\n"
        + "cmwwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQAwCgYIKoZIzj0E\n"
        + "AwMDaAAwZQIxAMSZt2xsPeumRdeSMSQ3CbzIZeQ/q7GDCWfeE1Pq+mhgA6gRM44c\n"
        + "NVF3xJ+wsxJk+wIwFJbaDMokD8Ei6eNOiA8yUMYvfzQyngmrhZQMdPCK1SewrR79\n"
        + "4rSb9vGqxZzelQth\n"
        + "-----END CERTIFICATE-----\n";

    /** "CN=emSign Root TLS CA - G3, O=eMudhra Technologies Limited, C=IN", a root in public trust stores: not blocked. */
    static final String EMSIGN_ROOT = "-----BEGIN CERTIFICATE-----\n"
        + "MIICKTCCAa+gAwIBAgIQDnYGcvFDRZ/I/gqwvAXjlDAKBggqhkjOPQQDAzBWMQsw\n"
        + "CQYDVQQGEwJJTjElMCMGA1UECgwcZU11ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRl\n"
        + "ZDEgMB4GA1UEAwwXZW1TaWduIFJvb3QgVExTIENBIC0gRzMwHhcNMjQwMjA4MDgx\n"
        + "OTMyWhcNNDkwMjA3MDgxOTMyWjBWMQswCQYDVQQGEwJJTjElMCMGA1UECgwcZU11\n"
        + "ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAwwXZW1TaWduIFJvb3Qg\n"
        + "VExTIENBIC0gRzMwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAARfD9w/q1cWxL6D9bMG\n"
        + "H6CQ4u+gAV6GN9s+PwQx9Bl4hC+0iU8QOk8mWO/RwXQy10DCSxT8vSIJClHKp+Ao\n"
        + "4qJKdYeV0SwZ7LMQziyLfxIUOY6Grja/sQFwLKYf8EdDXAyjQjBAMB0GA1UdDgQW\n"
        + "BBThOqshfPHjTVSu1HK3/YtZQiCQVDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/\n"
        + "BAUwAwEB/zAKBggqhkjOPQQDAwNoADBlAjBhCFTkly7Yl7+s4hiw+k6ZJTXT2AiI\n"
        + "rvmsmfqPr5E7ecwXb6kXA5LTFd6rjwTuV3sCMQC9w6ZSbVq1mveMO6dKFziOzClT\n"
        + "KCT2RFT6yXtq6nzgRICgBmiXbJAXsmZ8yAwjyWc=\n"
        + "-----END CERTIFICATE-----\n";

    static X509Certificate pem(String text) throws Exception {
        return (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(text.getBytes(StandardCharsets.US_ASCII)));
    }

    /** A platform stand-in that trusts every chain and notes each call, by the variant it was. */
    static class AcceptAll extends X509ExtendedTrustManager {
        final List<String> calls = new ArrayList<>();

        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException { calls.add("server"); }
        @Override public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException { calls.add("server+socket"); }
        @Override public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException { calls.add("server+engine"); }
        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException { calls.add("client"); }
        @Override public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException { calls.add("client+socket"); }
        @Override public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException { calls.add("client+engine"); }
        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }

    @Test
    public void theListIsOkHttpsEight() {
        assertEquals(8, CertificateBlocklist.BLOCKED_SPKI_SHA256.size());
        for (String hash : CertificateBlocklist.BLOCKED_SPKI_SHA256) assertTrue(hash, hash.matches("[0-9a-f]{64}"));
    }

    @Test
    public void theCompromisedIntermediateIsOnTheListAndItsRootIsNot() throws Exception {
        X509Certificate intermediate = pem(COMPROMISED_INTERMEDIATE);
        assertEquals("63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8", CertificateBlocklist.spkiSha256(intermediate));
        assertTrue(CertificateBlocklist.BLOCKED_SPKI_SHA256.contains(CertificateBlocklist.spkiSha256(intermediate)));
        assertFalse(CertificateBlocklist.BLOCKED_SPKI_SHA256.contains(CertificateBlocklist.spkiSha256(pem(EMSIGN_ROOT))));
        // The pair is genuine: the root's key signed the intermediate.
        intermediate.verify(pem(EMSIGN_ROOT).getPublicKey());
    }

    @Test
    public void aChainWithABlockedCertificateIsRefusedEvenWhenThePlatformTrustsIt() throws Exception {
        AcceptAll platform = new AcceptAll();
        CertificateBlocklist.Guard guard = new CertificateBlocklist.Guard(platform, CertificateBlocklist.BLOCKED_SPKI_SHA256);
        // A server certificate stand-in, then the blocked intermediate and the root, as a server sends them.
        X509Certificate[] chain = { pem(EMSIGN_ROOT), pem(COMPROMISED_INTERMEDIATE), pem(EMSIGN_ROOT) };
        try {
            guard.checkServerTrusted(chain, "ECDHE_ECDSA");
            fail("refused without a socket");
        } catch (CertificateException expected) {
            assertTrue(expected.getMessage().contains("EM OV TLS CA - G3C"));
        }
        try {
            guard.checkServerTrusted(chain, "ECDHE_ECDSA", (Socket) null);
            fail("refused with a socket");
        } catch (CertificateException expected) {
            // As above.
        }
        try {
            guard.checkServerTrusted(chain, "ECDHE_ECDSA", (SSLEngine) null);
            fail("refused with an engine");
        } catch (CertificateException expected) {
            // As above.
        }
        // Refused before the platform was asked at all.
        assertEquals(Collections.emptyList(), platform.calls);
    }

    @Test
    public void otherChainsAreLeftToThePlatformWithTheSameVariant() throws Exception {
        AcceptAll platform = new AcceptAll();
        CertificateBlocklist.Guard guard = new CertificateBlocklist.Guard(platform, CertificateBlocklist.BLOCKED_SPKI_SHA256);
        X509Certificate[] chain = { pem(EMSIGN_ROOT) };
        guard.checkServerTrusted(chain, "ECDHE_ECDSA");
        guard.checkServerTrusted(chain, "ECDHE_ECDSA", (Socket) null);
        guard.checkServerTrusted(chain, "ECDHE_ECDSA", (SSLEngine) null);
        guard.checkClientTrusted(chain, "ECDHE_ECDSA");
        guard.checkClientTrusted(chain, "ECDHE_ECDSA", (Socket) null);
        guard.checkClientTrusted(chain, "ECDHE_ECDSA", (SSLEngine) null);
        // The platform's own check keeps the host it reads from the socket (Network Security Config).
        assertEquals(java.util.Arrays.asList("server", "server+socket", "server+engine", "client", "client+socket", "client+engine"), platform.calls);
        assertNotNull(guard.getAcceptedIssuers());
    }

    @Test
    public void thePlatformsOwnRefusalStillCounts() throws Exception {
        X509ExtendedTrustManager refuseAll = new AcceptAll() {
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
                throw new CertificateException("untrusted");
            }
        };
        CertificateBlocklist.Guard guard = new CertificateBlocklist.Guard(refuseAll, CertificateBlocklist.BLOCKED_SPKI_SHA256);
        try {
            guard.checkServerTrusted(new X509Certificate[] { pem(EMSIGN_ROOT) }, "ECDHE_ECDSA", (Socket) null);
            fail("refused");
        } catch (CertificateException expected) {
            assertEquals("untrusted", expected.getMessage());
        }
    }

    @Test
    public void theRealPlatformTrustManagerIsWrapped() throws Exception {
        OkHttpClient client = CertificateBlocklist.guard(new OkHttpClient.Builder()).build();
        CertificateBlocklist.Guard guard = (CertificateBlocklist.Guard) client.x509TrustManager();
        assertEquals(CertificateBlocklist.platformTrustManager().getClass(), guard.delegate().getClass());
        try {
            guard.checkServerTrusted(new X509Certificate[] { pem(COMPROMISED_INTERMEDIATE), pem(EMSIGN_ROOT) }, "ECDHE_ECDSA");
            fail("refused");
        } catch (CertificateException expected) {
            assertTrue(expected.getMessage().contains("blocked"));
        }
    }

    @Test
    public void everyClientGetsTheSameGuard() {
        OkHttpClient a = CertificateBlocklist.guard(new OkHttpClient.Builder()).build();
        OkHttpClient b = CertificateBlocklist.guard(new OkHttpClient.Builder()).build();
        assertTrue(a.x509TrustManager() instanceof CertificateBlocklist.Guard);
        assertSame(a.x509TrustManager(), b.x509TrustManager());
        assertSame(a.sslSocketFactory(), b.sslSocketFactory());
        // newBuilder() keeps it, as the clients derived from a shared one do.
        assertSame(a.x509TrustManager(), a.newBuilder().build().x509TrustManager());
    }

    /** For the tests of the clients themselves. */
    public static boolean guarded(OkHttpClient client) {
        return client.x509TrustManager() instanceof CertificateBlocklist.Guard;
    }
}
