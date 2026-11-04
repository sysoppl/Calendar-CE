// Bridge to the native DavHttp plugin (android/app/src/main/java/pl/patrykpro/calendar/DavHttpPlugin.java).
import { registerPlugin } from '@capacitor/core';
import { t } from '@/i18n';
import { DavNetworkError, type Transport } from './dav/transport';

interface DavHttpPlugin {
  request(options: { method: string; url: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    location?: string;
  }>;
}

const DavHttp = registerPlugin<DavHttpPlugin>('DavHttp');

export const nativeTransport: Transport = async (req) => {
  try {
    const res = await DavHttp.request({ method: req.method, url: req.url, headers: req.headers ?? {}, body: req.body });
    return { status: res.status, headers: new Headers(res.headers), body: res.body, location: res.location };
  } catch (err) {
    throw new DavNetworkError(t('dav.native.unreachable', { host: new URL(req.url).host, detail: err instanceof Error ? err.message : String(err) }));
  }
};
