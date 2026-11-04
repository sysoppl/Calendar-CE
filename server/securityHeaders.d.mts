/** Value of the Permissions-Policy header: every powerful feature the app does not use, off. */
export const PERMISSIONS_POLICY: string;
/** `meta: true` leaves out the directives that are invalid in a `<meta http-equiv>` policy. */
export function contentSecurityPolicy(options?: { meta?: boolean }): string;
/** Strict-Transport-Security value from CALENDAR_HSTS, or null when switched off. */
export function hstsFromEnv(env?: Record<string, string | undefined>): string | null;
/** Lower-case header names. `hsts: false` leaves Strict-Transport-Security out. */
export function securityHeaders(options?: { hsts?: string | false | null }): Record<string, string>;
