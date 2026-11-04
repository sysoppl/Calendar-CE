package pl.patrykpro.calendar.util;

import java.net.Socket;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509ExtendedTrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;

/**
 * Refuses a TLS connection whose server sends a certificate on the blocklist
 * below, whatever the trust store says. Every OkHttp client of the app
 * (DavHttp, the CalDAV reminder refresh) is
 * built through {@link #guard}.
 *
 * The list is the one OkHttp 5.5.1 ships: eight intermediate certificates
 * issued under "emSign Root TLS CA - G3" whose private keys can be rebuilt
 * from the public certificates (CVE-2026-111943). OkHttp 5.5 needs
 * compileSdk 37, which the Android Gradle plugin of Capacitor 8 does not
 * build with yet, so the app stays on 5.4 and carries the same check itself.
 * Devices with the store's system updates got the fix in their trust store;
 * side-loaded installs on phones without them, and older phones whose store no
 * longer updates, did not. Copied from
 * https://github.com/square/okhttp/blob/parent-5.5.1/okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/tls/CertificateBlocklist.kt
 * (commit 6db9802, "Blocklist 8 certificates for CVE-2026-111943"; Apache-2.0).
 * When the app moves to OkHttp 5.5.1 or later, this class can go.
 *
 * Each entry is the SHA-256 of the certificate's SubjectPublicKeyInfo (what
 * OkHttp's {@code CertificatePinner.sha256Hash} computes), in hex. As in
 * OkHttp, every certificate the server sends is checked, before the platform's
 * own check. The platform's trust manager stays the one that decides
 * otherwise: on Android that is the Network Security Config's (system and
 * user-installed CAs), so nothing else changes, a private CA or a self-signed
 * CalDAV server included.
 */
public final class CertificateBlocklist {
    private CertificateBlocklist() {}

    /** https://www.cve.org/CVERecord?id=CVE-2026-111943 */
    static final Set<String> BLOCKED_SPKI_SHA256 = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b",
        "49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f",
        "5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0",
        "63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8",
        "92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30",
        "e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41",
        "ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105",
        "ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6"
    )));

    private static volatile Tls tls;

    /** The SSL socket factory and trust manager every client of the app uses. */
    private static final class Tls {
        final javax.net.ssl.SSLSocketFactory factory;
        final Guard trustManager;

        Tls(javax.net.ssl.SSLSocketFactory factory, Guard trustManager) {
            this.factory = factory;
            this.trustManager = trustManager;
        }
    }

    /**
     * {@code builder} with the platform's trust manager wrapped in a
     * {@link Guard}. One SSL context serves every client, as OkHttp's own
     * default would.
     */
    public static OkHttpClient.Builder guard(OkHttpClient.Builder builder) {
        Tls current = tls();
        return builder.sslSocketFactory(current.factory, current.trustManager);
    }

    private static Tls tls() {
        Tls current = tls;
        if (current != null) return current;
        synchronized (CertificateBlocklist.class) {
            if (tls != null) return tls;
            try {
                Guard guard = new Guard(platformTrustManager(), BLOCKED_SPKI_SHA256);
                SSLContext context = SSLContext.getInstance("TLS");
                context.init(null, new TrustManager[] { guard }, null);
                tls = new Tls(context.getSocketFactory(), guard);
                return tls;
            } catch (GeneralSecurityException e) {
                // Every Android and every JVM has a default TLS context and trust manager.
                throw new IllegalStateException("No TLS trust manager", e);
            }
        }
    }

    /** The trust manager OkHttp would use without one: on Android the Network Security Config's. */
    static X509TrustManager platformTrustManager() throws GeneralSecurityException {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init((KeyStore) null);
        for (TrustManager manager : factory.getTrustManagers()) {
            if (manager instanceof X509TrustManager) return (X509TrustManager) manager;
        }
        throw new GeneralSecurityException("No X509TrustManager");
    }

    /** Hex SHA-256 of the certificate's SubjectPublicKeyInfo. */
    static String spkiSha256(X509Certificate certificate) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getPublicKey().getEncoded());
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) hex.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * A trust manager that refuses a server chain with a blocked certificate
     * and otherwise asks the one it wraps. It is an
     * {@link X509ExtendedTrustManager} and hands on the socket or engine, so
     * the platform's check still knows the host (Android's Network Security
     * Config chooses its rules by host and refuses a check without one).
     */
    static final class Guard extends X509ExtendedTrustManager {
        private final X509TrustManager delegate;
        private final Set<String> blocked;

        Guard(X509TrustManager delegate, Set<String> blocked) {
            this.delegate = delegate;
            this.blocked = blocked;
        }

        X509TrustManager delegate() {
            return delegate;
        }

        void refuseBlocked(X509Certificate[] chain) throws CertificateException {
            if (chain == null) return;
            for (X509Certificate certificate : chain) {
                if (certificate != null && blocked.contains(spkiSha256(certificate))) {
                    throw new CertificateException("The server sent a blocked certificate: " + certificate.getSubjectX500Principal().getName());
                }
            }
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            refuseBlocked(chain);
            delegate.checkServerTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            refuseBlocked(chain);
            if (delegate instanceof X509ExtendedTrustManager) ((X509ExtendedTrustManager) delegate).checkServerTrusted(chain, authType, socket);
            else delegate.checkServerTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            refuseBlocked(chain);
            if (delegate instanceof X509ExtendedTrustManager) ((X509ExtendedTrustManager) delegate).checkServerTrusted(chain, authType, engine);
            else delegate.checkServerTrusted(chain, authType);
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            delegate.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            if (delegate instanceof X509ExtendedTrustManager) ((X509ExtendedTrustManager) delegate).checkClientTrusted(chain, authType, socket);
            else delegate.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            if (delegate instanceof X509ExtendedTrustManager) ((X509ExtendedTrustManager) delegate).checkClientTrusted(chain, authType, engine);
            else delegate.checkClientTrusted(chain, authType);
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return delegate.getAcceptedIssuers();
        }
    }
}
