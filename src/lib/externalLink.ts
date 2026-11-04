// The one check for every link built from calendar data (an event's LOCATION,
// URL and DESCRIPTION, a meeting link). Whoever wrote the event chose the
// address, so only a web page elsewhere becomes a link: never the app's own
// host. In the Android app the app itself is served from
// https://localhost, where Capacitor also answers /_capacitor_file_/ and
// /_capacitor_content_/ with device files and other apps' content; a link
// there would open inside the app, at its own origin. So on native no loopback
// host and no single-label host (which only a local network resolves) is a
// link either. Anything refused is shown as plain text.
import { Capacitor } from '@capacitor/core';

/** Longer addresses are not offered as links (no browser needs one, and nothing is searched past it). */
export const MAX_LINK_LENGTH = 2048;

export interface LinkContext {
  /** The app runs in the Android shell. */
  native: boolean;
  /** The host name the app itself is served from. */
  appHost?: string;
}

function currentContext(): LinkContext {
  return {
    native: Capacitor.isNativePlatform(),
    appHost: typeof location !== 'undefined' ? location.hostname : undefined,
  };
}

/** A host name (as the URL parser writes it) that names this device. */
function isLoopback(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host) || host === '0.0.0.0') return true;
  // [::1], and IPv4 loopback written as IPv6 ([::ffff:7f00:1]).
  return host === '[::1]' || host === '[::]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
}

/**
 * The address to link to for `text`, or nothing when it must stay plain text:
 * not a URL, not http(s), with a user name or password, longer than
 * `MAX_LINK_LENGTH`, on the app's own host, or (in the apps) on a loopback or
 * single-label host. The result is the
 * URL as the browser will open it, so what was checked is what is opened.
 */
export function externalLink(text: string | undefined, context: LinkContext = currentContext()): string | undefined {
  if (!text || text.length > MAX_LINK_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  // https://bank.example@evil.example/ opens evil.example: an address with a user name or password is not linked.
  if (url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return undefined;
  if (context.appHost && host === context.appHost.toLowerCase().replace(/\.$/, '')) return undefined;
  if (context.native && (isLoopback(host) || (!host.includes('.') && !host.startsWith('[')))) return undefined;
  return url.href;
}
