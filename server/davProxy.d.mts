import type { IncomingMessage, ServerResponse } from 'node:http';

export const PROXY_PATH: string;
export const TARGET_HEADER: string;
export const PROXY_ERROR_HEADER: string;
export const PROXY_RELAY_HEADER: string;
export function hostAllowed(hostname: string, allowList: string[]): boolean;
export function isPrivateAddress(address: string): boolean;
/** An IP address, a name without a dot or one under a local-only suffix: an exact listing of it may open private networks. */
export function isLocalName(hostname: string): boolean;
/** The lines the server logs about the proxy's configuration when it starts. */
export function proxyNotices(env?: Record<string, string | undefined>): string[];
/** CALENDAR_PUBLIC_HOSTS plus the host of VITE_APP_URL (with neither, the app's default address); null only when that cannot be read (any Host is answered). */
export function publicHosts(env?: Record<string, string | undefined>): string[] | null;
/** Whether a proxy request with this Host header is answered: `hosts`, IP addresses and local names; anything when `hosts` is null. */
export function hostHeaderAllowed(header: string | undefined, hosts: string[] | null): boolean;

/** Each value falls back to its environment variable, then to the built-in default. */
export interface DavProxyLimits {
  /** CALENDAR_PROXY_RATE: sustained requests per minute and client; 0 = unlimited. */
  ratePerMinute?: number;
  /** CALENDAR_PROXY_BURST: size of the token bucket. */
  burst?: number;
  /** CALENDAR_PROXY_CLIENT_CONCURRENCY: requests in flight per client; 0 = unlimited. */
  clientConcurrency?: number;
  /** CALENDAR_PROXY_CONCURRENCY: requests in flight in total; 0 = unlimited. */
  concurrency?: number;
  /** Longest wait for a token or a free slot before a request is turned away. */
  maxWaitMs?: number;
  /** Longest a request may hold its slot. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Requests that may wait in total (default 1024); past a quarter of it each client's share shrinks. */
  maxParked?: number;
  /** Request body bytes held by all running requests together (default 128 MiB; a client: a quarter, at least 10 MiB). */
  maxBodyBytes?: number;
  /** CALENDAR_PROXY_AUTH_FAILURES: answers 401 to requests with a password per client and window, then 429; 0 = unlimited. */
  authFailures?: number;
  /** The window those are counted in (default 10 minutes). */
  authWindowMs?: number;
}

export interface DavProxyOptions {
  /**
   * Overrides CALENDAR_PROXY_ALLOW_PRIVATE (the dev server grants it to loopback clients).
   * `true` also makes `open` default to true.
   */
  allowPrivate?: boolean;
  /** Overrides CALENDAR_PROXY_OPEN: without an allow-list, contact any public host instead of none. */
  open?: boolean;
  /** Overrides CALENDAR_PUBLIC_HOSTS and VITE_APP_URL: the Host names answered; null = any. */
  publicHosts?: string[] | null;
  /** Overrides CALENDAR_PROXY_DISABLED. */
  disabled?: boolean;
  /** Overrides CALENDAR_TRUST_PROXY: reverse proxies whose X-Forwarded-For entries count. */
  trustProxy?: number;
  limits?: DavProxyLimits;
  /** Receives one line per proxied request; `false` silences it. Overrides CALENDAR_PROXY_LOG. */
  log?: ((line: string) => void) | false;
}

/** Resolves to true when the request was for the proxy and has been answered. */
export type DavProxyHandler = (req: IncomingMessage, res: ServerResponse, options?: DavProxyOptions) => Promise<boolean>;

/** A proxy with request budgets of its own; `defaults` apply to every request. */
export function createDavProxy(defaults?: DavProxyOptions): DavProxyHandler;
export const handleDavProxy: DavProxyHandler;
/** The peer address, or the X-Forwarded-For entry `trustedHops` places from the right. */
export function clientAddress(req: IncomingMessage, trustedHops?: number): string;
