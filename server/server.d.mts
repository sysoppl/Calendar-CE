import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { DavProxyHandler } from './davProxy.mjs';
import type { AppLinks } from './publicConfig.mjs';

export interface RequestHandlerOptions {
  /** Directory to serve; default `dist` next to the `server` folder. */
  root?: string;
  /** Headers for every static response; default `securityHeaders()`. */
  headers?: Record<string, string>;
  /** Default `handleDavProxy`. */
  proxy?: DavProxyHandler;
  /** Links written into every HTML page; default `resolveLinks()` (the environment). */
  links?: Partial<AppLinks>;
}

/** The meta tag the app reads the server's links from. */
export const LINKS_META: string;
/** Writes the links that are set into an HTML page; null when none is set. */
export function linksInjector(links: Partial<AppLinks> | null | undefined): ((html: Buffer) => Buffer) | null;

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** The DAV proxy first, static files with the app-shell fallback otherwise. */
export function createRequestHandler(options?: RequestHandlerOptions): RequestHandler;
/** The handler for `dist` with the settings from the environment. */
export const handleRequest: RequestHandler;
/** An `http.Server` that is not listening yet; it keeps count of the DAV writes in flight for `stopGracefully`. */
export function createAppServer(options?: RequestHandlerOptions): Server;
/** How long a stop waits for reads in flight, and for everything when a DAV write is among them (ms). */
export const STOP_GRACE: Readonly<{ graceMs: number; writeGraceMs: number }>;
/**
 * Closes the server and resolves when the process may exit: after the open
 * connections are done, after `graceMs` (default 5 s) when no DAV write is in
 * flight, at the latest after `writeGraceMs` (default 10 s).
 */
export function stopGracefully(server: Server, options?: { graceMs?: number; writeGraceMs?: number }): Promise<void>;
