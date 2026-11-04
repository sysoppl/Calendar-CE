import { Capacitor } from '@capacitor/core';
import { directTransport, proxyTransport, type Transport } from './dav/transport';
import { nativeTransport } from './nativeHttp';

export const isNative = Capacitor.isNativePlatform();

/**
 * In the Android app, requests go through the native DavHttp plugin, which is not
 * subject to CORS and supports WebDAV methods. In the browser the bundled
 * proxy is the default because almost no CalDAV server sends CORS headers.
 */
export function transportFor(useProxy: boolean): Transport {
  if (isNative) return nativeTransport;
  if (!useProxy) return directTransport;
  const base = (import.meta.env.VITE_DAV_PROXY_URL as string | undefined) ?? '/dav-proxy';
  return proxyTransport(base);
}
