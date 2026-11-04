// Public settings shared by the build and the server. Everything here ends up
// in the browser: no secrets.
//
// Environment variables (read at build time, and again when the server starts
// - use the same values for both):
//
//   VITE_APP_URL              public address of the web app, default
//                             http://localhost:8787. The DAV proxy answers
//                             only requests for its host name (and for IP
//                             addresses, local names and CALENDAR_PUBLIC_HOSTS).
//
// Links the app shows (build time only; empty by default, and an empty one
// is not shown at all):
//
//   VITE_PRIVACY_URL          privacy policy
//   VITE_TERMS_URL            terms of service
//   VITE_CONTACT_URL          contact or imprint page, or a mailto: address

const DEFAULTS = {
  appUrl: 'http://localhost:8787',
};

/** An unset variable and an empty one (a Docker build argument left blank) both mean "default". */
function setting(env, name, fallback) {
  return (env[name] ?? '').trim() || fallback;
}

function httpUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a plain http(s) address, got "${value}"`);
  }
  // Callers append paths, so the value may not end with a slash.
  return value.replace(/\/+$/, '');
}

/** Reads the public configuration from `env`, falling back to the defaults. */
export function resolvePublicConfig(env = process.env) {
  return {
    appUrl: httpUrl('VITE_APP_URL', setting(env, 'VITE_APP_URL', DEFAULTS.appUrl)),
  };
}

/**
 * A link for people to follow: http(s) with any path, query or fragment, no
 * credentials, and mailto: where `mail` allows it. Returned as the browser
 * writes it, so nothing in it can close the attribute it goes into.
 */
function linkUrl(name, value, { mail = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  const web = url && (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password;
  if (!web && !(mail && url?.protocol === 'mailto:' && url.pathname.includes('@'))) {
    throw new Error(`${name} must be an http(s)${mail ? ' or mailto:' : ''} address, got "${value}"`);
  }
  return url.href;
}

/** Reads the links the app shows from `env`; an unset or empty one stays empty and is not shown. */
export function resolveLinks(env = process.env) {
  const link = (name, options) => {
    const value = setting(env, name, '');
    return value && linkUrl(name, value, options);
  };
  return {
    privacy: link('VITE_PRIVACY_URL'),
    terms: link('VITE_TERMS_URL'),
    contact: link('VITE_CONTACT_URL', { mail: true }),
  };
}

export const publicConfig = resolvePublicConfig();
export const { appUrl } = publicConfig;
