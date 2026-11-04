// Response headers that lock the app down. Used by server.mjs, by `vite
// preview` and, as a <meta> tag in index.html, by builds that no server sends
// headers for (the Android bundle).

const DEFAULT_HSTS = 'max-age=63072000; includeSubDomains';

/**
 * Powerful features the app never uses, switched off for the page and
 * anything it could embed. The clipboard and
 * notifications (reminders) stay available; names browsers do not know any
 * more (the retired ad-measurement features) are left out, since they only
 * produce console warnings.
 */
export const PERMISSIONS_POLICY = [
  'accelerometer',
  'bluetooth',
  'camera',
  'display-capture',
  'encrypted-media',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'otp-credentials',
  'payment',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ');

/**
 * The app keeps CalDAV credentials in the browser, so script injection must
 * not be possible: only same-origin scripts, no plugins, no framing.
 * connect-src stays open for http(s) because accounts in "direct" mode talk
 * to arbitrary CalDAV servers straight from the browser.
 *
 * `meta: true` gives the variant for a <meta http-equiv> tag, where browsers
 * ignore frame-ancestors (and complain about it).
 */
export function contentSecurityPolicy({ meta = false } = {}) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: http:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (!meta) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

/**
 * Value of Strict-Transport-Security, or null when CALENDAR_HSTS turns it
 * off. Browsers only honour the header over HTTPS, so sending it from behind
 * a TLS reverse proxy is what makes it count.
 */
export function hstsFromEnv(env = process.env) {
  const value = (env.CALENDAR_HSTS ?? '').trim();
  if (!value) return DEFAULT_HSTS;
  if (/^(0|false|no|off)$/i.test(value)) return null;
  if (!/^[\w=;, -]+$/.test(value)) throw new Error(`CALENDAR_HSTS is not a valid header value: "${value}"`);
  return value;
}

/**
 * Headers for every static response. `hsts` is the Strict-Transport-Security
 * value, or false/null to leave the header out.
 */
export function securityHeaders({ hsts = hstsFromEnv() } = {}) {
  return {
    'content-security-policy': contentSecurityPolicy(),
    ...(hsts ? { 'strict-transport-security': hsts } : {}),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': PERMISSIONS_POLICY,
  };
}
