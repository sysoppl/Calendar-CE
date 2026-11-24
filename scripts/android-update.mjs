// Where an Android app of this edition looks for a newer version, set when
// it is built (README, "Android app"). Nothing by default: an Android app
// built without these asks nobody, ever, and never locks.
//
//   VITE_UPDATE_URL    the address of your own Calendar CE server, e.g.
//                      https://calendar.example.com. The app asks
//                      <address>/version.json when it starts, when it comes
//                      back to the front (at most once a minute) and every
//                      15 minutes while it is open.
//   VITE_ANDROID_URL   where you put the APK you built, e.g.
//                      https://calendar.example.com/calendar.apk: the lock's
//                      "Download the update" opens it.
//
// Both or neither: with only one of them the app cannot offer anything to
// install, so it asks nothing and never locks (the build says so). Both must
// be https:// addresses: the app's page is https://localhost, and the WebView
// never lets it read a plain http:// answer, nor should an APK be fetched
// that way. The browser's app never reads them: it always asks the server
// it was loaded from.
import { VERSION_FILE } from './version-file.mjs';

/** An unset variable and an empty one both mean "not set". */
function setting(env, name) {
  return (env[name] ?? '').trim();
}

function httpsUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error(`${name} must be an https:// address without a user name or password, got "${value}"`);
  }
  return url;
}

/** `<VITE_UPDATE_URL>/version.json`, or '' when it is not set. */
function versionUrlOf(env) {
  const value = setting(env, 'VITE_UPDATE_URL');
  if (!value) return '';
  const url = httpsUrl('VITE_UPDATE_URL', value);
  if (url.search || url.hash) throw new Error(`VITE_UPDATE_URL must be the plain address of the server, without ? or #, got "${value}"`);
  return `${url.href.replace(/\/+$/, '')}/${VERSION_FILE}`;
}

/** VITE_ANDROID_URL as the browser writes it, or '' when it is not set. */
function downloadUrlOf(env) {
  const value = setting(env, 'VITE_ANDROID_URL');
  return value ? httpsUrl('VITE_ANDROID_URL', value).href : '';
}

/**
 * What the Android app is built with: the server's version.json to ask and
 * the download to offer, both empty unless both variables are set. A
 * malformed value stops the build.
 */
export function resolveAndroidUpdate(env = process.env) {
  const versionUrl = versionUrlOf(env);
  const downloadUrl = downloadUrlOf(env);
  return versionUrl && downloadUrl ? { versionUrl, downloadUrl } : { versionUrl: '', downloadUrl: '' };
}

/** A line for the build's output when only one of the two is set (the check is then off); null otherwise. */
export function androidUpdateNotice(env = process.env) {
  const update = !!setting(env, 'VITE_UPDATE_URL');
  const download = !!setting(env, 'VITE_ANDROID_URL');
  if (update === download) return null;
  return `${update ? 'VITE_UPDATE_URL' : 'VITE_ANDROID_URL'} is set without ${update ? 'VITE_ANDROID_URL' : 'VITE_UPDATE_URL'}: the Android app will not look for a newer version (README, "Android app").`;
}
